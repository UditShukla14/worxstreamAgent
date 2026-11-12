/**
 * Anthropic API list rates (USD per 1M tokens).
 * Cache write defaults to 5-minute ephemeral cache.
 * @see https://docs.anthropic.com/en/docs/about-claude/pricing
 */

/** @typedef {{ inputPerMillion: number, outputPerMillion: number, cacheWritePerMillion: number, cacheWrite1hPerMillion?: number, cacheReadPerMillion: number }} ModelRates */

/**
 * @typedef {ModelRates & {
 *   id: string,
 *   name: string,
 *   family: string,
 *   tierHint?: 'daily' | 'medium' | 'hard' | 'advanced',
 *   inputTokensThreshold?: number,
 *   ratesOverThreshold?: ModelRates,
 * }} ModelCatalogEntry
 */

/**
 * Prompt-cache multipliers relative to base input price.
 * Writes are uniform (1.25x for 5 min, 2x for 1 h). Reads are NOT: older models
 * read at 0.1x, newer ones cheaper (e.g. Opus 5.5 / Sonnet 5.5 0.05x, Fable 5.1 / 5.2 0.025x),
 * so the read price is typed per model; `read` is only the documented MAX multiplier.
 */
export const CACHE_MULTIPLIERS = Object.freeze({ write5m: 1.25, write1h: 2, read: 0.1 });

const round6 = (n) => Math.round(n * 1e6) / 1e6;

/**
 * Base input/output prices (and the per-model cache READ price) are typed in;
 * cache WRITE prices are derived from the uniform write multipliers.
 * @param {number} input @param {number} output
 * @param {number} [cacheRead] defaults to 0.1x input (older models)
 * @returns {ModelRates}
 */
const rates = (input, output, cacheRead = input * CACHE_MULTIPLIERS.read) => ({
  inputPerMillion: input,
  outputPerMillion: output,
  cacheWritePerMillion: round6(input * CACHE_MULTIPLIERS.write5m),
  cacheWrite1hPerMillion: round6(input * CACHE_MULTIPLIERS.write1h),
  cacheReadPerMillion: round6(cacheRead),
});

/** Where base prices come from — a human re-verifies them against this page. */
export const PRICING_SOURCE_URL = 'https://docs.anthropic.com/en/docs/about-claude/pricing';

/** Bump when any rate changes; stored on each usage event for auditability. */
export const PRICING_VERSION = '2026-11-10';

/**
 * Context window / max output fallbacks (tokens). The live Models API
 * (src/llm/modelLimits.js) overrides these at runtime; these are used when the
 * API is unreachable or does not list the model.
 * `limitsVerified` = confirmed against GET /v1/models on 2026-11-10.
 */
const limits = (contextWindow, maxOutput, limitsVerified = true) => ({
  contextWindow,
  maxOutput,
  limitsVerified,
});

/**
 * Full catalog — ids are API-style slugs for preference storage + billing match.
 * Prefer exact id match; resolveModelRates also falls back by family keywords.
 * @type {readonly ModelCatalogEntry[]}
 */
export const MODEL_CATALOG = Object.freeze([
  {
    id: 'claude-fable-5-2',
    name: 'Claude Fable 5.2',
    family: 'fable',
    tierHint: 'advanced',
    // $8 / $40, cache read $0.20 (0.025x) — from the claude-api skill model table (cached 2026-11-03).
    ...rates(8, 40, 0.2),
    ...limits(1_000_000, 128_000),
  },
  {
    id: 'claude-fable-5-1',
    name: 'Claude Fable 5.1',
    family: 'fable',
    tierHint: 'advanced',
    ...rates(10, 50, 0.25),
    ...limits(1_000_000, 128_000),
  },
  {
    id: 'claude-opus-5-5',
    name: 'Claude Opus 5.5',
    family: 'opus',
    tierHint: 'hard',
    ...rates(4, 20, 0.2),
    ...limits(1_000_000, 128_000),
  },
  {
    id: 'claude-sonnet-5-5',
    name: 'Claude Sonnet 5.5',
    family: 'sonnet',
    tierHint: 'medium',
    ...rates(2, 10, 0.1),
    ...limits(1_000_000, 128_000),
  },
  {
    id: 'claude-haiku-5-5',
    name: 'Claude Haiku 5.5',
    family: 'haiku',
    tierHint: 'daily',
    ...rates(0.1, 0.5),
    ...limits(1_000_000, 128_000),
    inputTokensThreshold: 100_000,
    ratesOverThreshold: rates(0.5, 2.5),
  },
  {
    id: 'claude-mythos-5-1',
    name: 'Claude Mythos 5.1',
    family: 'mythos',
    tierHint: 'advanced',
    ...rates(10, 50),
    ...limits(200_000, 64_000, false),
  },
  {
    id: 'claude-fable-5',
    name: 'Claude Fable 5',
    family: 'fable',
    tierHint: 'advanced',
    ...rates(10, 50),
    ...limits(1_000_000, 128_000),
  },
  {
    id: 'claude-mythos-5',
    name: 'Claude Mythos 5',
    family: 'mythos',
    tierHint: 'advanced',
    ...rates(10, 50),
    ...limits(200_000, 64_000, false),
  },
  {
    id: 'claude-opus-5',
    name: 'Claude Opus 5',
    family: 'opus',
    tierHint: 'hard',
    ...rates(5, 25),
    ...limits(1_000_000, 128_000),
  },
  {
    id: 'claude-opus-4-8',
    name: 'Claude Opus 4.8',
    family: 'opus',
    tierHint: 'hard',
    ...rates(5, 25),
    ...limits(1_000_000, 128_000),
  },
  {
    id: 'claude-opus-4-7',
    name: 'Claude Opus 4.7',
    family: 'opus',
    tierHint: 'hard',
    ...rates(5, 25),
    ...limits(1_000_000, 128_000),
  },
  {
    id: 'claude-opus-4-6',
    name: 'Claude Opus 4.6',
    family: 'opus',
    tierHint: 'hard',
    ...rates(5, 25),
    ...limits(1_000_000, 128_000),
  },
  {
    id: 'claude-opus-4-5',
    name: 'Claude Opus 4.5',
    family: 'opus',
    tierHint: 'hard',
    ...rates(5, 25),
    ...limits(200_000, 64_000),
  },
  {
    id: 'claude-opus-4-1',
    name: 'Claude Opus 4.1',
    family: 'opus',
    tierHint: 'advanced',
    ...rates(15, 75),
    ...limits(200_000, 32_000, false),
  },
  {
    id: 'claude-opus-4',
    name: 'Claude Opus 4',
    family: 'opus',
    tierHint: 'advanced',
    ...rates(15, 75),
    ...limits(200_000, 32_000, false),
  },
  {
    id: 'claude-sonnet-5',
    name: 'Claude Sonnet 5',
    family: 'sonnet',
    tierHint: 'medium',
    ...rates(2, 10),
    ...limits(1_000_000, 128_000),
  },
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    family: 'sonnet',
    tierHint: 'medium',
    ...rates(3, 15),
    ...limits(1_000_000, 128_000),
  },
  {
    id: 'claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5',
    family: 'sonnet',
    tierHint: 'medium',
    ...rates(3, 15),
    ...limits(200_000, 64_000),
  },
  {
    id: 'claude-sonnet-4',
    name: 'Claude Sonnet 4',
    family: 'sonnet',
    tierHint: 'medium',
    ...rates(3, 15),
    ...limits(200_000, 64_000, false),
  },
  {
    id: 'claude-haiku-4-5',
    name: 'Claude Haiku 4.5',
    family: 'haiku',
    tierHint: 'daily',
    ...rates(1, 5),
    ...limits(200_000, 64_000),
  },
  {
    id: 'claude-haiku-3-5',
    name: 'Claude Haiku 3.5',
    family: 'haiku',
    tierHint: 'daily',
    ...rates(0.8, 4),
    ...limits(200_000, 8_192, false),
  },
]);

/** @type {Readonly<Record<string, ModelCatalogEntry>>} */
const BY_ID = Object.freeze(
  Object.fromEntries(MODEL_CATALOG.map((m) => [m.id, m])),
);

/** Legacy family fallbacks when model id is unknown / dated. */
const FAMILY_FALLBACK = Object.freeze({
  haiku: BY_ID['claude-haiku-4-5'],
  sonnet: BY_ID['claude-sonnet-4-6'],
  opus: BY_ID['claude-opus-4-6'],
  fable: BY_ID['claude-fable-5-1'],
  mythos: BY_ID['claude-mythos-5-1'],
});

/**
 * @param {ModelCatalogEntry|ModelRates} entry
 * @returns {ModelRates}
 */
function toBillingRates(entry) {
  return {
    inputPerMillion: entry.inputPerMillion,
    outputPerMillion: entry.outputPerMillion,
    cacheWritePerMillion: entry.cacheWritePerMillion,
    cacheReadPerMillion: entry.cacheReadPerMillion,
  };
}

/**
 * @param {string|null|undefined} modelId
 * @returns {ModelCatalogEntry|null}
 */
export function findModelCatalogEntry(modelId) {
  const raw = String(modelId || '').trim();
  if (!raw) return null;
  if (BY_ID[raw]) return BY_ID[raw];

  const id = raw.toLowerCase();
  // Dated snapshots: claude-sonnet-4-20250514 → sonnet-4 family
  const exactLoose = MODEL_CATALOG.find((m) => id === m.id || id.startsWith(`${m.id}-`));
  if (exactLoose) return exactLoose;

  if (id.includes('fable')) return FAMILY_FALLBACK.fable;
  if (id.includes('mythos')) return FAMILY_FALLBACK.mythos;
  if (id.includes('haiku')) return FAMILY_FALLBACK.haiku;
  if (id.includes('opus')) return FAMILY_FALLBACK.opus;
  if (id.includes('sonnet')) return FAMILY_FALLBACK.sonnet;
  return null;
}

/**
 * Resolve USD/1M rates for an Anthropic model id.
 * Haiku 5.5 uses higher rates when inputTokens > 100k.
 * Unknown → Sonnet 4.6 rates, but use resolveModelRatesDetailed() to learn that it was a guess.
 * @param {string|null|undefined} modelId
 * @param {{ inputTokens?: number }} [opts]
 * @returns {ModelRates}
 */
export function resolveModelRates(modelId, opts = {}) {
  const entry = findModelCatalogEntry(modelId) || FAMILY_FALLBACK.sonnet;
  const inputTokens = Number(opts.inputTokens);
  if (
    entry.ratesOverThreshold
    && entry.inputTokensThreshold
    && Number.isFinite(inputTokens)
    && inputTokens > entry.inputTokensThreshold
  ) {
    return toBillingRates(entry.ratesOverThreshold);
  }
  return toBillingRates(entry);
}

/**
 * Like resolveModelRates but says how trustworthy the answer is.
 * `estimated` is true when the model is unknown (family/Sonnet fallback) or its
 * price is flagged unverified — callers should surface/store that flag.
 * @param {string|null|undefined} modelId
 * @param {{ inputTokens?: number }} [opts]
 * @returns {{ rates: ModelRates, estimated: boolean, catalogId: string|null, reason: string|null, pricingVersion: string }}
 */
export function resolveModelRatesDetailed(modelId, opts = {}) {
  const raw = String(modelId || '').trim();
  const exact = raw
    ? (BY_ID[raw] || MODEL_CATALOG.find((m) => raw.toLowerCase() === m.id || raw.toLowerCase().startsWith(`${m.id}-`)))
    : null;
  const entry = exact || findModelCatalogEntry(raw);
  let reason = null;
  if (!exact) reason = entry ? `family fallback for "${raw}"` : `unknown model "${raw}" priced as Sonnet 4.6`;
  else if (exact.pricingVerified === false) reason = `price for ${exact.id} not verified`;
  return {
    rates: resolveModelRates(modelId, opts),
    estimated: reason !== null,
    catalogId: (entry || FAMILY_FALLBACK.sonnet).id,
    reason,
    pricingVersion: PRICING_VERSION,
  };
}

/**
 * Context window / max output from the static catalog (fallback source).
 * @param {string|null|undefined} modelId
 * @returns {{ contextWindow: number, maxOutput: number, verified: boolean, catalogId: string|null }|null}
 */
export function catalogLimitsFor(modelId) {
  const raw = String(modelId || '').trim().toLowerCase();
  const entry = raw
    ? (BY_ID[raw] || MODEL_CATALOG.find((m) => raw.startsWith(`${m.id}-`)))
    : null;
  if (!entry) return null;
  return {
    contextWindow: entry.contextWindow,
    maxOutput: entry.maxOutput,
    verified: entry.limitsVerified === true,
    catalogId: entry.id,
  };
}

/** Internal-consistency problems in the catalog (empty array = healthy). */
export function validateCatalog() {
  const problems = [];
  const seen = new Set();
  for (const m of MODEL_CATALOG) {
    if (seen.has(m.id)) problems.push(`duplicate id ${m.id}`);
    seen.add(m.id);
    const sets = [[m.id, m]];
    if (m.ratesOverThreshold) sets.push([`${m.id} (over threshold)`, m.ratesOverThreshold]);
    for (const [label, r] of sets) {
      const near = (a, b) => Math.abs(a - b) < 1e-6;
      if (!(r.inputPerMillion > 0) || !(r.outputPerMillion > 0)) problems.push(`${label}: non-positive base price`);
      if (!near(r.cacheWritePerMillion, r.inputPerMillion * CACHE_MULTIPLIERS.write5m)) problems.push(`${label}: cache write != 1.25x input`);
      if (!(r.cacheReadPerMillion > 0) || r.cacheReadPerMillion > r.inputPerMillion * CACHE_MULTIPLIERS.read + 1e-9) problems.push(`${label}: cache read must be >0 and <= 0.1x input`);
    }
    if (!(m.contextWindow > 0) || !(m.maxOutput > 0)) problems.push(`${m.id}: missing context window / max output`);
    if (m.maxOutput > m.contextWindow) problems.push(`${m.id}: maxOutput > contextWindow`);
  }
  return problems;
}

/** @deprecated Prefer catalog entries — kept for older imports/tests */
export const HAIKU_RATES = toBillingRates(BY_ID['claude-haiku-4-5']);
/** @deprecated */
export const SONNET_RATES = toBillingRates(BY_ID['claude-sonnet-4-6']);
/** @deprecated */
export const OPUS_RATES = toBillingRates(BY_ID['claude-opus-4-6']);

export function listModelCatalogForApi() {
  return MODEL_CATALOG.map((m) => ({
    id: m.id,
    name: m.name,
    family: m.family,
    tierHint: m.tierHint || null,
    contextWindow: m.contextWindow,
    maxOutput: m.maxOutput,
    limitsVerified: m.limitsVerified === true,
    pricingVerified: m.pricingVerified !== false,
    inputPerMillion: m.inputPerMillion,
    outputPerMillion: m.outputPerMillion,
    cacheWritePerMillion: m.cacheWritePerMillion,
    cacheWrite1hPerMillion: m.cacheWrite1hPerMillion ?? null,
    cacheReadPerMillion: m.cacheReadPerMillion,
    inputTokensThreshold: m.inputTokensThreshold ?? null,
    ratesOverThreshold: m.ratesOverThreshold
      ? toBillingRates(m.ratesOverThreshold)
      : null,
  }));
}
