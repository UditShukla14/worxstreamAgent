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

/** @type {ModelRates} */
const rates = (input, output, cache5m, cache1h, cacheRead) => ({
  inputPerMillion: input,
  outputPerMillion: output,
  cacheWritePerMillion: cache5m,
  cacheWrite1hPerMillion: cache1h,
  cacheReadPerMillion: cacheRead,
});

/**
 * Full catalog — ids are API-style slugs for preference storage + billing match.
 * Prefer exact id match; resolveModelRates also falls back by family keywords.
 * @type {readonly ModelCatalogEntry[]}
 */
export const MODEL_CATALOG = Object.freeze([
  {
    id: 'claude-fable-5-1',
    name: 'Claude Fable 5.1',
    family: 'fable',
    tierHint: 'advanced',
    ...rates(10, 50, 12.5, 20, 0.25),
  },
  {
    id: 'claude-opus-5-5',
    name: 'Claude Opus 5.5',
    family: 'opus',
    tierHint: 'hard',
    ...rates(4, 20, 5, 8, 0.2),
  },
  {
    id: 'claude-sonnet-5-5',
    name: 'Claude Sonnet 5.5',
    family: 'sonnet',
    tierHint: 'medium',
    ...rates(2, 10, 2.5, 4, 0.1),
  },
  {
    id: 'claude-haiku-5-5',
    name: 'Claude Haiku 5.5',
    family: 'haiku',
    tierHint: 'daily',
    ...rates(0.1, 0.5, 0.125, 0.2, 0.01),
    inputTokensThreshold: 100_000,
    ratesOverThreshold: rates(0.5, 2.5, 0.625, 1, 0.05),
  },
  {
    id: 'claude-mythos-5-1',
    name: 'Claude Mythos 5.1',
    family: 'mythos',
    tierHint: 'advanced',
    ...rates(10, 50, 12.5, 20, 0.25),
  },
  {
    id: 'claude-fable-5',
    name: 'Claude Fable 5',
    family: 'fable',
    tierHint: 'advanced',
    ...rates(10, 50, 12.5, 20, 1),
  },
  {
    id: 'claude-mythos-5',
    name: 'Claude Mythos 5',
    family: 'mythos',
    tierHint: 'advanced',
    ...rates(10, 50, 12.5, 20, 1),
  },
  {
    id: 'claude-opus-5',
    name: 'Claude Opus 5',
    family: 'opus',
    tierHint: 'hard',
    ...rates(5, 25, 6.25, 10, 0.5),
  },
  {
    id: 'claude-opus-4-8',
    name: 'Claude Opus 4.8',
    family: 'opus',
    tierHint: 'hard',
    ...rates(5, 25, 6.25, 10, 0.5),
  },
  {
    id: 'claude-opus-4-7',
    name: 'Claude Opus 4.7',
    family: 'opus',
    tierHint: 'hard',
    ...rates(5, 25, 6.25, 10, 0.5),
  },
  {
    id: 'claude-opus-4-6',
    name: 'Claude Opus 4.6',
    family: 'opus',
    tierHint: 'hard',
    ...rates(5, 25, 6.25, 10, 0.5),
  },
  {
    id: 'claude-opus-4-5',
    name: 'Claude Opus 4.5',
    family: 'opus',
    tierHint: 'hard',
    ...rates(5, 25, 6.25, 10, 0.5),
  },
  {
    id: 'claude-opus-4-1',
    name: 'Claude Opus 4.1',
    family: 'opus',
    tierHint: 'advanced',
    ...rates(15, 75, 18.75, 30, 1.5),
  },
  {
    id: 'claude-opus-4',
    name: 'Claude Opus 4',
    family: 'opus',
    tierHint: 'advanced',
    ...rates(15, 75, 18.75, 30, 1.5),
  },
  {
    id: 'claude-sonnet-5',
    name: 'Claude Sonnet 5',
    family: 'sonnet',
    tierHint: 'medium',
    ...rates(2, 10, 2.5, 4, 0.2),
  },
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    family: 'sonnet',
    tierHint: 'medium',
    ...rates(3, 15, 3.75, 6, 0.3),
  },
  {
    id: 'claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5',
    family: 'sonnet',
    tierHint: 'medium',
    ...rates(3, 15, 3.75, 6, 0.3),
  },
  {
    id: 'claude-sonnet-4',
    name: 'Claude Sonnet 4',
    family: 'sonnet',
    tierHint: 'medium',
    ...rates(3, 15, 3.75, 6, 0.3),
  },
  {
    id: 'claude-haiku-4-5',
    name: 'Claude Haiku 4.5',
    family: 'haiku',
    tierHint: 'daily',
    ...rates(1, 5, 1.25, 2, 0.1),
  },
  {
    id: 'claude-haiku-3-5',
    name: 'Claude Haiku 3.5',
    family: 'haiku',
    tierHint: 'daily',
    ...rates(0.8, 4, 1, 1.6, 0.08),
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
 * Unknown → Sonnet 4.6 (safe default).
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
