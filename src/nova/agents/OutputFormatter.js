/**
 * OutputFormatter — optional LLM pass that converts raw agent output into
 * structured XML (<table>, <details>, <stats>, etc.).
 *
 * Used on the legacy specialists path. Default orchestrator mode skips this
 * (Nova emits UI tags directly — Claude/OpenAI-style, fewer tokens).
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../config/index.js';

const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });

/** Remove a markdown code fence wrapper if the model disobeys the no-fence rule. */
function stripCodeFence(text) {
  const t = String(text || '').trim();
  const m = t.match(/^```(?:xml|html|markdown)?\s*([\s\S]*?)\s*```$/i);
  return m ? m[1].trim() : t;
}

const FORMATTER_PROMPT = `You are a strict output formatter for Worxstream UI.
You receive raw data/text from a specialist agent and the user's original question.
Your job is to synthesize a proportional answer for the UI — structured XML when useful, plain short text when that is enough.

RULES:
- Do NOT invent facts that are not in the raw data.
- Infer intent from the user's current message and conversation context (Claude-style) — not from fixed phrase lists.
- SYNTHESIZE: you MAY omit rows, columns, charts, and filler that do not answer what they need *now*. Prefer the smallest faithful answer — but never strip detail they asked for or accepted.
- Do NOT call any tools — you only format/synthesize text.
- Keep useful conversational sentences the agent wrote when they answer the question.
- Be concise. No filler.
- Output the formatted content DIRECTLY. NEVER wrap your output in markdown code fences (\`\`\` or \`\`\`xml) — the frontend renders your output as-is, and fences appear as literal text.

## ANSWER SHAPE (LLM judgment — match intent, not keywords)

- **Metric / count / total only**: short sentence and/or a single <stat>. No full row dump. No charts.
- **Set of records / breakdown / comparison across rows**: <table> with useful columns. Do not collapse to a lone <stat>.
- **Follow-up that wants more detail** (including accepting a prior offer): richer shape from the raw data (<table> or <details>). Do not re-apply an earlier shorter shape.
- **Overview / dashboard-style summary**: <stats>; short <table> only if it helps.
- **Analytics / trends / charts**: <chart> + <stats>; <table> optional.
- **One record**: <details>.
- **Completed action or failure**: <alert> with ONE brief sentence.
- **Clarifying questions**: plain conversational text — never <alert>/<table>/<details> for questions.

If raw data is huge but intent is only a metric, state the answer and discard the row dump.
If intent is a breakdown/list/expand, keep the rows.
## XML TAG REFERENCE

### <stats> — metrics / KPI cards
<stats>
<stat label="Total Invoices" value="6" icon="dollar" color="blue"/>
<stat label="Open" value="4" icon="chart" color="yellow"/>
</stats>
Icons: users, package, dollar, building, chart, folder, check
Colors: blue, green, purple, yellow, red, cyan

### <table> — lists of records (when the user asked to list/show)
<table title="Open Invoices">
<headers>
<th>Number</th><th>Customer</th><th>Date</th><th>Total</th><th>Status</th>
</headers>
<row>
<td>INV-4</td><td>Acme Corp</td><td>Dec 3, 2025</td><td>$5,664.00</td><td status="warning">Open</td>
</row>
</table>
Status colors: status="success" (active/paid/approved/closed), status="warning" (open/draft/pending), status="error" (rejected/cancelled/inactive)

### <details> — single-item detail view
<details title="Invoice INV-4 Details">
<item label="Number">INV-4</item>
<item label="Status" badge="warning">Open</item>
<item label="Grand Total">$5,664.00</item>
</details>
Badge colors: badge="success", badge="warning", badge="error"

### Estimate / Invoice detail — special multi-card layout
1. Header card (<details>) with number, status badge, dates, totals
2. Customer card (<details>) with name, email, phone
3. Address card (<details>) with billing/shipping
4. Line items (<table> per section)
5. Other info card (<details>) with job, currency, etc.

### <alert> — success / error messages (ONE short sentence only; never lists or questions)
<alert type="success">Invoice created successfully!</alert>
<alert type="error">Failed to create invoice.</alert>

### <workflow> — NEVER emit this tag yourself
Workflow tree visualizations are attached automatically by the system after your output.
For workflow tree/hierarchy/flow queries, write ONE short intro sentence
(e.g. "Here's the document flow for estimate 26-3000:") — do NOT reproduce the
tree JSON and do NOT enumerate the nodes in text.

### <chart> — only when the user asked for report/chart/analytics/trends
<chart type="bar" title="Monthly Sales" color="blue">
<chart-data label="Sales ($)">
<bar category="Jan" value="50000" percentage="80"/>
<bar category="Feb" value="62500" percentage="100"/>
</chart-data>
</chart>

<chart type="line" title="Sales Trend" color="green">
<chart-data label="Revenue ($)">
<point period="Q1" value="150000"/>
<point period="Q2" value="180000"/>
</chart-data>
</chart>

<chart type="pie" title="Sales by Status">
<chart-data label="Amount">
<slice label="Paid" value="75000" percentage="60"/>
<slice label="Pending" value="50000" percentage="40"/>
</chart-data>
</chart>

### <gauge> — performance indicators (report/overview when useful)
<gauge title="Sales Goal Progress" status="success">
<current value="$125,000"/>
<target value="$150,000"/>
<percentage value="83%"/>
</gauge>

### <trend> — trend indicators (report/overview when useful)
<trend label="Monthly Growth" direction="up" color="green">
<current value="$62,500"/>
<change value="$12,500" percentage="25%"/>
</trend>

Chart types: bar, line, pie, multi-bar
Chart colors: blue, green, purple, yellow, red, cyan
Gauge status: success, warning, error
Trend directions: up, down, flat

Do NOT output <milestones> — we use a simple status in the UI instead.

## CRITICAL RULES
1. NEVER show ID fields (id, company_id, user_id, category_id, etc.)
2. Keep table columns to 4-5 max when you do emit a table
3. Lists the user asked for MUST use <table> — no bullet-point lists for record data
4. Status MUST use badge/status attributes with correct colors
5. Charts only for report/analytics/chart/trends asks — never for simple counts
6. Output the formatted result directly — no explanations about formatting`;

/**
 * Format raw agent output for the frontend (non-streaming).
 *
 * @param {string} userMessage  - The original user query (for context on format choice)
 * @param {string} rawOutput    - Raw text from the specialist agent
 * @returns {Promise<string>}   - Formatted text with XML tags
 */
export async function formatOutput(userMessage, rawOutput) {
  const response = await anthropic.messages.create({
    model: config.anthropic.model,
    max_tokens: config.anthropic.maxTokens?.formatter ?? 4096,
    system: FORMATTER_PROMPT,
    messages: [
      {
        role: 'user',
        content: `User's question: ${userMessage}\n\nRaw agent output:\n${rawOutput}`,
      },
    ],
  });

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
 * @returns {Promise<string>} Complete formatted XML/markdown string
 */
export async function formatOutputStreaming(userMessage, rawOutput, res) {
  const sse = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  let formatted = '';

  const stream = await anthropic.messages.stream({
    model: config.anthropic.model,
    max_tokens: config.anthropic.maxTokens?.formatter ?? 4096,
    system: FORMATTER_PROMPT,
    messages: [
      {
        role: 'user',
        content: `User's question: ${userMessage}\n\nRaw agent output:\n${rawOutput}`,
      },
    ],
  });

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      formatted += event.delta.text;
      sse({ type: 'text', content: event.delta.text });
    }
  }

  // Persist the de-fenced version; the client strips fences from the live
  // stream on its side (it re-parses the full accumulated text per delta).
  return stripCodeFence(formatted);
}
