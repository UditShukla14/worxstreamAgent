/**
 * Shared coworker rules appended once by BaseAgent.
 * Soft principles only — Claude infers intent from conversation + tool schemas.
 * Do not add phrase→action maps here.
 */

export const COWORKER_SHARED_RULES = `
SHARED TOOL RULES:
- DATE AWARENESS: Context includes the current date. When the user refers to a relative period, compute concrete YYYY-MM-DD bounds and pass the tool's date filter (usually filter.advance with BETWEEN on created_at, or from_date/to_date / payment_date_* when that tool requires them).
- STATUS FILTERING: Never put status labels in filter.search (search is text only). Call list/get with date/text filters; apply status yourself when interpreting or presenting results.
- PAGINATION (hard safety — never dump full datasets into context): Always fetch ONE page at a time (default limit ≤ 25). Never set all_pages or request huge limits — the runtime strips those. If pagination.has_more / next_page is set, show this page and ask whether to load the next page. For counts/totals prefer pagination.total (or a filtered count on the current page) over paging through everything.
- CONTEXT: Infer meaning from the full conversation (prior turns + this message). Reuse IDs and facts already in session context; do not re-lookup what you already have.
- Be concise. Never expose raw internal IDs as the only identifier the user sees.

ANSWER PROPORTIONALITY (LLM judgment from conversation — no phrase→action tables):
- Decide what the user needs from meaning and thread context, the same way Claude/ChatGPT do with tools.
- Prefer the smallest answer that fully satisfies the *current* turn; expand when they want more detail or accept an offer of more detail.
- Match structure to intent: a metric → short prose or one <stat>; a set of records → <table>; one record → <details>; analytics/visuals → charts only when that is what they want.
- Never paste raw tool JSON. Never invent IDs or amounts. Never strip detail they just asked for.
`.trim();

/**
 * Strip duplicated shared-rule paragraphs from a specialist prompt so we do not
 * pay tokens twice after COWORKER_SHARED_RULES is appended.
 * @param {string} prompt
 * @returns {string}
 */
export function stripDuplicatedSharedRules(prompt) {
  let text = String(prompt || '');
  const patterns = [
    /\n?DATE AWARENESS:[^\n]*(?:\n(?![A-Z][A-Z_ ]+:)[^\n]*)*/g,
    /\n?STATUS FILTERING:[^\n]*(?:\n(?![A-Z][A-Z_ ]+:)[^\n]*)*/g,
    /\n?PAGINATION:[^\n]*(?:\n(?![A-Z][A-Z_ ]+:)[^\n]*)*/g,
    /\n?INTER-AGENT:[^\n]*(?:\n(?![A-Z][A-Z_ ]+:)[^\n]*)*/g,
    /\n?ANSWER PROPORTIONALITY:[^\n]*(?:\n(?![A-Z][A-Z_ ]+:)[^\n]*)*/g,
  ];
  for (const re of patterns) {
    text = text.replace(re, '');
  }
  return text.replace(/\n{3,}/g, '\n\n').trim();
}
