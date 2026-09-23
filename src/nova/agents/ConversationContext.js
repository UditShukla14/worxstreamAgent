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
import {
  deriveWorkingSetDelta,
  formatWorkingSetForPrompt,
  mergeWorkingSet,
  resolveClarificationPick,
} from './workingMemory.js';

export { resolveClarificationPick };

function emptyContextShape() {
  return {
    entities: {},
    entityRefs: {},
    recentResults: [],
    workingSet: {},
    lastAgent: null,
    lastAction: null,
    lastSearch: null,
  };
}

function normalizeContextParsed(parsed) {
  if (!parsed || typeof parsed !== 'object') return emptyContextShape();
  return {
    entities: parsed.entities && typeof parsed.entities === 'object' ? parsed.entities : {},
    entityRefs: parsed.entityRefs && typeof parsed.entityRefs === 'object' ? parsed.entityRefs : {},
    recentResults: Array.isArray(parsed.recentResults) ? parsed.recentResults : [],
    workingSet: parsed.workingSet && typeof parsed.workingSet === 'object' ? parsed.workingSet : {},
    lastAgent: parsed.lastAgent ?? null,
    lastAction: parsed.lastAction ?? null,
    lastSearch: parsed.lastSearch ?? null,
  };
}

const IGNORE_FIELDS = new Set([
  'take', 'page', 'sort', 'limit', 'offset', 'skip',
  'per_page', 'page_size', 'max_results',
]);

const LABEL_FIELDS = ['name', 'title', 'custom_number', 'number', 'email', 'phone', 'companyName', 'displayName'];

/**
 * Worxstream customer master IDs are typically 300… (e.g. 30000000037).
 * List rows often expose a separate 200… `id` (record/contact) — not valid for get_customer_details.
 */
function toNumericId(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return parseInt(value.trim(), 10);
  return null;
}

function isWorxstreamCustomerMasterId(value) {
  const n = toNumericId(value);
  if (n == null) return false;
  return String(n).startsWith('30');
}

/**
 * Canonical customer id from a list/detail row (prefer 300-series master id).
 */
export function resolveCustomerRecordId(row) {
  if (!row || typeof row !== 'object') return null;

  const explicit = [row.customer_id, row.customerId].map(toNumericId).filter((n) => n != null);
  for (const n of explicit) {
    if (isWorxstreamCustomerMasterId(n)) return n;
  }
  for (const n of explicit) {
    return n;
  }

  const raw = toNumericId(row.id);
  if (isWorxstreamCustomerMasterId(raw)) return raw;

  return null;
}

function parseFilterSearch(input) {
  if (!input || typeof input !== 'object') return null;
  let filter = input.filter;
  if (typeof filter === 'string') {
    try {
      filter = JSON.parse(filter);
    } catch {
      return null;
    }
  }
  if (filter && typeof filter === 'object' && typeof filter.search === 'string') {
    const s = filter.search.trim();
    return s || null;
  }
  if (typeof input.search === 'string' && input.search.trim()) {
    return input.search.trim();
  }
  return null;
}

function rowMatchesSearch(row, search) {
  if (!search || !row || typeof row !== 'object') return false;
  const q = search.toLowerCase();
  const email = String(row.email || '').toLowerCase();
  if (email && (email === q || email.includes(q))) return true;
  const display = String(row.displayName || row.companyName || row.name || '').toLowerCase();
  if (display && display.includes(q)) return true;
  const first = String(row.firstName || row.first_name || '').toLowerCase();
  const last = String(row.lastName || row.last_name || '').toLowerCase();
  const full = `${first} ${last}`.trim();
  if (full && full.includes(q)) return true;
  return false;
}

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
  if (!key) return emptyContextShape();
  const raw = await redisGet(key);
  if (!raw) return emptyContextShape();
  try {
    return normalizeContextParsed(JSON.parse(raw));
  } catch {
    return emptyContextShape();
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
/**
 * @param {object} [opts]
 * @param {string} [opts.message] - User message for working-set heuristics
 * @param {string} [opts.assistantSummary] - Last formatted assistant excerpt
 */
export async function updateContext(ref, agentKey, toolsUsed, toolResults = [], opts = {}) {
  const key = ctxKey(ref);
  if (!key) return;

  const existing = await getContext(ref);
  const ctx = { ...emptyContextShape(), ...existing };

  // Merge numeric fields AND search terms from tool inputs
  for (const tool of toolsUsed) {
    if (tool.input && tool.success !== false) {
      const nums = extractNumericFields(tool.input);
      Object.assign(ctx.entities, nums);
      const filterSearch = parseFilterSearch(tool.input);
      if (filterSearch) {
        ctx.lastSearch = filterSearch;
      } else if (typeof tool.input.search === 'string' && tool.input.search.trim()) {
        ctx.lastSearch = tool.input.search.trim();
      } else if (typeof tool.input.name === 'string' && tool.input.name.trim()) {
        ctx.lastSearch = tool.input.name.trim();
      }
      // get_customer_details id input — only treat 300-series as customer_id
      if (tool.name === 'get_customer_details') {
        const reqId = toNumericId(tool.input.id);
        if (isWorxstreamCustomerMasterId(reqId)) {
          ctx.entities.customer_id = reqId;
        }
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
    const toolInput = toolsUsed?.[i]?.input || null;
    const entityType = inferEntityTypeFromTool(toolName);
    const items = extractItemsArray(payload);

    if (entityType === 'customers' || toolName === 'list_customers') {
      if (toolName === 'list_customers' && Array.isArray(items) && items.length > 0) {
        const searchTerm = parseFilterSearch(toolInput) || ctx.lastSearch;
        const top = items.slice(0, 10).map((row) => ({
          id: resolveCustomerRecordId(row),
          label: pickLabel(row),
          email: typeof row?.email === 'string' ? row.email.trim() : null,
        })).filter((x) => x.id != null || x.label);

        if (top.length > 0) {
          ctx.recentResults = [
            { tool: toolName, entityType: 'customer', items: top, at: Date.now() },
            ...(Array.isArray(ctx.recentResults) ? ctx.recentResults : []),
          ].slice(0, 5);
        }

        if (searchTerm) {
          const matched = items.find((row) => rowMatchesSearch(row, searchTerm));
          const matchedId = matched ? resolveCustomerRecordId(matched) : null;
          if (matchedId != null) {
            ctx.entities.customer_id = matchedId;
            console.log(`📎 Context matched customer by search "${searchTerm}": customer_id=${matchedId}`);
          }
        }
      }

      if (toolName === 'get_customer_details' && payload && typeof payload === 'object') {
        const dataObj = payload?.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
          ? payload.data
          : payload;
        const cid = resolveCustomerRecordId(dataObj);
        if (cid != null) {
          ctx.entities.customer_id = cid;
          const label = pickLabel(dataObj);
          ctx.entityRefs.customer = { id: cid, label, tool: toolName, at: Date.now() };
        }
      }
    } else if (entityType) {
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

  const wmDelta = deriveWorkingSetDelta(ctx, {
    message: opts.message || '',
    agentKey,
    toolsUsed,
    toolResults,
  });
  ctx.workingSet = mergeWorkingSet(ctx.workingSet, wmDelta);

  // Customer agent: never promote 200-series list `id` into customer_id
  if (agentKey === 'customer') {
    if (ctx.entities.customer_id != null) {
      ctx.entities.id = ctx.entities.customer_id;
    } else if (ctx.entities.id != null && !isWorxstreamCustomerMasterId(ctx.entities.id)) {
      delete ctx.entities.id;
    }
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
/**
 * @param {string|object} ref
 * @param {object} [opts]
 * @param {string} [opts.lastAssistantSnippet]
 */
export async function buildContextPrompt(ref, opts = {}) {
  const ctx = await getContext(ref);
  const entries = Object.entries(ctx.entities);
  const hasRecent = Array.isArray(ctx.recentResults) && ctx.recentResults.length > 0;
  const hasRefs = ctx.entityRefs && typeof ctx.entityRefs === 'object' && Object.keys(ctx.entityRefs).length > 0;
  const hasWorkingSet = ctx.workingSet && Object.keys(ctx.workingSet).length > 0;
  const focusBlock = formatWorkingSetForPrompt(
    hasWorkingSet ? ctx.workingSet : null,
    opts.lastAssistantSnippet || '',
  );

  if (entries.length === 0 && !hasRecent && !hasRefs && !ctx.lastAgent && !ctx.lastSearch && !focusBlock) {
    return '';
  }

  const parts = [];
  if (focusBlock) parts.push(focusBlock);
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
  const body = parts.join('. ');
  return body
    ? `${body}\n\nUse this context to resolve references like "its", "that", "their", and to continue the active task.`
    : '';
}

/**
 * Apply clarification pick from user message; persists to Redis when matched.
 */
export async function applyClarificationPick(ref, message) {
  const key = ctxKey(ref);
  if (!key) return false;
  const ctx = await getContext(ref);
  const patch = resolveClarificationPick(ctx, message);
  if (!patch) return false;
  const merged = {
    ...ctx,
    entities: { ...ctx.entities, ...patch.entities },
    workingSet: patch.workingSet ?? ctx.workingSet,
  };
  const ttlSeconds = Number.isFinite(config.redis?.contextTtlSeconds)
    ? config.redis.contextTtlSeconds
    : 1800;
  await redisSet(key, JSON.stringify({ ...merged, updatedAt: Date.now() }), {
    ex: ttlSeconds > 0 ? ttlSeconds : 1800,
  });
  return true;
}

/**
 * Clear context for a conversation (e.g., on "new chat").
 */
export async function clearContext(ref) {
  const key = ctxKey(ref);
  if (!key) return;
  await redisDel(key);
}

/**
 * Persist full context object to Redis.
 */
export async function saveContext(ref, ctx) {
  const key = ctxKey(ref);
  if (!key) return;
  const ttlSeconds = Number.isFinite(config.redis?.contextTtlSeconds)
    ? config.redis.contextTtlSeconds
    : 1800;
  await redisSet(
    key,
    JSON.stringify({ ...ctx, updatedAt: Date.now() }),
    { ex: ttlSeconds > 0 ? ttlSeconds : 1800 },
  );
}
