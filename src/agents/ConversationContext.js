/**
 * ConversationContext — lightweight, zero-cost context tracker.
 *
 * After every agent request, scans tool inputs AND tool results for numeric
 * values and accumulates them per conversation_id. This gives follow-up
 * requests the IDs they need to resolve references like "its", "that one",
 * "her invoices", etc. — without sending full conversation history.
 *
 * Globally accessible by all agents: router, specialist, formatter.
 */

import { config, getWorxstreamContext } from '../config/index.js';
import { redisDel, redisGet, redisSet } from '../services/redisClient.js';

const IGNORE_FIELDS = new Set([
  'take', 'page', 'sort', 'limit', 'offset', 'skip',
  'per_page', 'page_size', 'max_results',
]);

function normalizeCtxRef(ref) {
  // Backwards compatible: allow passing just conversationId.
  if (typeof ref === 'string') {
    const { companyId, userId } = getWorxstreamContext();
    return { conversationId: ref, companyId: String(companyId), userId: String(userId) };
  }
  if (!ref || typeof ref !== 'object') {
    return { conversationId: '', companyId: '', userId: '' };
  }
  const { companyId, userId } = ref.companyId || ref.userId ? ref : getWorxstreamContext();
  return {
    conversationId: String(ref.conversationId || ref.conversation_id || ''),
    companyId: String(ref.companyId || ref.company_id || companyId || ''),
    userId: String(ref.userId || ref.user_id || userId || ''),
  };
}

function ctxKey(ref) {
  const r = normalizeCtxRef(ref);
  if (!r.conversationId) return '';
  // Scope by tenant + user to avoid collisions.
  return `ws:ctx:${r.companyId}:${r.userId}:${r.conversationId}`;
}

/**
 * Extract all numeric-valued fields from a flat object,
 * skipping pagination/noise fields.
 */
function extractNumericFields(obj) {
  if (!obj || typeof obj !== 'object') return {};
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (IGNORE_FIELDS.has(key)) continue;
    if (typeof value === 'number') {
      result[key] = value;
    } else if (typeof value === 'string' && /^\d+$/.test(value)) {
      result[key] = parseInt(value, 10);
    }
  }
  return result;
}

/**
 * Extract numeric fields from a tool result payload.
 *
 * MCP tools return: { content: [{ type: 'text', text: '...' }] }
 * The text field contains stringified JSON with the actual API data,
 * which can be:
 *   { data: { id: 1, ... } }
 *   { data: [ { id: 1, ... }, ... ] }
 *   { success: true, data: [...] }
 *   [ { id: 1, ... }, ... ]
 */
function extractFromResult(result) {
  if (!result || typeof result !== 'object') return {};

  // Unwrap MCP content format: { content: [{ type: 'text', text: '...' }] }
  let payload = result;
  if (result.content && Array.isArray(result.content)) {
    const textBlock = result.content.find(b => b.type === 'text');
    if (textBlock?.text) {
      try { payload = JSON.parse(textBlock.text); } catch { return {}; }
    }
  }

  // Recursively find the first array or object with numeric fields.
  // API shapes vary: { data: [...] }, { data: { rows: [...] } }, { data: { id: 1 } }, etc.
  let merged = extractNumericFields(payload);

  const data = payload.data;
  if (data) {
    if (Array.isArray(data) && data.length > 0) {
      merged = { ...merged, ...extractNumericFields(data[0]) };
    } else if (typeof data === 'object' && !Array.isArray(data)) {
      merged = { ...merged, ...extractNumericFields(data) };
      // Check common nested shapes: data.rows, data.items, data.results
      for (const nested of ['rows', 'items', 'results', 'records', 'list']) {
        const arr = data[nested];
        if (Array.isArray(arr) && arr.length > 0) {
          merged = { ...merged, ...extractNumericFields(arr[0]) };
          break;
        }
      }
    }
  }

  // Handle direct array response (no .data wrapper)
  if (Array.isArray(payload) && payload.length > 0) {
    merged = { ...merged, ...extractNumericFields(payload[0]) };
  }

  return merged;
}

/**
 * Get the context for a conversation. Returns a plain object
 * with accumulated numeric fields + metadata.
 */
export async function getContext(ref) {
  const key = ctxKey(ref);
  if (!key) return { entities: {}, lastAgent: null, lastAction: null, lastSearch: null };
  const raw = await redisGet(key);
  if (!raw) return { entities: {}, lastAgent: null, lastAction: null, lastSearch: null };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return { entities: {}, lastAgent: null, lastAction: null, lastSearch: null };
    }
    return {
      entities: parsed.entities && typeof parsed.entities === 'object' ? parsed.entities : {},
      lastAgent: parsed.lastAgent ?? null,
      lastAction: parsed.lastAction ?? null,
      lastSearch: parsed.lastSearch ?? null,
    };
  } catch {
    return { entities: {}, lastAgent: null, lastAction: null, lastSearch: null };
  }
}

/**
 * Update the context after a request completes.
 *
 * @param {string|object} ref - conversation context ref (conversationId or { companyId, userId, conversationId })
 * @param {string} agentKey       - Which agent handled this request
 * @param {string} toolName       - Last tool called (for lastAction)
 * @param {object[]} toolsUsed    - Array of { name, input, success }
 * @param {object[]} toolResults  - Array of raw tool result objects (parsed JSON)
 */
export async function updateContext(ref, agentKey, toolsUsed, toolResults = []) {
  const key = ctxKey(ref);
  if (!key) return;

  const existing = await getContext(ref);
  const ctx = existing && typeof existing === 'object' ? existing : {
    entities: {},
    lastAgent: null,
    lastAction: null,
    lastSearch: null,
  };

  // Merge numeric fields AND search terms from tool inputs
  for (const tool of toolsUsed) {
    if (tool.input && tool.success !== false) {
      const nums = extractNumericFields(tool.input);
      Object.assign(existing.entities, nums);
      // Also keep string search terms — crucial for follow-ups like "get its details"
      if (typeof tool.input.search === 'string' && tool.input.search.trim()) {
        existing.lastSearch = tool.input.search.trim();
      }
      if (typeof tool.input.name === 'string' && tool.input.name.trim()) {
        ctx.lastSearch = tool.input.name.trim();
      }
    }
  }

  // Merge numeric fields from tool results
  for (const result of toolResults) {
    const nums = extractFromResult(result);
    if (Object.keys(nums).length > 0) {
      console.log(`📎 Context extracted from result:`, nums);
    }
    Object.assign(ctx.entities, nums);
  }

  ctx.lastAgent = agentKey;
  ctx.lastAction = toolsUsed.length > 0
    ? toolsUsed[toolsUsed.length - 1].name
    : null;

  // When Customer agent ran, expose id as customer_id so follow-up turns (e.g. "his estimates")
  // can use it for list_estimates/list_invoices/etc. without re-resolving the customer.
  if (agentKey === 'customer' && ctx.entities.id != null && ctx.entities.customer_id == null) {
    ctx.entities.customer_id = ctx.entities.id;
  }

  const ttlSeconds = Number.isFinite(config.redis?.contextTtlSeconds)
    ? config.redis.contextTtlSeconds
    : 1800;
  await redisSet(
    key,
    JSON.stringify({ ...ctx, updatedAt: Date.now() }),
    { ex: ttlSeconds > 0 ? ttlSeconds : 1800 },
  );
}

/**
 * Build a short context string to inject into prompts.
 * Returns empty string if no context exists.
 */
export async function buildContextPrompt(ref) {
  const ctx = await getContext(ref);
  const entries = Object.entries(ctx.entities);
  if (entries.length === 0 && !ctx.lastAgent && !ctx.lastSearch) return '';

  const parts = [];
  if (entries.length > 0) {
    const entityStr = entries.map(([k, v]) => `${k}=${v}`).join(', ');
    parts.push(`Known IDs: ${entityStr}`);
  }
  if (ctx.entities.customer_id != null) {
    parts.push(`Use customer_id=${ctx.entities.customer_id} for list_estimates, list_invoices, list_credit_memos, list_bills, or list_purchase_orders when the user refers to "his/their/its" or the previously discussed customer`);
  }
  if (ctx.lastSearch) {
    parts.push(`Last search: "${ctx.lastSearch}"`);
  }
  if (ctx.lastAgent) {
    parts.push(`Last agent: ${ctx.lastAgent}`);
  }
  if (ctx.lastAction) {
    parts.push(`Last action: ${ctx.lastAction}`);
  }
  return `[Context from previous turn] ${parts.join('. ')}. Use these to resolve references like "its", "that", "their", etc.`;
}

/**
 * Clear context for a conversation (e.g., on "new chat").
 */
export async function clearContext(ref) {
  const key = ctxKey(ref);
  if (!key) return;
  await redisDel(key);
}
