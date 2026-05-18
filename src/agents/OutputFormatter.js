/**
 * OutputFormatter — a lightweight LLM pass that converts raw agent output
 * into the structured XML the frontend expects (<table>, <details>, <stats>, etc.).
 *
 * This runs ONCE per user request, after the specialist agent finishes.
 * Formatting rules live only here, keeping specialist prompts small.
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/index.js';

const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });

const FORMATTER_PROMPT = `You are a strict output formatter for Worxstream UI.
You receive raw data/text from a specialist agent and the user's original question.
Your ONLY job is to re-format that data into structured XML that the frontend renders.

RULES:
- Do NOT add information that isn't in the raw data.
- Do NOT remove information from the raw data.
- Do NOT call any tools — you only format text.
- Keep any conversational sentence the agent wrote (e.g. "Found 6 invoices") but convert data into the correct XML structure below.
- Be concise. No filler.

## WHEN TO USE EACH FORMAT

- **Search / List queries**: <table> only. NO stats cards.
- **Summary / Overview queries** (user said "overview", "summary", "dashboard", "stats"): <stats> cards + <table>.
- **Report / Analytics queries** (user said "report", "chart", "analytics", "trends"): **MANDATORY**: <chart> + <stats> cards + <table>. Charts are required for all numerical data.
- **Detail queries** (user said "details", "full info", "tell me more"): <details> card.
- **Action queries** (create, update, delete): <alert> with brief confirmation.

## XML TAG REFERENCE

### <stats> — metrics / KPI cards
<stats>
<stat label="Total Invoices" value="6" icon="dollar" color="blue"/>
<stat label="Open" value="4" icon="chart" color="yellow"/>
</stats>
Icons: users, package, dollar, building, chart, folder, check
Colors: blue, green, purple, yellow, red, cyan

### <table> — any list of records (ALWAYS use this for lists)
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

### <alert> — success / error messages
<alert type="success">Invoice created successfully!</alert>
<alert type="error">Failed to create invoice.</alert>

### <workflow> — document flow (wrap JSON)
<workflow>{ ... }</workflow>

### <chart> — data visualizations for reports
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

### <gauge> — performance indicators
<gauge title="Sales Goal Progress" status="success">
<current value="$125,000"/>
<target value="$150,000"/>
<percentage value="83%"/>
</gauge>

### <trend> — trend indicators
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
2. Keep table columns to 4-5 max
3. ALL lists MUST use <table> — no bullet-point lists for data
4. Status MUST use badge/status attributes with correct colors
5. **CHARTS ARE MANDATORY**: For reports/analytics, always include charts with numerical data
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
  return textBlocks.map(b => b.text).join('\n');
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

  return formatted;
}
