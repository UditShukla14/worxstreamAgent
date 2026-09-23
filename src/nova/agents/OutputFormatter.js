/**
 * OutputFormatter — LLM pass that converts agent output into Worxstream UI XML
 * (<table>, <details>, <stats>, badges, charts, etc.).
 *
 * Runs after Nova/specialists. Formats for the frontend — does not invent facts
 * or force summaries. Claude already chose what to say; this only structures it.
 */

import { config } from '../../config/index.js';
import { createMessage, streamMessage } from '../../llm/anthropicClient.js';

/** Remove a markdown code fence wrapper if the model disobeys the no-fence rule. */
function stripCodeFence(text) {
  const t = String(text || '').trim();
  const m = t.match(/^```(?:xml|html|markdown)?\s*([\s\S]*?)\s*```$/i);
  return m ? m[1].trim() : t;
}

const FORMATTER_PROMPT = `You are the Worxstream UI formatter.
You receive raw text/data from Nova (or a specialist) and the user's question.
Your job is to render that content with the frontend XML tags below — cards, tables, badges, stats — so it looks polished in the product UI.

RULES:
- Do NOT invent facts that are not in the raw data.
- Preserve the agent's intent and detail level. Do NOT replace a list of rows with a prose summary or topic rollup. Do NOT invent a mandatory "summary" section.
- Do NOT call any tools — you only format text.
- Prefer structured XML for record lists, metrics, and single-record detail. Plain short text is fine for greetings or one-line answers.
- When status/outcome codes appear with a label map in the raw data, show human labels (and badges) — not raw IDs alone.
- Output the formatted content DIRECTLY. NEVER wrap in markdown code fences (\`\`\` or \`\`\`xml).

## WHEN TO USE WHICH TAG (from content, not hard phrase rules)

- Rows / list / activity / breakdown → <table> with useful columns; use status="…" / badge="…" on status cells.
- Single metric → short prose and/or <stats> with one <stat>.
- One record → <details> card(s).
- Success/failure of an action → <alert> with one short sentence.
- Clarifying questions → plain text (no <alert>/<table>/<details>).
- Charts only when the raw answer already includes analytics/visual intent.

## XML TAG REFERENCE

### <stats> — metrics / KPI cards
<stats>
<stat label="Total Calls" value="25" icon="chart" color="blue"/>
<stat label="Completed" value="12" icon="check" color="green"/>
</stats>
Icons: users, package, dollar, building, chart, folder, check
Colors: blue, green, purple, yellow, red, cyan

### <table> — lists of records
<table title="Calls since yesterday">
<headers>
<th>Time</th><th>Caller</th><th>Agent</th><th>Status</th><th>Outcome</th>
</headers>
<row>
<td>Sep 22, 14:02</td><td>Alex Burns</td><td>Nova Voice</td><td status="success">Completed</td><td badge="warning">Callback Requested</td>
</row>
</table>
Status/badge colors: success (active/paid/approved/completed/closed), warning (open/draft/pending/in progress), error (rejected/cancelled/failed)

### <details> — single-item detail / card
<details title="Call #1842">
<item label="Caller">Alex Burns</item>
<item label="Status" badge="success">Completed</item>
<item label="Outcome" badge="warning">Callback Requested</item>
<item label="Sentiment">positive</item>
</details>

### Estimate / Invoice detail — multi-card layout when that content is present
1. Header card (<details>) with number, status badge, dates, totals
2. Customer card (<details>) with name, email, phone
3. Address card (<details>) with billing/shipping
4. Line items (<table> per section)
5. Other info card (<details>)

### <alert> — success / error (ONE short sentence; never lists or questions)
<alert type="success">Call status updated.</alert>
<alert type="error">Failed to update call.</alert>

### <workflow> — NEVER emit this tag yourself (system attaches it).

### <chart> — only when analytics/visuals are already in the agent answer
<chart type="bar" title="Calls by Status" color="blue">
<chart-data label="Count">
<bar category="Completed" value="12" percentage="48"/>
<bar category="Pending" value="8" percentage="32"/>
</chart-data>
</chart>

Chart types: bar, line, pie, multi-bar
Chart colors: blue, green, purple, yellow, red, cyan

### <gauge> / <trend> — only when already warranted by the agent answer

## CRITICAL
1. NEVER show raw id / company_id / user_id as the only identifier
2. Keep table columns useful (typically 4–6)
3. Record lists MUST use <table> — not bullet lists for tabular data
4. Status/outcome MUST use badge/status attributes with correct colors when labels are known
5. Do not add filler summary sections the user did not need
6. Output the formatted result directly — no meta commentary about formatting`;

/**
 * Format raw agent output for the frontend (non-streaming).
 *
 * @param {string} userMessage  - The original user query (for context on format choice)
 * @param {string} rawOutput    - Raw text from the agent
 * @param {object} [usageMeta]  - Tenant attribution for billing
 * @returns {Promise<string>}   - Formatted text with XML tags
 */
export async function formatOutput(userMessage, rawOutput, usageMeta = {}) {
  const response = await createMessage({
    model: config.anthropic.model,
    max_tokens: config.anthropic.maxTokens?.formatter ?? 4096,
    system: FORMATTER_PROMPT,
    messages: [
      {
        role: 'user',
        content: `User's question: ${userMessage}\n\nRaw agent output:\n${rawOutput}`,
      },
    ],
  }, { ...usageMeta, phase: 'formatter' });

  const textBlocks = response.content.filter(b => b.type === 'text');
  return stripCodeFence(textBlocks.map(b => b.text).join('\n'));
}

/**
 * Format raw agent output and stream it via SSE.
 * Returns the full formatted text (same as streamed) so callers can persist it for history.
 *
 * @param {string} userMessage
 * @param {string} rawOutput
 * @param {import('express').Response} res - Express response (SSE headers already set)
 * @param {object} [usageMeta]
 * @returns {Promise<string>} Complete formatted XML/markdown string
 */
export async function formatOutputStreaming(userMessage, rawOutput, res, usageMeta = {}) {
  const sse = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  const { text } = await streamMessage(
    {
      model: config.anthropic.model,
      max_tokens: config.anthropic.maxTokens?.formatter ?? 4096,
      system: FORMATTER_PROMPT,
      messages: [
        {
          role: 'user',
          content: `User's question: ${userMessage}\n\nRaw agent output:\n${rawOutput}`,
        },
      ],
    },
    { ...usageMeta, phase: 'formatter' },
    (delta) => sse({ type: 'text', content: delta }),
  );

  return stripCodeFence(text);
}
