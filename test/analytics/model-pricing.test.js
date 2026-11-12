/**
 * Per-model Anthropic rate resolution + catalog.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveModelRates,
  findModelCatalogEntry,
  MODEL_CATALOG,
  HAIKU_RATES,
  SONNET_RATES,
  OPUS_RATES,
} from '../../src/analytics/modelPricing.js';

describe('MODEL_CATALOG', () => {
  it('includes Haiku / Sonnet / Opus / Fable / Mythos families', () => {
    const families = new Set(MODEL_CATALOG.map((m) => m.family));
    for (const f of ['haiku', 'sonnet', 'opus', 'fable', 'mythos']) {
      assert.ok(families.has(f), `missing family ${f}`);
    }
  });
});

describe('resolveModelRates', () => {
  it('maps haiku 4.5 exactly', () => {
    assert.deepEqual(resolveModelRates('claude-haiku-4-5'), HAIKU_RATES);
  });

  it('maps sonnet 4.6 exactly', () => {
    assert.deepEqual(resolveModelRates('claude-sonnet-4-6'), SONNET_RATES);
  });

  it('maps opus 4.6 exactly', () => {
    assert.deepEqual(resolveModelRates('claude-opus-4-6'), OPUS_RATES);
  });

  it('uses Haiku 5.5 low tier under 100k input tokens', () => {
    const rates = resolveModelRates('claude-haiku-5-5', { inputTokens: 50_000 });
    assert.equal(rates.inputPerMillion, 0.1);
    assert.equal(rates.outputPerMillion, 0.5);
  });

  it('uses Haiku 5.5 high tier over 100k input tokens', () => {
    const rates = resolveModelRates('claude-haiku-5-5', { inputTokens: 100_001 });
    assert.equal(rates.inputPerMillion, 0.5);
    assert.equal(rates.outputPerMillion, 2.5);
  });

  it('maps fable and mythos', () => {
    assert.equal(resolveModelRates('claude-fable-5-1').inputPerMillion, 10);
    assert.equal(resolveModelRates('claude-mythos-5').cacheReadPerMillion, 1);
  });

  it('defaults unknown to sonnet 4.6', () => {
    assert.deepEqual(resolveModelRates('unknown-model'), SONNET_RATES);
  });

  it('finds dated snapshot via prefix', () => {
    const entry = findModelCatalogEntry('claude-sonnet-4-6-20260201');
    assert.equal(entry?.id, 'claude-sonnet-4-6');
  });
});

describe('catalog integrity', () => {
  it('has no internal inconsistencies (cache prices derive from base price, limits present)', async () => {
    const { validateCatalog } = await import('../../src/analytics/modelPricing.js');
    assert.deepEqual(validateCatalog(), []);
  });

  it('flags unknown / unverified models as estimated', async () => {
    const { resolveModelRatesDetailed } = await import('../../src/analytics/modelPricing.js');
    assert.equal(resolveModelRatesDetailed('claude-sonnet-4-6').estimated, false);
    assert.equal(resolveModelRatesDetailed('claude-xyz-9').estimated, true);
    assert.equal(resolveModelRatesDetailed('claude-fable-5-2').estimated, false);
    assert.equal(resolveModelRatesDetailed('claude-haiku-4-5-20251001').estimated, false);
  });

  it('every task-tier default model exists in the catalog', async () => {
    const { DEFAULT_TASK_MODELS } = await import('../../src/analytics/taskModels.js');
    for (const id of Object.values(DEFAULT_TASK_MODELS)) {
      assert.ok(findModelCatalogEntry(id), `default model ${id} missing from catalog`);
    }
  });
});

describe('cache read prices are per model (not a flat 0.1x)', () => {
  it('matches the documented newer-model read prices', () => {
    assert.equal(resolveModelRates('claude-opus-5-5').cacheReadPerMillion, 0.2);
    assert.equal(resolveModelRates('claude-sonnet-5-5').cacheReadPerMillion, 0.1);
    assert.equal(resolveModelRates('claude-fable-5-1').cacheReadPerMillion, 0.25);
    const fable52 = resolveModelRates('claude-fable-5-2');
    assert.equal(fable52.inputPerMillion, 8);
    assert.equal(fable52.cacheReadPerMillion, 0.2);
    assert.equal(fable52.cacheWritePerMillion, 10);
  });
});
