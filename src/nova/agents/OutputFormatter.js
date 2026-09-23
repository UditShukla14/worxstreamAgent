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

const FORMATTER_PROMPT = `You are a UI formatter for Worxstream.
You receive raw text/data from an agent and the user's question.
Render that answer for the frontend — do not invent a different answer shape. The agent (Claude) already chose what to say from conversation context.

RULES:
- Do NOT invent facts that are not in the raw data.
- Preserve the agent's intent and detail level. Do not turn a table of rows into a summary, or a short answer into a report.
- Do NOT call any tools — you only format text.
- Prefer structured XML when the agent used it or when the content is clearly rows/metrics/one record. Use plain text when that is enough.
- Output DIRECTLY. NEVER wrap in markdown code fences (\`\`\` or \`\`\`xml).

## XML TAG REFERENCE (use when appropriate)

### <stats>
<stats>
<stat label="Total Invoices" value="6" icon="dollar" color="blue"/>
</stats>
Icons: users, package, dollar, building, chart, folder, check
Colors: blue, green, purple, yellow, red, cyan

### <table>
<table title="Open Invoices">
<headers>
<th>Number</th><th>Customer</th><th>Date</th><th>Total</th><th>Status</th>
</headers>
<row>
<td>INV-4</td><td>Acme Corp</td><td>Dec 3, 2025</td><td>$5,664.00</td><td status="warning">Open</td>
</row>
</table>
Status colors: status="success" | "warning" | "error"

### <details>
<details title="Invoice INV-4 Details">
<item label="Number">INV-4</item>
<item label="Status" badge="warning">Open</item>
</details>

### <alert>
<alert type="success">Invoice created successfully!</alert>
<alert type="error">Failed to create invoice.</alert>

### <workflow> — NEVER emit this tag yourself (system attaches it).

### <chart> / <gauge> / <trend> — only when the agent answer already called for analytics visuals.

## CRITICAL
1. NEVER show raw ID fields as the only label
2. Keep table columns to a useful set when emitting a table
3. Output the formatted result directly — no meta commentary
`;

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
