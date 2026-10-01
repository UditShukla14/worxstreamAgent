import { shouldRequireToolUse } from './intentPolicy.js';
import { detectToolIntent } from '../../mcp/selectToolsForTurn.js';

function messageText(content) {
  if (typeof content === 'string') return content;
  if (content == null) return '';
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

function currentIntentText(hintText) {
  const hint = String(hintText || '');
  const marker = hint.lastIndexOf('[Current user]');
  if (marker < 0) return hint;
  const current = hint
    .slice(marker + '[Current user]'.length)
    .split(/\n\[Execution plan\]|\n\[Plan\]/i)[0]
    .trim();
  return /^(yes|yep|yeah|ok|okay|sure|go ahead|do it|continue|proceed)[.!\s]*$/i.test(current)
    ? hint
    : current;
}

/** Include recent conversational intent so short follow-ups such as "yes" do
 * not lose the report/forecast requested in the preceding turn. */
export function buildToolSelectionHint(message, context = {}) {
  const recent = Array.isArray(context._conversationHistory)
    ? context._conversationHistory
      .filter((item) => item?.role === 'user' || item?.role === 'assistant')
      .slice(-4)
      .map((item) => `${item.role}: ${messageText(item.content).slice(0, 1200)}`)
    : [];
  return [
    ...recent,
    `[Current user]\n${String(message || '')}`,
    context._executionPlanText,
    context._planText,
  ].filter(Boolean).join('\n');
}

/**
 * Choose the first tool deterministically for workflows where returning text
 * without reading company data would be incorrect. Later rounds use `auto` so
 * the model can call another tool or produce the final answer.
 */
export function initialToolChoice(agentKey, tools, hintText, requireToolUse = null) {
  const names = new Set(
    (tools || []).map((tool) => tool?.function?.name).filter(Boolean),
  );
  const intentText = currentIntentText(hintText).toLowerCase();

  if (agentKey === 'reports' || agentKey === 'nova') {
    const invoiceGrounded = /\bforecast(?:ing)?\b|\bpredict(?:ive|ion|ed)?\b|\boutlook\b|\bdemand\b|\binvoices?\b|\bsales\b|\bpurchases?\b/.test(intentText);
    if (invoiceGrounded && names.has('generate_invoice_report')) {
      return { type: 'function', function: { name: 'generate_invoice_report' } };
    }
    if (/\bestimates?\b|\bquotes?\b/.test(intentText) && names.has('generate_estimate_report')) {
      return { type: 'function', function: { name: 'generate_estimate_report' } };
    }
    if (agentKey === 'reports' && names.size > 0) return 'required';
  }

  const mustUseTool = shouldRequireToolUse(agentKey, hintText, requireToolUse);
  if (mustUseTool) {
    const intent = detectToolIntent(intentText);
    const ranked = [...names]
      .map((name) => {
        let score = 0;
        for (const operation of intent.operationHints) {
          if (name.startsWith(`${operation}_`) || name.includes(`_${operation}_`)) score += 18;
        }
        for (const entity of intent.entityHints) {
          if (name.includes(entity)) score += 10;
        }
        return { name, score };
      })
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    if (ranked[0]?.score >= 25 && ranked[0].score >= (ranked[1]?.score || 0) + 4) {
      return { type: 'function', function: { name: ranked[0].name } };
    }
  }
  return mustUseTool && names.size > 0 ? 'required' : 'auto';
}
