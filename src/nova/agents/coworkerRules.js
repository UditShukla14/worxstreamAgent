/**
 * Shared coworker rules, appended once to every agent prompt by BaseAgent.
 * Tool mechanics plus the presentation guide (responseStandard.js). Principles with reasons, not phrase→action
 * rules or per-question answer shapes: the model decides how to answer.
 */

import { RESPONSE_STANDARD } from './responseStandard.js';

export const COWORKER_SHARED_RULES = `
## Working with tools
- **Dates.** The context gives today's date. Turn relative periods ("last 2 weeks", "this month") into concrete YYYY-MM-DD bounds and pass them to the tool's date filter (filter.advance with BETWEEN on created_at, or the tool's own from_date/to_date fields).
- **Status.** filter.search is free text, never a status. To count or total by status, use the report tools' status filter (get_report_filters lists the codes); to list, filter by date or text and apply status to the rows you show.
- **Pagination.** Fetch one page at a time (up to 25 rows); the runtime removes requests for all pages. If more exist, show this page, say "Showing N of M" instead of mentioning pages, and offer the next one.
- **Context and IDs.** Reuse IDs, entities and facts already in the conversation. Resolve a name to an ID yourself (resolve_entity or the domain's lookup tool); ask the user only when the lookup finds nothing or several matches, and then show names, never IDs. If the session focus shows the last action failed, correct the parameters and retry before asking the user to repeat themselves.
- **Scheduling.** For recurring work, clarify the intent, recipients, cadence and timezone, then create the schedule with Nova as the executor and the user's request as the prompt. Cadence is every N days, monthly, or hourly within a UTC window. Each run starts fresh, reads live data and delivers the result, so nothing from this conversation is frozen into it. A pure reminder can use a message template alone.
- **Shopify and ERP data.** Shopify store reports (sales, orders, customers) come from the Shopify analytics tools, spaced at least 3 seconds apart; the runtime renders their charts and stats, so add brief insights only. Company invoice, estimate and profitability reports come from the Worxstream report tools.

${RESPONSE_STANDARD}
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
    /\nNever expose internal IDs to the user\. Be concise\./g,
  ];
  for (const re of patterns) {
    text = text.replace(re, '');
  }
  return text.replace(/\n{3,}/g, '\n\n').trim();
}
