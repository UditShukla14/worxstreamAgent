/**
 * BaseAgent — reusable agent class that wraps an OpenAI-compatible LLM call
 * with a focused system prompt and a filtered subset of MCP tools.
 *
 * Each specialist agent is an instance of BaseAgent constructed from
 * an AGENT_DEFINITIONS entry. The tool registry in src/mcp/server.js
 * stays unchanged while the runtime uses OpenAI messages and function tools.
 */

import { config } from '../../config/index.js';
import {
  createMessage,
  streamMessage,
  getAssistantMessage,
  getResponseText,
} from '../../llm/client.js';
import { parseToolArguments } from '../../llm/toolArguments.js';
import { usageMetaFromContext } from '../../analytics/usageMeta.js';
import { getOpenAITools, executeMcpTool } from '../../mcp/server.js';
import { rex } from './AgentTracker.js';
import { getSoulSystemPrompt } from './soul.js';
import { getToolIndex } from '../../mcp/toolIndex.js';
import { selectToolsViaLlm } from '../../mcp/selectToolsForTurn.js';
import {
  normalizeListInput,
} from './policies/listPolicies.js';
import { startActivityKeywordRotation } from './activityKeywords.js';
import { appendPlaybookToPrompt } from './playbooks.js';
import {
  isWriteTool,
  shouldConfirmWrites,
  storePendingConfirm,
  usesAgentChatConfirm,
} from './pendingConfirm.js';
import { COWORKER_SHARED_RULES, stripDuplicatedSharedRules } from './coworkerRules.js';
import { extractTurnAgentTranscript } from './agentTranscript.js';
import { createDeltaCoalesceBuffer } from './streamSectionBuffer.js';

const MAX_TOOL_ITERATIONS = Number.isFinite(config.agentRuntime?.maxToolIterations)
  ? config.agentRuntime.maxToolIterations
  : 15;

const CONTINUE_USER_NOTE =
  '[Continue] Resume the open task from where you left off. Do not restart from scratch. '
  + 'Call any remaining tools, then give the user answer.';

const TRUNCATED_CONTINUE_NOTE =
  '[Continue] Your previous response was truncated (max_tokens). Continue exactly from where you left off.';

/** Professional UI tags — lists/reports should render as coworker-grade structure. */
const TABLE_UI_SCHEMA = `
PROFESSIONAL UI (org coworker — prefer structured tags so the product renders cards/tables/charts):
- List / recent → titled <table> with <headers><th>…</th></headers> and one <row><td>…</td></row> per returned item (markdown pipes do NOT render).
- Totals / report / overview → short title + <stats> + <table>; add <chart type="pie|bar|line"> when a breakdown helps.
- One record → <details> or tight prose. Clarifying questions → plain text.
Example table:
<table title="Recent invoices (Aug 24 – Sep 23, 2026)">
<headers><th>Invoice</th><th>Customer</th><th>Amount</th><th>Status</th><th>Created</th></headers>
<row><td>26-4884</td><td>Acme</td><td>$1,860.00</td><td status="warning">Open</td><td>Sep 23, 2026</td></row>
</table>
<stats><stat label="…" value="…" icon="dollar|chart" color="blue|green"/></stats>
<details title="…"><item label="…">value</item></details>
<alert type="success|error|warning|info">…</alert>
If you show a fetched page as a table, include every returned row. Prefer human labels and $ amounts.
`.trim();

/** User turn that means "send the SMS draft I already saw". */
function isSmsChatConfirmMessage(message) {
  const t = String(message || '').trim();
  if (!t) return false;
  return /^(yes|yep|yeah|ok|okay|confirm|confirmed|send(\s+it)?|approve|approved|go\s+ahead|do\s+it|ship\s+it)[.!\s]*$/i.test(t);
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
    /** Opt-in dynamic tool selection for wide domain catalogs. */
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
    const resumeNote = '\n\nIf [Session focus] shows a failed last action, attempt recovery (correct IDs/parameters) before asking the user to repeat.';
    const lookupNote = '\n\nID RESOLUTION: NEVER ask the user for an internal ID (user, customer, contact, product, vendor, tax, job, project...). When the user gives a name, call the resolve_entity tool (entity_type + the name) — or a domain lookup tool you have — to get the ID yourself. Only ask the user when the lookup finds nothing or returns multiple ambiguous matches (then show the matching names, never raw IDs).';
    // Domain playbooks only for specialists; orchestrator gets a compact UI schema
    // (full reports-charts.md is too large for 65k-context self-hosted models).
    this.systemPrompt = this.orchestrator
      ? `${base}${resumeNote}${lookupNote}\n\n[UI XML shapes]\n${TABLE_UI_SCHEMA}`
      : appendPlaybookToPrompt(base + resumeNote + lookupNote, definition.domain);
  }

  /** @param {object} context */
  _usageMeta(context = {}) {
    return usageMetaFromContext(context, {
      phase: context._usagePhase || 'agent',
      agentKey: this.agentKey,
    });
  }

  /**
   * Returns this agent's tools from the shared MCP registry.
   * Orchestrator Nova: one compact LLM tool-selection call,
   * then full schemas only for the selected names.
   *
   * @param {string} [hintText] - user message + plan text
   * @param {object} [usageMeta] - billing attribution for the picker call
   * @returns {Promise<Array>}
   */
  async getTools(hintText = '', usageMeta = {}) {
    const index = getToolIndex();

    if (this.orchestrator) {
      const catalog = index.tools
        .filter((t) => {
          const domain = t?.capabilities?.domain;
          if (domain === 'governance') return false;
          const name = t.name;
          if (name === 'invoke_agent' || name === 'get_relevant_policies') return false;
          return true;
        });
      if (catalog.length === 0) {
        console.error(`❌ [${this.name}] orchestrator has no product tools registered`);
        return [];
      }
      const maxTools = Number.isFinite(config.coworker?.maxToolsPerTurn)
        ? config.coworker.maxToolsPerTurn
        : 40;
      const { tools: ranked, source } = await selectToolsViaLlm(catalog, hintText, {
        maxTools,
        usageMeta: {
          ...usageMeta,
          phase: 'tool_search',
          agentKey: this.agentKey,
        },
      });
      const allowList = ranked.map((t) => t.name);
      console.log(`  🪛 [${this.name}] tool search (${source}): ${allowList.length}/${catalog.length} → [${allowList.join(', ')}]`);
      return getOpenAITools(allowList, { strict: config.llm.strictToolCalls });
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

    return getOpenAITools([...allowSet], { strict: config.llm.strictToolCalls });
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
    const toolHint = [message, context._executionPlanText, context._planText]
      .filter(Boolean)
      .join('\n');
    const tools = await this.getTools(toolHint, this._usageMeta(context));
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
        model: config.llm.model,
        max_tokens: config.llm.maxTokens?.agent ?? 4096,
        messages,
      };

      if (tools.length > 0) {
        params.tools = tools;
        params.tool_choice = 'auto';
        params.parallel_tool_calls = false;
      }

      response = await createMessage(params, this._usageMeta(context));
      const assistant = getAssistantMessage(response);
      const finishReason = response.choices?.[0]?.finish_reason;

      if (response.usage) {
        totalInputTokens += response.usage.prompt_tokens || 0;
        totalOutputTokens += response.usage.completion_tokens || 0;
      }

      if (finishReason === 'tool_calls' || assistant.tool_calls?.length) {
        const toolCalls = assistant.tool_calls || [];
        messages.push(assistant);

        for (const call of toolCalls) {
          const name = call.function?.name || '';
          const input = parseToolArguments(call.function?.arguments);
          console.log(`  🔧 [${this.name}] → ${name}`);
          const toolStart = Date.now();
          const result = await executeMcpTool(name, input, { agent: this.name, userMessage: message });
          const toolDuration = Date.now() - toolStart;
          toolsUsed.push({
            name,
            input,
            success: result.success,
            durationMs: toolDuration,
            ...(result.success === false && result.error ? { error: String(result.error).slice(0, 300) } : {}),
          });
          if (context._rexRequestId) {
            rex.toolCall(context._rexRequestId, name, toolDuration, result.success);
          }
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify(result),
          });
        }
        continue;
      }

      // Done — no more tool calls
      break;
    }

    const finalText = getResponseText(response);

    console.log(`✅ [${this.name}] done (${iterations} iteration(s), ${toolsUsed.length} tool call(s), ${totalInputTokens + totalOutputTokens} tokens)`);

    return {
      agent: this.name,
      response: finalText,
      rawContent: getAssistantMessage(response),
      toolsUsed,
      usage: {
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
        total_tokens: totalInputTokens + totalOutputTokens,
      },
    };
  }

  /**
   * Run the agent with SSE progress events for tool calls.
   * When context._streamAssistantText is true, final answer tokens stream to
   * the client via onEvent({ type: 'text', content }) — no OutputFormatter.
   *
   * Emits during the tool loop:
   *   { type: 'tool_use',    tool, input }
   *   { type: 'tool_result', tool, success }
   * And when streaming the assistant answer:
   *   { type: 'text', content }
   *
   * @param {string} message
   * @param {object} context
   * @param {(data: object) => void} onEvent - SSE callback for progress events
   * @returns {Promise<{ rawText: string, toolsUsed: object[], toolResultPayloads: object[] }>}
   */
  async runWithEvents(message, context = {}, onEvent = () => {}) {
    const toolHint = [message, context._executionPlanText, context._planText]
      .filter(Boolean)
      .join('\n');
    onEvent({ type: 'status', label: 'Selecting tools…' });
    const tools = await this.getTools(toolHint, this._usageMeta(context));
    const history = Array.isArray(context._conversationHistory)
      ? context._conversationHistory.filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
      : [];
    const historyLength = history.length + 1; // includes the native system message
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

    const finish = (extra = {}) => {
      const usage = {
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
        total_tokens: totalInputTokens + totalOutputTokens,
      };
      return {
        toolsUsed,
        toolResultPayloads,
        usage,
        agentTranscript: extractTurnAgentTranscript(messages, historyLength),
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
        iterations++;
        totalRounds++;

        const params = {
          model: config.llm.model,
          max_tokens: config.llm.maxTokens?.agent ?? 4096,
          messages,
        };
        if (tools.length > 0) {
          params.tools = tools;
          params.tool_choice = 'auto';
          params.parallel_tool_calls = false;
        }

        // Rotate Claude-style keywords over SSE while waiting on the LLM.
        // Stop keyword rotation as soon as assistant text starts streaming.
        const stopKeywords = startActivityKeywordRotation(onEvent);
        const streamText = Boolean(context._streamAssistantText);
        let keywordsStopped = false;
        const stopKeywordsOnce = () => {
          if (keywordsStopped) return;
          keywordsStopped = true;
          stopKeywords();
        };
        const deltaBuf = streamText
          ? createDeltaCoalesceBuffer((chunk) => {
            if (!chunk) return;
            stopKeywordsOnce();
            onEvent({ type: 'text', content: chunk });
          }, { maxDelayMs: 40, maxChars: 96 })
          : null;

        let response;
        try {
          if (streamText) {
            const { completion: streamed } = await streamMessage(
              params,
              this._usageMeta(context),
              (delta) => {
                if (delta) deltaBuf.push(delta);
              },
            );
            response = streamed;
            deltaBuf.flush();
          } else {
            response = await createMessage(params, this._usageMeta(context));
          }
        } finally {
          stopKeywordsOnce();
          if (deltaBuf) deltaBuf.flush();
        }

        if (response.usage) {
          totalInputTokens += response.usage.prompt_tokens || 0;
          totalOutputTokens += response.usage.completion_tokens || 0;
        }

        const assistant = getAssistantMessage(response);
        const finishReason = response.choices?.[0]?.finish_reason;

        if (finishReason === 'length') {
          console.log(`  ⚠️ [${this.name}] finish_reason=length — continuing…`);
          if (assistant.content) messages.push(assistant);
          const partial = getResponseText(response);
          if (partial) lastRawText = `${lastRawText}${partial}`;
          messages.push({ role: 'user', content: TRUNCATED_CONTINUE_NOTE });
          continue;
        }

        if (finishReason === 'tool_calls' || assistant.tool_calls?.length) {
          const toolCalls = assistant.tool_calls || [];
          messages.push(assistant);

          for (const call of toolCalls) {
            const name = call.function?.name || '';
            console.log(`  🔧 [${this.name}] → ${name}`);
            const originalInput = parseToolArguments(call.function?.arguments);
            const normalizedInput = name.startsWith('list_')
              ? normalizeListInput(originalInput)
              : originalInput;
            onEvent({ type: 'tool_use', tool: name, input: normalizedInput });

            if (
              shouldConfirmWrites(context)
              && isWriteTool(name)
              && !usesAgentChatConfirm(name)
              && !context._approvedConfirmations?.includes(call.id)
            ) {
              console.log(`  ⏸️ [${this.name}] ${name} gated — awaiting write confirmation`);
              const confirmationId = await storePendingConfirm(
                context._planRef || {},
                {
                  tool: name,
                  input: normalizedInput,
                  agentKey: this.agentKey,
                  userMessage: message,
                },
              );
              console.log(`  ⏸️ [${this.name}] confirmationId=${confirmationId || 'null'}`);
              onEvent({
                type: 'confirmation_required',
                confirmationId,
                tool: name,
                input: normalizedInput,
              });
              return finish({
                rawText: lastRawText || '',
                needsConfirmation: true,
                confirmationId,
              });
            }

            if (
              name === 'send_sms'
              && draftedSmsThisRun
              && !isSmsChatConfirmMessage(message)
            ) {
              console.log(`  ⏸️ [${this.name}] send_sms blocked — show draft and wait for chat confirm`);
              const blocked = {
                success: false,
                error:
                  'Do not call send_sms in the same turn as draft_sms. '
                  + 'Show To/From/Body to the user and wait for their next message confirming.',
              };
              toolsUsed.push({ name, input: normalizedInput, success: false, error: blocked.error });
              toolResultPayloads.push(blocked);
              onEvent({ type: 'tool_result', tool: name, success: false });
              messages.push({
                role: 'tool',
                tool_call_id: call.id,
                content: JSON.stringify(blocked),
              });
              continue;
            }

            const toolStart = Date.now();
            const result = await executeMcpTool(name, normalizedInput, {
              agent: this.name,
              userMessage: message,
            });
            const toolDuration = Date.now() - toolStart;

            if (name === 'draft_sms' && result?.success !== false) {
              draftedSmsThisRun = true;
            }

            toolsUsed.push({
              name,
              input: normalizedInput,
              success: result.success,
              ...(result.success === false && result.error
                ? { error: String(result.error).slice(0, 300) }
                : {}),
            });
            toolResultPayloads.push(result);
            onEvent({ type: 'tool_result', tool: name, success: result.success });
            if (context._rexRequestId) {
              rex.toolCall(context._rexRequestId, name, toolDuration, result.success);
            }

            messages.push({
              role: 'tool',
              tool_call_id: call.id,
              content: JSON.stringify(result),
            });
          }
          continue;
        }

        // Completed with text (or empty end_turn)
        const rawText = getResponseText(response);
        if (assistant.content) messages.push(assistant);
        lastRawText = rawText || lastRawText;
        console.log(
          `✅ [${this.name}] done (slice ${slice}/${maxSlices}, ${totalRounds} round(s), `
          + `${toolsUsed.length} tool call(s), ${totalInputTokens + totalOutputTokens} tokens)`,
        );
        return finish({ rawText: lastRawText, continued: slice > 1 });
      }

      // Slice tool budget exhausted — try another slice if we still have work signal
      if (toolsUsed.length === 0) break;
      console.log(`⚠️ [${this.name}] slice ${slice} hit max iterations (${maxIterPerSlice})`);
    }

    console.log(`⚠️ [${this.name}] continue budget exhausted (${maxSlices} slices)`);
    const fallbackText = lastRawText
      || 'I hit the tool budget mid-task. Say **continue** and I will resume from here without starting over.';
    return finish({
      rawText: fallbackText,
      needsContinue: true,
      continued: true,
    });
  }

  /**
   * OpenAI messages array: system prompt + prior turns + this user prompt.
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
      return [{ role: 'system', content: this.systemPrompt }, ...history, { role: 'user', content: turnPrompt }];
    }
    return [{ role: 'system', content: this.systemPrompt }, { role: 'user', content: turnPrompt }];
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
