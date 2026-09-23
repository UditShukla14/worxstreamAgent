/**
 * GovernanceAgent — Control Tower runtime (Aegis).
 *
 * Intentionally separate from Nova's BaseAgent: no SOUL.md, no domain playbooks,
 * no write-confirm, no list pagination policies, no coworker working-memory notes.
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../config/index.js';
import { getAnthropicTools, executeMcpTool } from '../../mcp/server.js';
import { getToolIndex } from '../../mcp/toolIndex.js';

const MAX_TOOL_ITERATIONS = Number.isFinite(config.agentRuntime?.maxToolIterations)
  ? config.agentRuntime.maxToolIterations
  : 15;

export class GovernanceAgent {
  /**
   * @param {string} agentKey
   * @param {object} definition
   */
  constructor(agentKey, definition) {
    this.agentKey = agentKey;
    this.name = definition.name;
    this.description = definition.description;
    this.domain = definition.domain || 'governance';
    this.domains = Array.isArray(definition.domains) && definition.domains.length > 0
      ? definition.domains
      : null;
    this.extraTools = Array.isArray(definition.extraTools) ? definition.extraTools : [];
    this.systemPrompt = String(definition.systemPrompt || '');
    this.anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });
  }

  getTools() {
    const index = getToolIndex();
    const domainKeys = (this.domains || [this.domain || this.agentKey])
      .map((d) => String(d || '').toLowerCase());

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

    // Never expose invoke_agent (removed) or chat specialist orchestration.
    allowSet.delete('invoke_agent');

    if (allowSet.size === 0) {
      console.error(`❌ [${this.name}] no tools in domain bucket(s) [${domainKeys.join(', ')}]`);
      return [];
    }

    return getAnthropicTools([...allowSet]);
  }

  /**
   * @param {string} message
   * @param {object} [context]
   */
  async run(message, context = {}) {
    const tools = this.getTools();
    const messages = this._buildInitialMessages(message, context);

    let response;
    let iterations = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    const toolsUsed = [];

    console.log(`\n🛡️  [${this.name}] started (${tools.length} tools)`);

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
        const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use');
        messages.push({ role: 'assistant', content: response.content });

        const toolResults = [];
        for (const block of toolUseBlocks) {
          console.log(`  🔧 [${this.name}] → ${block.name}`);
          const toolStart = Date.now();
          const result = await executeMcpTool(block.name, block.input, {
            agent: this.name,
            userMessage: message,
          });
          const toolDuration = Date.now() - toolStart;
          toolsUsed.push({
            name: block.name,
            input: block.input,
            success: result.success,
            durationMs: toolDuration,
            ...(result.success === false && result.error
              ? { error: String(result.error).slice(0, 300) }
              : {}),
          });
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result),
          });
        }
        messages.push({ role: 'user', content: toolResults });
        continue;
      }

      break;
    }

    const textBlocks = response.content.filter((b) => b.type === 'text');
    const finalText = textBlocks.map((b) => b.text).join('\n');

    console.log(
      `✅ [${this.name}] done (${iterations} iteration(s), ${toolsUsed.length} tool call(s), ${totalInputTokens + totalOutputTokens} tokens)`,
    );

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

  _buildInitialMessages(message, context = {}) {
    const turnPrompt = this._buildPrompt(message, context);
    return [{ role: 'user', content: turnPrompt }];
  }

  _buildPrompt(message, context) {
    const parts = [];
    if (context.fromAgent) {
      parts.push(`[Delegated from ${context.fromAgent}]`);
      if (context.reason) parts.push(`Context: ${context.reason}`);
    }
    if (parts.length > 0) {
      parts.push('', `Request: ${message}`);
      return parts.join('\n');
    }
    return message;
  }
}
