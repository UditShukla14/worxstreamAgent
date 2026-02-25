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

Do NOT output <milestones> — we use a simple status in the UI instead.

## CRITICAL RULES
1. NEVER show ID fields (id, company_id, user_id, category_id, etc.)
2. Keep table columns to 4-5 max
3. ALL lists MUST use <table> — no bullet-point lists for data
4. Status MUST use badge/status attributes with correct colors
5. Output the formatted result directly — no explanations about formatting`;

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
    max_tokens: 4096,
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
 *
 * @param {string} userMessage
 * @param {string} rawOutput
 * @param {import('express').Response} res - Express response (SSE headers already set)
 */
export async function formatOutputStreaming(userMessage, rawOutput, res) {
  const sse = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  const stream = await anthropic.messages.stream({
    model: config.anthropic.model,
    max_tokens: 4096,
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
      sse({ type: 'text', content: event.delta.text });
    }
  }
}
