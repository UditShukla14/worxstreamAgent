/**
 * BaseAgent — reusable agent class that wraps an Anthropic Claude call
 * with a focused system prompt and a filtered subset of MCP tools.
 *
 * Each specialist agent is an instance of BaseAgent constructed from
 * an AGENT_DEFINITIONS entry. The tool registry in src/mcp/server.js
 * stays completely unchanged.
 */

import { config, getWorxstreamContext } from '../../config/index.js';
import { createMessage, streamMessage } from '../../llm/anthropicClient.js';
import { withPromptCaching } from '../../llm/promptCache.js';
import { buildToolResultBlock, summarizeToolResult } from './toolResultContent.js';
import { createDeltaCoalesceBuffer } from './streamSectionBuffer.js';
import { isShopifyAnalyticsTool, modelFacingToolResult } from './shopifyAnalyticsPresentation.js';
import { thinkingParamsFor, maxTokensWithThinking } from '../../llm/thinking.js';
import { computeContextBudget, measuredInputTokens } from '../../utils/contextBudget.js';
import { clearOldToolResults } from '../../utils/contextWindow.js';
import { countMessagesTokens } from '../../utils/tokenCounter.js';
import { computeEventCost } from '../../analytics/costing.js';
import { getTurnCreditCapUsd } from '../../analytics/novaWallet.js';
import { CreditExhaustedError } from '../../analytics/creditGuard.js';
import { usageMetaFromContext } from '../../analytics/usageMeta.js';
import { getModelForTier, inferTaskTier } from '../../analytics/taskModels.js';
import { getAnthropicTools, getAnthropicToolsForToolSearch, executeMcpTool } from '../../mcp/server.js';
import { rex } from './AgentTracker.js';
import { getSoulSystemPrompt } from './soul.js';
import { getToolIndex } from '../../mcp/toolIndex.js';
import {
  normalizeListInput,
} from './policies/listPolicies.js';
import { appendPlaybookToPrompt } from './playbooks.js';
import {
  fingerprintWriteInput,
  getRecentConfirmedWrite,
  isWriteTool,
  shouldConfirmWrites,
  storePendingConfirm,
  usesAgentChatConfirm,
} from './pendingConfirm.js';
import { COWORKER_SHARED_RULES, stripDuplicatedSharedRules } from './coworkerRules.js';
import { extractTurnAgentTranscript } from './agentTranscript.js';

const MAX_TOOL_ITERATIONS = Number.isFinite(config.agentRuntime?.maxToolIterations)
  ? config.agentRuntime.maxToolIterations
  : 15;

const SPECIALIST_TOOL_SEARCH_MIN_TOOLS = 20;

const CONTINUE_USER_NOTE =
  '[Continue] Resume the open task from where you left off. Do not restart from scratch. '
  + 'Call any remaining tools, then give the user answer.';

const TRUNCATED_CONTINUE_NOTE =
  '[Continue] Your previous response was truncated (max_tokens). Continue exactly from where you left off.';

/** User turn that means "send the SMS draft I already saw". */
function isSmsChatConfirmMessage(message) {
  const t = String(message || '').trim();
  if (!t) return false;
  return /^(yes|yep|yeah|ok|okay|confirm|confirmed|send(\s+it)?|approve|approved|go\s+ahead|do\s+it|ship\s+it)[.!\s]*$/i.test(t);
}

/** Tools that must never be fanned out (writes, SMS draft/send ordering, Shopify rate-limit cooldown). */
function isParallelSafeTool(name) {
  const n = String(name || '');
  if (isWriteTool(n)) return false;
  if (n === 'draft_sms' || n === 'send_sms') return false;
  if (n === 'run_shopify_analytics' || n === 'run_shopify_analytics_query') return false;
  return true;
}

function canRunInParallel(toolUseBlocks) {
  return toolUseBlocks.length > 1 && toolUseBlocks.every((b) => isParallelSafeTool(b.name));
}

/** @returns {Promise<Map<string, {result: object, durationMs: number}>>} keyed by tool_use id */
async function runReadToolsInParallel(toolUseBlocks, getInput, execCtx, onDone = () => {}) {
  const entries = await Promise.all(toolUseBlocks.map(async (block) => {
    const start = Date.now();
    const result = await executeMcpTool(block.name, getInput(block), execCtx);
    const durationMs = Date.now() - start;
    onDone(block, result, durationMs); // lets the UI show each call finishing as it happens
    return [block.id, { result, durationMs }];
  }));
  return new Map(entries);
}

/** SSE `tool_result` payload: id for pairing, timing, and a one-line summary (no raw data). */
function toolResultEvent(block, result, durationMs) {
  const ok = result?.success !== false;
  return {
    type: 'tool_result',
    id: block.id,
    tool: block.name,
    success: ok,
    duration_ms: Math.round(durationMs || 0),
    summary: summarizeToolResult(result),
    ...(ok ? {} : { error: String(result?.error || 'Failed').slice(0, 300) }),
  };
}

export class BaseAgent {
  /**
   * @param {object} definition
   * @param {string} definition.name          - Unique agent name (e.g. "estimate_agent")
   * @param {string} definition.description   - Short description for router
   * @param {string[]} definition.tools       - Array of MCP tool names this agent can use
   * @param {string} definition.systemPrompt  - System prompt for this agent
   */
  constructor(agentKey, definition) {
    this.agentKey = agentKey;
    this.name = definition.name;
    this.description = definition.description;
    this.domain = definition.domain || null;
    this.domains = Array.isArray(definition.domains) && definition.domains.length > 0
      ? definition.domains
      : null;
    /** Cross-domain helper tools (e.g. dropdown lookups) this agent may call. */
    this.extraTools = Array.isArray(definition.extraTools) ? definition.extraTools : [];
    /** When true, getTools() exposes all non-governance product tools (Claude/OpenAI-style). */
    this.orchestrator = definition.orchestrator === true;
    /** Opt-in wider tool discovery; falls back to global config.anthropic.useToolSearch. */
    this.useToolSearch = definition.useToolSearch === true
      ? true
      : definition.useToolSearch === false
        ? false
        : null;
    const soul = getSoulSystemPrompt();
    const specialistPrompt = stripDuplicatedSharedRules(definition.systemPrompt || '');
    // Orchestrator Nova also gets shared rules (proportionality, dates, IDs).
    const withShared = `${specialistPrompt}\n\n${COWORKER_SHARED_RULES}`;
    const base = soul
      ? `${soul}\n\n${withShared}`
      : withShared;
    // Domain playbooks only for specialists; the orchestrator discovers tools via tool search + the shared rules.
    this.systemPrompt = this.orchestrator
      ? base
      : appendPlaybookToPrompt(base, definition.domain);
  }

  /** @param {object} context */
  _usageMeta(context = {}) {
    return usageMetaFromContext(context, {
      phase: context._usagePhase || 'agent',
      agentKey: this.agentKey,
    });
  }

  /**
   * Prefer explicit context.model, else company/user task-tier map (ALS).
   * @param {object} [context]
   */
  _resolveModel(context = {}) {
    if (context.model) return String(context.model);
    const tier = inferTaskTier({
      agentKey: this.agentKey,
      phase: context._usagePhase || 'agent',
      taskTier: context.taskTier,
    });
    return getModelForTier(tier);
  }

  /**
   * Returns this agent's tools from the shared MCP registry.
   * Orchestrator Nova: all product tools (excludes governance) with tool-search when enabled.
   */
  getTools() {
    const index = getToolIndex();
    const toolSearchOn = this.useToolSearch !== null
      ? this.useToolSearch
      : config.anthropic.useToolSearch;

    if (this.orchestrator) {
      const allowList = index.tools
        .filter((t) => {
          const domain = t?.capabilities?.domain;
          if (domain === 'governance') return false;
          const name = t.name;
          if (name === 'invoke_agent' || name === 'get_relevant_policies') return false;
          return true;
        })
        .map((t) => t.name);
      if (allowList.length === 0) {
        console.error(`❌ [${this.name}] orchestrator has no product tools registered`);
        return [];
      }
      // Always prefer tool-search for wide catalogs (token-efficient, Claude/OpenAI-style).
      if (toolSearchOn || allowList.length > 40) {
        return getAnthropicToolsForToolSearch(allowList);
      }
      return getAnthropicTools(allowList);
    }

    const domainKeys = (this.domains || [this.domain || this.agentKey])
      .map(d => String(d || '').toLowerCase())
      .concat('lookup');

    const allowSet = new Set();
    for (const key of domainKeys) {
      const bucket = index.byDomain?.[key];
      if (!Array.isArray(bucket)) continue;
      for (const t of bucket) allowSet.add(t.name);
    }

    const registered = new Set(index.tools.map((t) => t.name));
    for (const name of this.extraTools) {
      if (registered.has(name)) {
        allowSet.add(name);
      } else {
        console.error(`❌ [${this.name}] extraTools entry "${name}" is not a registered tool`);
      }
    }

    if (allowSet.size === 0) {
      console.error(`❌ [${this.name}] no tools in domain bucket(s) [${domainKeys.join(', ')}] — check DOMAIN_RULES in src/mcp/toolCapabilities.js; running with NO tools`);
      return [];
    }

    const allowList = [...allowSet];

    // Small domains load directly (a search round-trip costs more than it saves);
    // large domains or explicit opt-in use on-demand tool search.
    if (toolSearchOn && (this.useToolSearch === true || allowList.length > SPECIALIST_TOOL_SEARCH_MIN_TOOLS)) {
      return getAnthropicToolsForToolSearch(allowList);
    }

    return getAnthropicTools(allowList);
  }

  /**
   * Run the agent on a user message.
   *
   * @param {string} message    - The user's (or delegating agent's) message
   * @param {object} [context]  - Optional context from another agent
   * @param {string} [context.fromAgent] - Name of the calling agent
   * @param {string} [context.reason]    - Why this agent was invoked
   * @returns {Promise<AgentResult>}
   */
  async run(message, context = {}) {
    const tools = this.getTools();
    const messages = this._buildInitialMessages(message, context);

    let response;
    let iterations = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    const toolsUsed = [];

    console.log(`\n🤖 [${this.name}] started (${tools.length} tools)`);

    while (iterations < MAX_TOOL_ITERATIONS) {
      iterations++;

      const params = {
        model: this._resolveModel(context),
        max_tokens: config.anthropic.maxTokens?.agent ?? 4096,
        system: this.systemPrompt,
        messages,
      };

      if (tools.length > 0) {
        params.tools = tools;
        params.tool_choice = { type: 'auto' };
      }

      response = await createMessage(withPromptCaching(params), this._usageMeta(context));

      if (response.usage) {
        totalInputTokens += response.usage.input_tokens || 0;
        totalOutputTokens += response.usage.output_tokens || 0;
      }

      if (response.stop_reason === 'tool_use') {
        const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
        messages.push({ role: 'assistant', content: response.content });

        const toolResults = [];
        const execCtx = { agent: this.name, userMessage: message };
        const prefetched = canRunInParallel(toolUseBlocks)
          ? await runReadToolsInParallel(toolUseBlocks, (b) => b.input, execCtx)
          : null;
        for (const block of toolUseBlocks) {
          console.log(`  🔧 [${this.name}] → ${block.name}`);
          const toolStart = Date.now();
          const pre = prefetched?.get(block.id);
          const result = pre ? pre.result : await executeMcpTool(block.name, block.input, execCtx);
          const toolDuration = pre ? pre.durationMs : Date.now() - toolStart;
          toolsUsed.push({
            name: block.name,
            input: block.input,
            success: result.success,
            durationMs: toolDuration,
            ...(result.success === false && result.error ? { error: String(result.error).slice(0, 300) } : {}),
          });
          if (context._rexRequestId) {
            rex.toolCall(context._rexRequestId, block.name, toolDuration, result.success);
          }
          toolResults.push(buildToolResultBlock(block.id, result));
        }
        messages.push({ role: 'user', content: toolResults });
        continue;
      }

      // Done — no more tool calls
      break;
    }

    const textBlocks = response.content.filter(b => b.type === 'text');
    const finalText = textBlocks.map(b => b.text).join('\n');

    console.log(`✅ [${this.name}] done (${iterations} iteration(s), ${toolsUsed.length} tool call(s), ${totalInputTokens + totalOutputTokens} tokens)`);

    return {
      agent: this.name,
      response: finalText,
      rawContent: response.content,
      toolsUsed,
      usage: {
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
        total_tokens: totalInputTokens + totalOutputTokens,
      },
    };
  }

  /**
   * Run the agent with SSE progress events for tool calls, then return
   * the raw text output. The caller is responsible for formatting and
   * streaming the final text to the client (via the OutputFormatter).
   *
   * Emits during the tool loop:
   *   { type: 'tool_use',    tool, input }
   *   { type: 'tool_result', tool, success }
   *
   * @param {string} message
   * @param {object} context
   * @param {(data: object) => void} onEvent - SSE callback for progress events
   * @returns {Promise<{ rawText: string, toolsUsed: object[], toolResultPayloads: object[] }>}
   */
  async runWithEvents(message, context = {}, onEvent = () => {}) {
    const tools = this.getTools();
    const history = Array.isArray(context._conversationHistory)
      ? context._conversationHistory.filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
      : [];
    const historyLength = history.length;
    const messages = this._buildInitialMessages(message, context);

    const maxSlices = Math.max(
      1,
      Number.isFinite(config.coworker?.maxContinueSlices)
        ? config.coworker.maxContinueSlices
        : 3,
    );
    const maxIterPerSlice = MAX_TOOL_ITERATIONS;
    const maxTotalRounds = maxSlices * maxIterPerSlice;

    let totalRounds = 0;
    const toolsUsed = [];
    const toolResultPayloads = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let draftedSmsThisRun = false;
    let lastRawText = '';
    // Live token streaming (chat SSE only): text deltas go to the client as the model writes them.
    const streamText = context._streamText === true;
    let streamedAny = false;
    // After a Shopify analytics tool the pipeline replaces the answer with runtime widgets + commentary, so the
    // model's own text is not streamed live (it would flash and then be swapped).
    let holdLiveText = false;
    let streamedAnswer = ''; // text streamed since the last tool call = the final answer the client has seen
    // Exact size of the most recent request (from response.usage) — drives in-loop compaction.
    let lastCallInput = 0;
    let lastCallUsage = null;
    let lastCallModel = '';
    let lastCallMessageCount = 0;
    let contextClears = 0;
    // Provider cost accumulated this turn - hard stop against runaway tool loops.
    let turnCostUsd = 0;
    let spendCapHit = false;
    let creditCapHit = false;
    // The turn stops at the lower of the per-turn cap and what the company still has in credit, so one long
    // tool loop cannot run far past an empty wallet.
    const perTurnCap = Number(config.billing?.maxTurnCostUsd) || 0;
    let creditCap = null;
    try {
      creditCap = await getTurnCreditCapUsd(getWorxstreamContext().companyId);
    } catch {
      creditCap = null; // a wallet lookup problem must not block the turn
    }
    const turnCostCap = creditCap != null
      ? (perTurnCap > 0 ? Math.min(perTurnCap, creditCap) : creditCap)
      : perTurnCap;

    const signal = context._abortSignal || null;
    const isAborted = () => Boolean(signal?.aborted);
    const isAbortError = (err) => isAborted()
      || err?.name === 'AbortError' || err?.name === 'APIUserAbortError';
    const abortedResult = () => {
      console.log(`  ⏹️ [${this.name}] aborted by client after ${totalRounds} round(s), ${toolsUsed.length} tool call(s)`);
      return finish({ rawText: lastRawText || '', aborted: true, agentTranscript: [] });
    };

    const finish = (extra = {}) => {
      const usage = {
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
        total_tokens: totalInputTokens + totalOutputTokens,
        last_call: lastCallUsage
          ? {
            model: lastCallModel,
            input_tokens: lastCallInput,
            cache_read_input_tokens: lastCallUsage.cache_read_input_tokens || 0,
            cache_creation_input_tokens: lastCallUsage.cache_creation_input_tokens || 0,
            output_tokens: lastCallUsage.output_tokens || 0,
          }
          : null,
        context_clears: contextClears,
        turn_cost_usd: Number(turnCostUsd.toFixed(6)),
        spend_cap_hit: spendCapHit,
        credit_cap_hit: creditCapHit,
      };
      return {
        toolsUsed,
        toolResultPayloads,
        usage,
        agentTranscript: extractTurnAgentTranscript(messages, historyLength),
        ...(streamedAny ? { streamedText: true, streamedAnswer } : {}),
        ...extra,
      };
    };

    console.log(`\n🤖 [${this.name}] started (${tools.length} tools, up to ${maxSlices} continue slice(s))`);

    for (let slice = 1; slice <= maxSlices; slice++) {
      if (slice > 1) {
        console.log(`  ↻ [${this.name}] continue slice ${slice}/${maxSlices}`);
        onEvent({
          type: 'task_progress',
          status: 'continuing',
          slice,
          maxSlices,
          toolsSoFar: toolsUsed.length,
        });
        onEvent({ type: 'status', label: 'Continuing your request…' });
        messages.push({ role: 'user', content: CONTINUE_USER_NOTE });
      }

      let iterations = 0;
      while (iterations < maxIterPerSlice && totalRounds < maxTotalRounds) {
        if (isAborted()) return abortedResult();
        if ((turnCostCap > 0 || creditCap != null) && turnCostUsd >= turnCostCap) {
          spendCapHit = true;
          creditCapHit = creditCap != null && turnCostUsd >= creditCap;
          console.log(`  [cost cap] ${this.name}: ${creditCapHit ? 'credit' : 'per-turn'} cap reached ($${turnCostUsd.toFixed(4)} >= $${turnCostCap})`);
          break;
        }
        iterations++;
        totalRounds++;

        const model = this._resolveModel(context);
        // Extended thinking only for interactive streamed turns on models that support it.
        const thinking = streamText && context._thinking !== false ? thinkingParamsFor(model) : null;
        const configuredMax = config.anthropic.maxTokens?.agent ?? 4096;
        const maxOut = thinking ? maxTokensWithThinking(model, configuredMax) : configuredMax;

        // Compaction: exact size of the last request + what was appended since.
        let callMessages = messages;
        if (lastCallInput > 0) {
          const budget = computeContextBudget({ model, reservedOutput: maxOut });
          const projected = lastCallInput + countMessagesTokens(messages.slice(lastCallMessageCount));
          if (projected > budget.hard) {
            const edited = clearOldToolResults(messages, { keepRecent: 2 });
            if (edited.cleared > 0) {
              callMessages = edited.messages;
              contextClears += edited.cleared;
              console.log(`  🧹 [${this.name}] context ${projected}/${budget.usable} tokens — cleared ${edited.cleared} old tool result(s)`);
            }
          }
        }

        const params = {
          model,
          max_tokens: maxOut,
          system: this.systemPrompt,
          messages: callMessages,
        };
        if (thinking) params.thinking = thinking;
        if (tools.length > 0) {
          params.tools = tools;
          params.tool_choice = { type: 'auto' };
        }

        let response;
        try {
          if (streamText) {
            // Coalesce tiny token deltas into short frames; a new text block in the same
            // response is separated by a blank line (matches how rawText is joined).
            let lastBlock = null;
            let roundEmitted = false;
            const flushBuf = createDeltaCoalesceBuffer((chunk) => {
              streamedAny = true;
              streamedAnswer += chunk;
              onEvent({ type: 'text', content: chunk });
            }, { maxDelayMs: 40, maxChars: 96 });
            // Thinking summaries stream as their own events so the UI can show a collapsible "Thinking" block.
            let thinkingOpen = false;
            const thinkBuf = createDeltaCoalesceBuffer((chunk) => {
              onEvent({ type: 'thinking', content: chunk });
            }, { maxDelayMs: 60, maxChars: 160 });
            const endThinking = () => {
              thinkBuf.flush();
              if (thinkingOpen) {
                thinkingOpen = false;
                onEvent({ type: 'thinking_end' });
              }
            };
            try {
              ({ message: response } = await streamMessage(
                withPromptCaching(params),
                this._usageMeta(context),
                (delta, blockIndex) => {
                  if (holdLiveText) return;
                  if (roundEmitted && lastBlock != null && blockIndex !== lastBlock) flushBuf.push('\n');
                  lastBlock = blockIndex;
                  roundEmitted = true;
                  flushBuf.push(delta);
                },
                signal ? { signal } : undefined,
                thinking
                  ? {
                    onDelta: (delta) => {
                      if (!thinkingOpen) {
                        thinkingOpen = true;
                        onEvent({ type: 'status', label: 'Thinking…' });
                      }
                      thinkBuf.push(delta);
                    },
                    onStop: endThinking,
                  }
                  : undefined,
              ));
            } finally {
              endThinking();
              flushBuf.flush();
            }
          } else {
            response = await createMessage(
              withPromptCaching(params),
              this._usageMeta(context),
              signal ? { signal } : undefined,
            );
          }
        } catch (err) {
          if (isAbortError(err)) return abortedResult();
          if (err instanceof CreditExhaustedError) {
            // Not even a short answer fits the credit left: stop here with the credit message (nothing was charged).
            spendCapHit = true;
            creditCapHit = true;
            console.log(`  [credit guard] ${this.name}: the credit left cannot cover another model call`);
            break;
          }
          throw err;
        }
        lastCallModel = response.model || model;
        lastCallUsage = response.usage || null;
        lastCallInput = measuredInputTokens(response.usage);
        turnCostUsd += computeEventCost({ model, responseModel: response.model, usage: response.usage, markupRate: 0 }).providerCostUsd;
        lastCallMessageCount = messages.length; // everything pushed after this is new input next round

        if (response.usage) {
          totalInputTokens += response.usage.input_tokens || 0;
          totalOutputTokens += response.usage.output_tokens || 0;
          onEvent({
            type: 'usage',
            input_tokens: totalInputTokens,
            output_tokens: totalOutputTokens,
            total_tokens: totalInputTokens + totalOutputTokens,
          });
        }

        const hasToolUse = response.content?.some((block) => block?.type === 'tool_use');
        if (response.stop_reason === 'max_tokens' && !hasToolUse) {
          console.log(`  ⚠️ [${this.name}] stop_reason=max_tokens — continuing…`);
          if (response.content?.length) {
            messages.push({ role: 'assistant', content: response.content });
          }
          const partial = (response.content || [])
            .filter((b) => b.type === 'text')
            .map((b) => b.text)
            .join('\n');
          if (partial) lastRawText = `${lastRawText}${partial}`;
          messages.push({ role: 'user', content: TRUNCATED_CONTINUE_NOTE });
          continue;
        }

        // A max_tokens response can still contain a complete tool_use block.
        // Process it exactly like stop_reason=tool_use; sending a plain
        // continuation message after an assistant tool_use violates Anthropic's
        // required assistant-tool_use → user-tool_result sequence.
        if (response.stop_reason === 'tool_use' || hasToolUse) {
          const allToolUseBlocks = response.content.filter((b) => b.type === 'tool_use');
          // Scheduled runs use the same sequential tool loop as chat: one
          // tool call, one result, then Nova gets another turn. If the model
          // emits a batch anyway, retain only the first tool_use block in the
          // assistant message so no unpaired tool IDs enter the next request.
          const toolUseBlocks = context._oneToolAtATime === true
            ? allToolUseBlocks.slice(0, 1)
            : allToolUseBlocks;
          const assistantContent = context._oneToolAtATime === true
            ? response.content.filter((block) => (
              block?.type !== 'tool_use' || block === toolUseBlocks[0]
            ))
            : response.content;
          messages.push({ role: 'assistant', content: assistantContent });

          // Stop pressed while the model was answering: start no tool at all (parallel batches included).
          if (isAborted()) return abortedResult();

          const toolResults = [];
          const normalizeInput = (b) => {
            const raw = b.input || {};
            return b.name?.startsWith('list_') ? normalizeListInput(raw) : raw;
          };
          // Independent read-only calls in one model turn run concurrently.
          // Text streamed before this tool round was narration, not the answer.
          streamedAnswer = '';
          const runParallel = context._oneToolAtATime !== true && canRunInParallel(toolUseBlocks);
          if (runParallel) {
            for (const b of toolUseBlocks) {
              onEvent({ type: 'tool_use', id: b.id, tool: b.name, input: normalizeInput(b) });
            }
          }
          const prefetched = runParallel
            ? await runReadToolsInParallel(
              toolUseBlocks,
              normalizeInput,
              { agent: this.name, userMessage: message },
              (b, result, durationMs) => onEvent(toolResultEvent(b, result, durationMs)),
            )
            : null;
          for (const block of toolUseBlocks) {
            // Stop between tool calls; one already in flight is allowed to finish.
            if (isAborted()) return abortedResult();
            console.log(`  🔧 [${this.name}] → ${block.name}`);
            const originalInput = block.input || {};
            const normalizedInput = block.name?.startsWith('list_')
              ? normalizeListInput(originalInput)
              : originalInput;
            if (!prefetched) onEvent({ type: 'tool_use', id: block.id, tool: block.name, input: normalizedInput });

            // Same write already UI-approved this conversation — reuse result
            // (prevents approve → "continue" → re-confirm loops / duplicate creates).
            if (isWriteTool(block.name) && !usesAgentChatConfirm(block.name)) {
              const recent = await getRecentConfirmedWrite(context._planRef || {});
              const fp = fingerprintWriteInput(block.name, normalizedInput);
              if (recent && recent.tool === block.name && recent.inputFingerprint === fp) {
                console.log(`  ♻️ [${this.name}] ${block.name} already confirmed — reusing result`);
                const cached = recent.result || {
                  success: true,
                  message: 'Write already executed after user approval; do not call again.',
                };
                toolsUsed.push({
                  name: block.name,
                  input: normalizedInput,
                  success: cached.success !== false,
                });
                toolResultPayloads.push(cached);
                onEvent(toolResultEvent(block, cached, 0));
                toolResults.push(buildToolResultBlock(block.id, cached));
                continue;
              }
            }

            if (
              shouldConfirmWrites(context)
              && isWriteTool(block.name)
              && !usesAgentChatConfirm(block.name)
              && !context._approvedConfirmations?.includes(block.id)
              && !(
                context._scheduledDelivery === true
                && (block.name === 'send_email' || block.name === 'send_sms')
              )
            ) {
              console.log(`  ⏸️ [${this.name}] ${block.name} gated — awaiting write confirmation`);
              const confirmationId = await storePendingConfirm(
                context._planRef || {},
                {
                  tool: block.name,
                  input: normalizedInput,
                  agentKey: this.agentKey,
                  userMessage: message,
                },
              );
              console.log(`  ⏸️ [${this.name}] confirmationId=${confirmationId || 'null'}`);
              onEvent({
                type: 'confirmation_required',
                confirmationId,
                tool: block.name,
                input: normalizedInput,
              });
              return finish({
                rawText: lastRawText || '',
                needsConfirmation: true,
                confirmationId,
              });
            }

            if (
              block.name === 'send_sms'
              && draftedSmsThisRun
              && !isSmsChatConfirmMessage(message)
              && context._scheduledDelivery !== true
            ) {
              console.log(`  ⏸️ [${this.name}] send_sms blocked — show draft and wait for chat confirm`);
              const blocked = {
                success: false,
                error:
                  'Do not call send_sms in the same turn as draft_sms. '
                  + 'Show To/From/Body to the user and wait for their next message confirming.',
              };
              toolsUsed.push({ name: block.name, input: normalizedInput, success: false, error: blocked.error });
              toolResultPayloads.push(blocked);
              onEvent(toolResultEvent(block, blocked, 0));
              toolResults.push(buildToolResultBlock(block.id, blocked));
              continue;
            }

            const toolStart = Date.now();
            const pre = prefetched?.get(block.id);
            const result = pre
              ? pre.result
              : await executeMcpTool(block.name, normalizedInput, {
                agent: this.name,
                userMessage: message,
              });
            const toolDuration = pre ? pre.durationMs : Date.now() - toolStart;

            if (block.name === 'draft_sms' && result?.success !== false) {
              draftedSmsThisRun = true;
            }

            toolsUsed.push({
              name: block.name,
              input: normalizedInput,
              success: result.success,
              ...(result.success === false && result.error
                ? { error: String(result.error).slice(0, 300) }
                : {}),
            });
            toolResultPayloads.push(result);
            if (!prefetched) onEvent(toolResultEvent(block, result, toolDuration));
            if (context._rexRequestId) {
              rex.toolCall(context._rexRequestId, block.name, toolDuration, result.success);
            }

            if (isShopifyAnalyticsTool(block.name) && result?.success !== false) holdLiveText = true;
            toolResults.push(buildToolResultBlock(block.id, modelFacingToolResult(block.name, result)));
          }
          if (isAborted()) return abortedResult();
          messages.push({ role: 'user', content: toolResults });
          continue;
        }

        // Completed with text (or empty end_turn)
        const textBlocks = (response.content || []).filter((b) => b.type === 'text');
        const rawText = textBlocks.map((b) => b.text).join('\n');
        if (response.content?.length) {
          messages.push({ role: 'assistant', content: response.content });
        }
        lastRawText = `${lastRawText}${rawText}` || lastRawText;
        console.log(
          `✅ [${this.name}] done (slice ${slice}/${maxSlices}, ${totalRounds} round(s), `
          + `${toolsUsed.length} tool call(s), ${totalInputTokens + totalOutputTokens} tokens)`,
        );
        return finish({ rawText: lastRawText, continued: slice > 1 });
      }

      if (spendCapHit) break;
      // Slice tool budget exhausted — try another slice if we still have work signal
      if (toolsUsed.length === 0) break;
      console.log(`⚠️ [${this.name}] slice ${slice} hit max iterations (${maxIterPerSlice})`);
    }

    console.log(`⚠️ [${this.name}] continue budget exhausted (${maxSlices} slices)`);
    const fallbackText = lastRawText
      || (creditCapHit
        ? 'Your Nova credits ran out while working on this, so I stopped here. Add credits and ask again to continue.'
        : spendCapHit
        ? 'This request used a lot of compute, so I paused to stay within the per-request limit. Say **continue** and I will resume from here.'
        : 'I hit the tool budget mid-task. Say **continue** and I will resume from here without starting over.');
    return finish({
      rawText: fallbackText,
      needsContinue: true,
      continued: true,
    });
  }

  /**
   * Anthropic messages array: prior turns (if any) + this turn's user prompt.
   * @param {string} message
   * @param {object} context
   * @param {Array<{ role: string, content: string }>} [context._conversationHistory]
   */
  _buildInitialMessages(message, context = {}) {
    const turnPrompt = this._buildPrompt(message, context);
    const history = Array.isArray(context._conversationHistory)
      ? context._conversationHistory.filter(m => m && (m.role === 'user' || m.role === 'assistant'))
      : [];

    if (history.length > 0) {
      return [...history, { role: 'user', content: turnPrompt }];
    }
    return [{ role: 'user', content: turnPrompt }];
  }

  /**
   * Build the user prompt, optionally prefixing context from a delegating agent.
   */
  _buildPrompt(message, context) {
    const parts = [];

    if (context._conversationContext) {
      parts.push(context._conversationContext);
    }

    if (context.fromAgent) {
      parts.push(`[Delegated from ${context.fromAgent}]`);
      if (context.reason) parts.push(`Context: ${context.reason}`);
    }

    if (parts.length > 0) {
      parts.push('', `User request: ${message}`);
      return parts.join('\n');
    }
    return message;
  }
}
