/**
 * Shared coworker rules appended once by BaseAgent.
 * Tool/safety mechanics only — Claude chooses answer shape from conversation
 * (same as ChatGPT/Claude tool chat). Do not add phrase→action or shape taxonomies.
 */

export const COWORKER_SHARED_RULES = `
SHARED TOOL RULES:
- DATE AWARENESS: Context includes the current date. When the user refers to a relative period, compute concrete YYYY-MM-DD bounds and pass the tool's date filter (usually filter.advance with BETWEEN on created_at, or from_date/to_date / payment_date_* / created_from+created_to when that tool requires them).
- STATUS FILTERING: Never put status labels in filter.search (search is text only). Call list/get with date/text filters; apply status yourself when interpreting or presenting results.
- PAGINATION (hard safety — never dump full datasets into context): Always fetch ONE page at a time (default limit ≤ 25). Never set all_pages or request huge limits — the runtime strips those. If pagination.has_more / next_page is set, show this page and ask whether to load the next page.
- CONTEXT: Infer meaning from the full conversation (prior turns + this message). Reuse IDs and facts already in session context; do not re-lookup what you already have.
- Answer naturally from conversation and tool results (like ChatGPT/Claude). Use UI tags (<table>, <stats>, <details>, <chart>, <alert>) when they help; never paste raw tool JSON; never invent IDs or amounts; never expose raw internal IDs as the only label the user sees.
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
