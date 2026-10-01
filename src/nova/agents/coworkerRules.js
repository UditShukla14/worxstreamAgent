/**
 * Shared coworker rules appended once by BaseAgent.
 * Tool/safety mechanics + presentation hints — the primary LLM decides
 * how to answer (like ChatGPT/Claude). No separate OutputFormatter pass.
 */

export const COWORKER_SHARED_RULES = `
SHARED TOOL RULES:
- DATE AWARENESS: Context includes the current date. When the user refers to a relative period, compute concrete YYYY-MM-DD bounds and pass the tool's date filter (usually filter.advance with BETWEEN on created_at, or from_date/to_date / payment_date_* / created_from+created_to when that tool requires them).
- STATUS FILTERING: Never put status labels in filter.search (search is text only). Call list/get with date/text filters; apply status yourself when interpreting or presenting results.
- PAGINATION (hard safety — never dump full datasets into context): Always fetch ONE page at a time (about 25–30 rows; default limit ≤ 25). Never set all_pages or request huge limits — the runtime strips those. Show this page as a table (one row per returned item), put the total in a stat or title (e.g. "Showing 25 of 937"), and if pagination.has_more / next_page is set, proactively ask whether to load the next set (e.g. "Want me to load the next 25?"). Never replace the page with a count-only summary or an empty table shell.
- CONTEXT: Infer meaning from the full conversation (prior turns + this message). Reuse IDs and facts already in session context; do not re-lookup what you already have.
- Answer naturally from conversation and tool results (like ChatGPT/Claude). Never paste raw tool JSON; never invent IDs or amounts; never expose raw internal IDs as the only label the user sees.

PRESENTATION (you decide — same freedom as ChatGPT/Claude):
- Choose the clearest shape for the user: plain prose, a metric row, a table, a chart, or a detail card. Mix freely when it helps.
- Prefer structured tags when they improve scanability; otherwise use normal sentences.
- Record lists → <table title="…"> with <headers><th>…</th></headers> and one <row><td>…</td></row> per returned item. Optional status="success|warning|error|info" or badge="…" on cells.
- KPIs → <stats><stat label="…" value="…" icon="chart|users|package|dollar|building|folder|check" color="blue|green|purple|yellow|red|cyan"/></stats>
- One record → <details title="…"><item label="…">value</item></details>
- Analytics the user asked to visualize → <chart type="bar|line|pie" title="…" color="blue">…</chart> with <chart-data> / <bar|point|slice> children as appropriate.
- Short success/failure → <alert type="success|error|warning|info">one sentence</alert>
- Clarifying questions → plain text only (no alert/table).
- Output tags DIRECTLY — never wrap the whole answer in markdown code fences (\`\`\`xml).
- Finish each tag before starting the next. Do not truncate mid-tag.
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
    /\n?PRESENTATION[^\n]*(?:\n(?![A-Z][A-Z_ ]+:)[^\n]*)*/g,
  ];
  for (const re of patterns) {
    text = text.replace(re, '');
  }
  return text.replace(/\n{3,}/g, '\n\n').trim();
}
