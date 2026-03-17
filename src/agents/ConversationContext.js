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

const LABEL_FIELDS = ['name', 'title', 'custom_number', 'number', 'email', 'phone'];

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
  if (!key) return { entities: {}, entityRefs: {}, recentResults: [], lastAgent: null, lastAction: null, lastSearch: null };
  const raw = await redisGet(key);
  if (!raw) return { entities: {}, entityRefs: {}, recentResults: [], lastAgent: null, lastAction: null, lastSearch: null };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return { entities: {}, entityRefs: {}, recentResults: [], lastAgent: null, lastAction: null, lastSearch: null };
    }
    return {
      entities: parsed.entities && typeof parsed.entities === 'object' ? parsed.entities : {},
      entityRefs: parsed.entityRefs && typeof parsed.entityRefs === 'object' ? parsed.entityRefs : {},
      recentResults: Array.isArray(parsed.recentResults) ? parsed.recentResults : [],
      lastAgent: parsed.lastAgent ?? null,
      lastAction: parsed.lastAction ?? null,
      lastSearch: parsed.lastSearch ?? null,
    };
  } catch {
    return { entities: {}, entityRefs: {}, recentResults: [], lastAgent: null, lastAction: null, lastSearch: null };
  }
}

function pickLabel(obj) {
  if (!obj || typeof obj !== 'object') return null;
  for (const f of LABEL_FIELDS) {
    const v = obj[f];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  // Common nested shapes
  const statusLabel = obj?.status?.label ?? obj?.status?.name;
  if (typeof statusLabel === 'string' && statusLabel.trim()) return statusLabel.trim();
  return null;
}

function inferEntityTypeFromTool(toolName) {
  const name = String(toolName || '').toLowerCase();
  if (name.startsWith('list_')) return name.slice('list_'.length);
  if (name.startsWith('get_')) return name.slice('get_'.length).replace(/_details$/, '');
  if (name.startsWith('create_')) return name.slice('create_'.length);
  if (name.startsWith('update_')) return name.slice('update_'.length);
  if (name.startsWith('quick_update_')) return name.slice('quick_update_'.length);
  return null;
}

function extractItemsArray(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const data = payload.data;
  // list_*: often { data: { data: [...] } }
  if (data && typeof data === 'object' && Array.isArray(data.data)) return data.data;
  // sometimes { data: [...] }
  if (Array.isArray(data)) return data;
  // sometimes { data: { rows/items/results/... } }
  if (data && typeof data === 'object') {
    for (const k of ['rows', 'items', 'results', 'records', 'list']) {
      if (Array.isArray(data[k])) return data[k];
    }
  }
  return null;
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
    entityRefs: {},
    recentResults: [],
    lastAgent: null,
    lastAction: null,
    lastSearch: null,
  };

  // Merge numeric fields AND search terms from tool inputs
  for (const tool of toolsUsed) {
    if (tool.input && tool.success !== false) {
      const nums = extractNumericFields(tool.input);
      Object.assign(ctx.entities, nums);
      // Also keep string search terms — crucial for follow-ups like "get its details"
      if (typeof tool.input.search === 'string' && tool.input.search.trim()) {
        ctx.lastSearch = tool.input.search.trim();
      }
      if (typeof tool.input.name === 'string' && tool.input.name.trim()) {
        ctx.lastSearch = tool.input.name.trim();
      }
    }
  }

  // Merge numeric fields from tool results
  for (let i = 0; i < toolResults.length; i++) {
    const result = toolResults[i];
    const nums = extractFromResult(result);
    if (Object.keys(nums).length > 0) {
      console.log(`📎 Context extracted from result:`, nums);
    }
    Object.assign(ctx.entities, nums);

    // Best-effort: capture structured entity refs + recent result sets
    // Unwrap MCP text JSON if needed (same as extractFromResult)
    let payload = result;
    if (result?.content && Array.isArray(result.content)) {
      const textBlock = result.content.find(b => b.type === 'text');
      if (textBlock?.text) {
        try { payload = JSON.parse(textBlock.text); } catch { /* ignore */ }
      }
    }

    const toolName = toolsUsed?.[i]?.name || null;
    const entityType = inferEntityTypeFromTool(toolName);
    const items = extractItemsArray(payload);

    if (entityType) {
      // For list tools, keep a small “recent results” window for reference resolution (\"the second one\").
      if (toolName && toolName.startsWith('list_') && Array.isArray(items) && items.length > 0) {
        const top = items.slice(0, 10).map((row) => ({
          id: row?.id ?? row?.[`${entityType}_id`] ?? null,
          label: pickLabel(row),
        })).filter(x => x.id != null || x.label);

        if (top.length > 0) {
          ctx.recentResults = [
            { tool: toolName, entityType, items: top, at: Date.now() },
            ...(Array.isArray(ctx.recentResults) ? ctx.recentResults : []),
          ].slice(0, 5);
        }
      }

      // For detail tools, store a single “last seen entity ref” per entityType
      if (toolName && (toolName.startsWith('get_') || toolName.startsWith('create_')) && payload && typeof payload === 'object') {
        const dataObj = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
        const id = dataObj?.id ?? ctx.entities?.id ?? null;
        const label = pickLabel(dataObj);
        if (id != null || label) {
          ctx.entityRefs[entityType] = { id, label, tool: toolName, at: Date.now() };
        }
      }
    }
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
  const hasRecent = Array.isArray(ctx.recentResults) && ctx.recentResults.length > 0;
  const hasRefs = ctx.entityRefs && typeof ctx.entityRefs === 'object' && Object.keys(ctx.entityRefs).length > 0;
  if (entries.length === 0 && !hasRecent && !hasRefs && !ctx.lastAgent && !ctx.lastSearch) return '';

  const parts = [];
  if (entries.length > 0) {
    const entityStr = entries.map(([k, v]) => `${k}=${v}`).join(', ');
    parts.push(`Known IDs: ${entityStr}`);
  }
  if (hasRefs) {
    const refs = Object.entries(ctx.entityRefs)
      .map(([k, v]) => `${k}(${v?.label || 'unknown'}):${v?.id ?? 'unknown'}`)
      .join(', ');
    parts.push(`Known entities: ${refs}`);
  }
  if (hasRecent) {
    const latest = ctx.recentResults[0];
    const items = Array.isArray(latest?.items) ? latest.items.slice(0, 5) : [];
    if (latest?.entityType && items.length > 0) {
      const s = items.map((it, idx) => `#${idx + 1}=${it.label || it.id}`).join(', ');
      parts.push(`Recent ${latest.entityType} results: ${s}`);
    }
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
