function messageText(content) {
  if (typeof content === 'string') return content;
  if (content == null) return '';
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
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
    `user: ${String(message || '')}`,
    context._executionPlanText,
    context._planText,
  ].filter(Boolean).join('\n');
}

/**
 * Choose the first tool deterministically for workflows where returning text
 * without reading company data would be incorrect. Later rounds use `auto` so
 * the model can call another tool or produce the final answer.
 */
export function initialToolChoice(agentKey, tools, hintText, requireToolUse = false) {
  const names = new Set(
    (tools || []).map((tool) => tool?.function?.name).filter(Boolean),
  );
  const hint = String(hintText || '').toLowerCase();

  if (agentKey === 'reports' || agentKey === 'nova') {
    const invoiceGrounded = /\bforecast(?:ing)?\b|\bpredict(?:ive|ion|ed)?\b|\boutlook\b|\bdemand\b|\binvoices?\b|\bsales\b|\bpurchases?\b/.test(hint);
    if (invoiceGrounded && names.has('generate_invoice_report')) {
      return { type: 'function', function: { name: 'generate_invoice_report' } };
    }
    if (/\bestimates?\b|\bquotes?\b/.test(hint) && names.has('generate_estimate_report')) {
      return { type: 'function', function: { name: 'generate_estimate_report' } };
    }
    if (agentKey === 'reports' && names.size > 0) return 'required';
  }

  return requireToolUse && names.size > 0 ? 'required' : 'auto';
}
