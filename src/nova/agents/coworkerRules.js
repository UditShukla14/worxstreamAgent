/**
 * Shared coworker rules appended once by BaseAgent.
 * Keep specialist systemPrompts domain-specific — do not duplicate these blocks there.
 */

export const COWORKER_SHARED_RULES = `
SHARED TOOL RULES (all specialists):
- DATE AWARENESS: You receive the current date in context. For "last month", "this week", "last quarter", "YTD", compute YYYY-MM-DD and pass the tool's date filter (usually filter.advance with BETWEEN on created_at, or from_date/to_date / payment_date_* when that tool requires them).
- STATUS FILTERING: Never put status labels (draft, paid, approved, open, …) in filter.search. Search is for text only. Call list/get with date/text filters only; filter by status when presenting results (runtime may also filter).
- INTER-AGENT: When prior agent context already has customer_id or other IDs, reuse them. Do not repeat equivalent lookups (e.g. get_customer_dropdown) for data already in context.
- Be concise. Never expose raw internal IDs as the only identifier the user sees.

ANSWER PROPORTIONALITY (LLM-controlled — apply to every kind of question and phrasing; do not hardcode phrase lists):
- Match response length and structure to what the user asked. Prefer the minimum tools and the minimum output that fully answers.
- Counts / totals / "how many" / volume questions → short answer (one sentence and/or a single <stat>). Do NOT dump every matching row or build a full report unless they asked to list or report.
- List / show / which questions → table (or short list) of the relevant rows.
- Detail questions → one record's details.
- Report / analytics / chart / trends / overview / dashboard → richer visuals only then.
- Tools return facts; you own the narrative. Never paste raw tool JSON. Never expand a simple question into a full analytics pack by default.
`.trim();

/**
 * Strip duplicated shared-rule paragraphs from a specialist prompt so we do not
 * pay tokens twice after COWORKER_SHARED_RULES is appended.
 * @param {string} prompt
 * @returns {string}
 */
export function stripDuplicatedSharedRules(prompt) {
  let text = String(prompt || '');
  // Remove common duplicated section headers + following paragraph(s) until blank line or next ALLCAPS header / TOOL USAGE
  const patterns = [
    /\n?DATE AWARENESS:[^\n]*(?:\n(?![A-Z][A-Z_ ]+:)[^\n]*)*/g,
    /\n?STATUS FILTERING:[^\n]*(?:\n(?![A-Z][A-Z_ ]+:)[^\n]*)*/g,
    /\n?INTER-AGENT:[^\n]*(?:\n(?![A-Z][A-Z_ ]+:)[^\n]*)*/g,
    /\n?ANSWER PROPORTIONALITY:[^\n]*(?:\n(?![A-Z][A-Z_ ]+:)[^\n]*)*/g,
  ];
  for (const re of patterns) {
    text = text.replace(re, '');
  }
  return text.replace(/\n{3,}/g, '\n\n').trim();
}
