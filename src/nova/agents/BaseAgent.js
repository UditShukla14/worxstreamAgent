/**
 * BaseAgent — reusable agent class that wraps an Anthropic Claude call
 * with a focused system prompt and a filtered subset of MCP tools.
 *
 * Each specialist agent is an instance of BaseAgent constructed from
 * an AGENT_DEFINITIONS entry. The tool registry in src/mcp/server.js
 * stays completely unchanged.
 */

import { config } from '../../config/index.js';
import { createMessage } from '../../llm/anthropicClient.js';
import { usageMetaFromContext } from '../../analytics/usageMeta.js';
import { getAnthropicTools, getAnthropicToolsForToolSearch, executeMcpTool } from '../../mcp/server.js';
import { rex } from './AgentTracker.js';
import { getSoulSystemPrompt } from './soul.js';
import { getToolIndex } from '../../mcp/toolIndex.js';
import {
  normalizeListInput,
} from './policies/listPolicies.js';
import { appendPlaybookToPrompt } from './playbooks.js';
import {
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
    const resumeNote = '\n\nIf [Session focus] shows a failed last action, attempt recovery (correct IDs/parameters) before asking the user to repeat.';
    const lookupNote = '\n\nID RESOLUTION: NEVER ask the user for an internal ID (user, customer, contact, product, vendor, tax, job, project...). When the user gives a name, call the resolve_entity tool (entity_type + the name) — or a domain lookup tool you have — to get the ID yourself. Only ask the user when the lookup finds nothing or returns multiple ambiguous matches (then show the matching names, never raw IDs).';
    // Domain playbooks only for specialists; orchestrator discovers via tools + shared rules.
    this.systemPrompt = this.orchestrator
      ? base + resumeNote + lookupNote
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

    if (toolSearchOn) {
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
        model: config.anthropic.model,
        max_tokens: config.anthropic.maxTokens?.agent ?? 4096,
        system: this.systemPrompt,
        messages,
      };

      if (tools.length > 0) {
        params.tools = tools;
        params.tool_choice = { type: 'auto' };
      }

      response = await createMessage(params, this._usageMeta(context));

      if (response.usage) {
        totalInputTokens += response.usage.input_tokens || 0;
        totalOutputTokens += response.usage.output_tokens || 0;
      }

      if (response.stop_reason === 'tool_use') {
        const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
        messages.push({ role: 'assistant', content: response.content });

        const toolResults = [];
        for (const block of toolUseBlocks) {
          console.log(`  🔧 [${this.name}] → ${block.name}`);
          const toolStart = Date.now();
          const result = await executeMcpTool(block.name, block.input, { agent: this.name, userMessage: message });
          const toolDuration = Date.now() - toolStart;
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
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result),
          });
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
          model: config.anthropic.model,
          max_tokens: config.anthropic.maxTokens?.agent ?? 4096,
          system: this.systemPrompt,
          messages,
        };
        if (tools.length > 0) {
          params.tools = tools;
          params.tool_choice = { type: 'auto' };
        }

        const response = await createMessage(params, this._usageMeta(context));

        if (response.usage) {
          totalInputTokens += response.usage.input_tokens || 0;
          totalOutputTokens += response.usage.output_tokens || 0;
        }

        if (response.stop_reason === 'max_tokens') {
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

        if (response.stop_reason === 'tool_use') {
          const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use');
          messages.push({ role: 'assistant', content: response.content });

          const toolResults = [];
          for (const block of toolUseBlocks) {
            console.log(`  🔧 [${this.name}] → ${block.name}`);
            const originalInput = block.input || {};
            const normalizedInput = block.name?.startsWith('list_')
              ? normalizeListInput(originalInput)
              : originalInput;
            onEvent({ type: 'tool_use', tool: block.name, input: normalizedInput });

            if (
              shouldConfirmWrites(context)
              && isWriteTool(block.name)
              && !usesAgentChatConfirm(block.name)
              && !context._approvedConfirmations?.includes(block.id)
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
              onEvent({ type: 'tool_result', tool: block.name, success: false });
              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: JSON.stringify(blocked),
              });
              continue;
            }

            const toolStart = Date.now();
            const result = await executeMcpTool(block.name, normalizedInput, {
              agent: this.name,
              userMessage: message,
            });
            const toolDuration = Date.now() - toolStart;

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
            onEvent({ type: 'tool_result', tool: block.name, success: result.success });
            if (context._rexRequestId) {
              rex.toolCall(context._rexRequestId, block.name, toolDuration, result.success);
            }

            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(result),
            });
          }
          messages.push({ role: 'user', content: toolResults });
          continue;
        }

        // Completed with text (or empty end_turn)
        const textBlocks = (response.content || []).filter((b) => b.type === 'text');
        const rawText = textBlocks.map((b) => b.text).join('\n');
        if (response.content?.length) {
          messages.push({ role: 'assistant', content: response.content });
        }
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
