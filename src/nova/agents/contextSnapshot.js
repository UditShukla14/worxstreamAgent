/**
 * Per-turn context snapshot persisted in ConversationTurn.log.usage.context and
 * served by GET /api/agents/conversations/:id/context.
 *
 * `used_tokens` is EXACT when the model reported usage (last request's
 * input + cache read + cache creation); category breakdown is estimated.
 */

import { computeContextBudget } from '../../utils/contextBudget.js';
import { countTokens, countToolsTokens, countMessagesTokens } from '../../utils/tokenCounter.js';

/**
 * @param {object} p
 * @param {string} p.model
 * @param {object} [p.usage]        - result.usage from BaseAgent (has last_call, context_clears)
 * @param {object} [p.plan]         - history window plan from planContextWindow
 * @param {string} [p.systemPrompt]
 * @param {object[]} [p.tools]
 * @param {string} [p.contextText]  - per-turn context block (summary, prefs, working set…)
 * @param {string} [p.summary]
 * @param {number} [p.reservedOutput]
 */
export function buildContextSnapshot({ model, usage, plan, systemPrompt = '', tools = [], contextText = '', summary = '', reservedOutput }) {
  const budget = computeContextBudget({ model, reservedOutput });
  const last = usage?.last_call || null;
  const measured = last ? last.input_tokens : null;

  const breakdown = {
    system_prompt: countTokens(systemPrompt),
    tools: countToolsTokens(tools),
    summary: countTokens(summary),
    context_block: Math.max(0, countTokens(contextText) - countTokens(summary)),
    history: plan?.tokens ?? 0,
  };
  const estimated = Object.values(breakdown).reduce((a, b) => a + b, 0);
  const used = measured ?? estimated;

  return {
    model: last?.model || model,
    context_window: budget.contextWindow, // the model's real window
    working_window: budget.workingWindow, // what the chat works within (shown to the user)
    reserved_tokens: budget.reserved, // set aside for the reply and compaction
    usable_budget: budget.usable,
    reserved_output: budget.reservedOutput,
    limits_source: budget.limitsSource,
    used_tokens: used,
    used_is_exact: measured != null,
    used_pct_of_window: Number(((used / budget.contextWindow) * 100).toFixed(2)),
    used_pct_of_budget: Number(((used / budget.usable) * 100).toFixed(2)),
    free_tokens: Math.max(0, budget.usable - used),
    cache_read_tokens: last?.cache_read_input_tokens ?? 0,
    cache_write_tokens: last?.cache_creation_input_tokens ?? 0,
    thresholds: { soft: budget.soft, hard: budget.hard },
    breakdown_estimated: breakdown,
    history_turns_kept: plan?.keptTurns ?? null,
    history_turns_dropped: plan?.droppedTurns ?? 0,
    tool_results_cleared: usage?.context_clears ?? 0,
  };
}

export { countMessagesTokens };
