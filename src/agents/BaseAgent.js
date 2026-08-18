/**
 * BaseAgent — reusable agent class that wraps an Anthropic Claude call
 * with a focused system prompt and a filtered subset of MCP tools.
 *
 * Each specialist agent is an instance of BaseAgent constructed from
 * an AGENT_DEFINITIONS entry. The tool registry in src/mcp/server.js
 * stays completely unchanged.
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/index.js';
import { getAnthropicTools, getAnthropicToolsForToolSearch, executeMcpTool } from '../mcp/server.js';
import { rex } from './AgentTracker.js';
import { getSoulSystemPrompt } from './soul.js';
import { getToolIndex } from '../mcp/toolIndex.js';
import {
  shouldFetchAllPages,
  inferDesiredStatus,
  normalizeListInput,
  filterRowsByStatus,
} from './policies/listPolicies.js';
import { appendPlaybookToPrompt } from './playbooks.js';
import {
  isWriteTool,
  shouldConfirmWrites,
  storePendingConfirm,
} from './pendingConfirm.js';

const MAX_TOOL_ITERATIONS = Number.isFinite(config.agentRuntime?.maxToolIterations)
  ? config.agentRuntime.maxToolIterations
  : 15;
const MAX_AUTO_PAGES = Number.isFinite(config.agentRuntime?.maxAutoPages)
  ? config.agentRuntime.maxAutoPages
  : 10;

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
    const soul = getSoulSystemPrompt();
    const base = soul
      ? `${soul}\n\n${definition.systemPrompt}`
      : definition.systemPrompt;
    const resumeNote = '\n\nIf [Session focus] shows a failed last action, attempt recovery (correct IDs/parameters) before asking the user to repeat.';
    const lookupNote = '\n\nID RESOLUTION: NEVER ask the user for an internal ID (user, customer, contact, product, vendor, tax, job, project...). When the user gives a name, call the resolve_entity tool (entity_type + the name) — or a domain lookup tool you have — to get the ID yourself. Only ask the user when the lookup finds nothing or returns multiple ambiguous matches (then show the matching names, never raw IDs).';
    this.systemPrompt = appendPlaybookToPrompt(base + resumeNote + lookupNote, definition.domain);
    this.anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });
  }

  /**
   * Returns ONLY this agent's tools from the shared MCP registry.
   */
  getTools() {
    // Nova never calls tools.
    if (this.agentKey === 'nova') return [];

    const index = getToolIndex();

    // Union of the agent's domain buckets (definition.domains beats definition.domain).
    // 'lookup' (resolve_entity) is universal: every agent can resolve names → IDs.
    const domainKeys = (this.domains || [this.domain || this.agentKey])
      .map(d => String(d || '').toLowerCase())
      .concat('lookup');

    const allowSet = new Set();
    for (const key of domainKeys) {
      const bucket = index.byDomain?.[key];
      if (!Array.isArray(bucket)) continue;
      for (const t of bucket) allowSet.add(t.name);
    }

    // Cross-domain helper tools (resolve assignees, customers, products, taxes
    // referenced by name) so single-domain agents don't have to ask the user
    // for IDs that another domain's lookup tool can provide.
    const registered = new Set(index.tools.map((t) => t.name));
    for (const name of this.extraTools) {
      if (registered.has(name)) {
        allowSet.add(name);
      } else {
        console.error(`❌ [${this.name}] extraTools entry "${name}" is not a registered tool`);
      }
    }

    // Never fall back to ALL tools: an empty bucket is a domain-mapping bug
    // (see src/mcp/toolCapabilities.js), not a reason to expose ~193 tools.
    if (allowSet.size === 0) {
      console.error(`❌ [${this.name}] no tools in domain bucket(s) [${domainKeys.join(', ')}] — check DOMAIN_RULES in src/mcp/toolCapabilities.js; running with NO tools`);
      return [];
    }

    const allowList = [...allowSet];

    // Prefer tool-search mode when enabled, scoped to allowed tools.
    if (config.anthropic.useToolSearch) {
      return getAnthropicToolsForToolSearch(allowList);
    }

    // Otherwise, pass domain-filtered tools to Anthropic.
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

      response = await this.anthropic.messages.create(params);

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
    const messages = this._buildInitialMessages(message, context);

    let iterations = 0;
    const toolsUsed = [];
    const toolResultPayloads = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

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

      const response = await this.anthropic.messages.create(params);

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
          const originalInput = block.input || {};
          const normalizedInput = block.name?.startsWith('list_')
            ? normalizeListInput(originalInput)
            : originalInput;
          onEvent({ type: 'tool_use', tool: block.name, input: normalizedInput });

          if (
            shouldConfirmWrites(context)
            && isWriteTool(block.name)
            && !context._approvedConfirmations?.includes(block.id)
          ) {
            const confirmationId = await storePendingConfirm(
              context._planRef || {},
              {
                tool: block.name,
                input: normalizedInput,
                agentKey: this.agentKey,
                userMessage: message,
              },
            );
            onEvent({
              type: 'confirmation_required',
              confirmationId,
              tool: block.name,
              input: normalizedInput,
            });
            return {
              rawText: '',
              toolsUsed,
              toolResultPayloads,
              usage: {
                input_tokens: totalInputTokens,
                output_tokens: totalOutputTokens,
                total_tokens: totalInputTokens + totalOutputTokens,
              },
              needsConfirmation: true,
              confirmationId,
            };
          }

          const toolStart = Date.now();
          let result = await executeMcpTool(block.name, normalizedInput, { agent: this.name, userMessage: message });
          const toolDuration = Date.now() - toolStart;

          // Runtime policy: if user asked for "all" and this is a list_* tool with pagination,
          // auto-fetch additional pages up to a safe cap and merge results.
          if (block.name?.startsWith('list_') && result?.success) {
            const wantsAll = shouldFetchAllPages(message);
            if (wantsAll) {
              try {
                const textBlock = result?.content?.find((c) => c?.type === 'text');
                const parsed = textBlock?.text ? JSON.parse(textBlock.text) : null;
                const payload = parsed?.data;
                const pagination = payload?.pagination;
                const currentPage = pagination?.currentPage ?? normalizedInput.page ?? 1;
                const lastPage = pagination?.lastPage;
                const limit = normalizedInput.take ?? normalizedInput.limit ?? 25;

                if (Number.isFinite(currentPage) && Number.isFinite(lastPage) && currentPage < lastPage) {
                  const combined = Array.isArray(payload?.data) ? [...payload.data] : [];
                  const maxPages = Math.min(MAX_AUTO_PAGES, Math.max(1, lastPage - currentPage));

                  for (let p = currentPage + 1; p <= lastPage && p < currentPage + 1 + maxPages; p++) {
                    const nextInput = { ...normalizedInput, page: p };
                    const next = await executeMcpTool(block.name, nextInput, { agent: this.name, userMessage: message });
                    if (!next?.success) break;
                    const nextText = next?.content?.find((c) => c?.type === 'text')?.text;
                    const nextParsed = nextText ? JSON.parse(nextText) : null;
                    const nextRows = Array.isArray(nextParsed?.data?.data) ? nextParsed.data.data : [];
                    combined.push(...nextRows);
                    if (Number.isFinite(limit) && limit > 0 && nextRows.length < limit) break;
                  }

                  // Optional: apply status filtering for common status requests (open/paid/etc.)
                  const desiredStatus = inferDesiredStatus(message);
                  const filtered = filterRowsByStatus(combined, desiredStatus);

                  const merged = {
                    ...parsed,
                    data: {
                      ...payload,
                      data: filtered,
                      pagination: {
                        ...(pagination || {}),
                        aggregated: true,
                        aggregatedPagesMax: MAX_AUTO_PAGES,
                        aggregatedCount: filtered.length,
                        requestedAll: true,
                      },
                    },
                  };

                  result = {
                    ...result,
                    content: [{ type: 'text', text: JSON.stringify(merged, null, 2) }],
                  };
                }
              } catch {
                // If parsing/merging fails, fall back to the original result.
              }
            }
          }

          toolsUsed.push({
            name: block.name,
            input: normalizedInput,
            success: result.success,
            ...(result.success === false && result.error ? { error: String(result.error).slice(0, 300) } : {}),
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

      // No more tool calls — collect raw text
      const textBlocks = response.content.filter(b => b.type === 'text');
      const rawText = textBlocks.map(b => b.text).join('\n');

      const usage = {
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
        total_tokens: totalInputTokens + totalOutputTokens,
      };
      console.log(`✅ [${this.name}] done (${iterations} iteration(s), ${toolsUsed.length} tool call(s), ${usage.total_tokens} tokens)`);
      return { rawText, toolsUsed, toolResultPayloads, usage };
    }

    console.log(`⚠️ [${this.name}] hit max iterations (${MAX_TOOL_ITERATIONS})`);
    const usage = {
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
      total_tokens: totalInputTokens + totalOutputTokens,
    };
    return { rawText: '', toolsUsed, toolResultPayloads, usage };
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
