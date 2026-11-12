/**
 * Model limits (context window, max output, capabilities).
 *
 * Source of truth is the live Anthropic Models API (GET /v1/models returns
 * max_input_tokens, max_tokens and capabilities). It is fetched at startup and
 * refreshed daily; the static catalog in analytics/modelPricing.js is the
 * fallback when the API is unreachable or does not list a model.
 * Prices are NOT available from the API — those stay in the catalog.
 */

import { anthropicClient } from './anthropicClient.js';
import { catalogLimitsFor } from '../analytics/modelPricing.js';

const REFRESH_MS = 24 * 60 * 60 * 1000;
/** Used only for models neither the API nor the catalog knows: assume the smallest modern window. */
const DEFAULT_LIMITS = Object.freeze({ contextWindow: 200_000, maxOutput: 8_192 });

/** @type {Map<string, {contextWindow: number, maxOutput: number, capabilities: object|null}>} */
let live = new Map();
let lastRefreshAt = 0;
let timer = null;

function supported(cap) {
  return cap?.supported === true;
}

/** Flatten the capabilities object into { thinking: true, effort: true, ... }. */
export function summarizeCapabilities(capabilities) {
  if (!capabilities || typeof capabilities !== 'object') return null;
  const out = {};
  for (const [k, v] of Object.entries(capabilities)) out[k] = supported(v);
  return out;
}

export async function refreshModelLimits() {
  try {
    const next = new Map();
    for await (const m of anthropicClient.models.list({ limit: 100 })) {
      if (!m?.id || !m.max_input_tokens) continue;
      next.set(m.id, {
        contextWindow: m.max_input_tokens,
        maxOutput: m.max_tokens || DEFAULT_LIMITS.maxOutput,
        capabilities: summarizeCapabilities(m.capabilities),
      });
    }
    if (next.size > 0) {
      live = next;
      lastRefreshAt = Date.now();
      console.log(`📏 Model limits loaded from Models API (${next.size} models)`);
    }
    return next.size;
  } catch (err) {
    console.warn(`⚠️  Models API unavailable, using catalog limits: ${err?.message || err}`);
    return 0;
  }
}

/** Fire-and-forget startup + daily refresh. Never throws, never blocks boot. */
export function startModelLimitsRefresh() {
  refreshModelLimits();
  if (!timer) {
    timer = setInterval(refreshModelLimits, REFRESH_MS);
    timer.unref?.();
  }
}

/** Test hook. */
export function _setLiveModelLimitsForTest(map) {
  live = new Map(map);
  lastRefreshAt = Date.now();
}

function findLive(modelId) {
  const id = String(modelId || '').trim();
  if (!id) return null;
  if (live.has(id)) return live.get(id);
  // Alias → dated snapshot (e.g. claude-haiku-4-5 → claude-haiku-4-5-20251001)
  for (const [liveId, v] of live) {
    if (liveId.startsWith(`${id}-`) || id.startsWith(`${liveId}-`)) return v;
  }
  return null;
}

/**
 * @param {string} modelId
 * @returns {{ contextWindow: number, maxOutput: number, capabilities: object|null, source: 'api'|'catalog'|'default' }}
 */
export function getModelLimits(modelId) {
  const fromApi = findLive(modelId);
  if (fromApi) return { ...fromApi, source: 'api' };
  const fromCatalog = catalogLimitsFor(modelId);
  if (fromCatalog) {
    return {
      contextWindow: fromCatalog.contextWindow,
      maxOutput: fromCatalog.maxOutput,
      capabilities: null,
      source: 'catalog',
    };
  }
  return { ...DEFAULT_LIMITS, capabilities: null, source: 'default' };
}

/** @param {string} modelId @param {string} capability e.g. 'thinking' | 'effort' | 'context_management' */
export function modelSupports(modelId, capability) {
  const caps = getModelLimits(modelId).capabilities;
  return caps ? caps[capability] === true : null; // null = unknown
}

export function getModelLimitsStatus() {
  return { models: live.size, lastRefreshAt: lastRefreshAt || null };
}

/** Models the Models API listed for this key (empty until the first successful fetch). */
export function listLiveModels() {
  return [...live.entries()].map(([id, v]) => ({ id, ...v }));
}
