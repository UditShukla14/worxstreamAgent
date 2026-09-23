/**
 * Unit tests for Anthropic usage normalization + cost calculation.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeAnthropicUsage,
  computeUsageCostUsd,
  normalizeUsageWithCost,
} from '../../src/analytics/usageNormalize.js';

const RATES = {
  inputPerMillion: 3,
  outputPerMillion: 15,
  cacheWritePerMillion: 3.75,
  cacheReadPerMillion: 0.3,
};

describe('normalizeAnthropicUsage', () => {
  it('reads all Anthropic usage fields including cache', () => {
    const tokens = normalizeAnthropicUsage({
      input_tokens: 1000,
      output_tokens: 200,
      cache_creation_input_tokens: 500,
      cache_read_input_tokens: 8000,
    });
    assert.equal(tokens.input_tokens, 1000);
    assert.equal(tokens.output_tokens, 200);
    assert.equal(tokens.cache_creation_input_tokens, 500);
    assert.equal(tokens.cache_read_input_tokens, 8000);
    assert.equal(tokens.total_tokens, 9700);
  });

  it('defaults missing fields to zero', () => {
    const tokens = normalizeAnthropicUsage(null);
    assert.deepEqual(tokens, {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      total_tokens: 0,
    });
  });
});

describe('computeUsageCostUsd', () => {
  it('prices each bucket at USD per 1M tokens', () => {
    const tokens = normalizeAnthropicUsage({
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_creation_input_tokens: 1_000_000,
      cache_read_input_tokens: 1_000_000,
    });
    const costs = computeUsageCostUsd(tokens, RATES);
    assert.equal(costs.input_cost_usd, 3);
    assert.equal(costs.output_cost_usd, 15);
    assert.equal(costs.cache_write_cost_usd, 3.75);
    assert.equal(costs.cache_read_cost_usd, 0.3);
    assert.equal(costs.cost_usd, 22.05);
  });
});

describe('normalizeUsageWithCost', () => {
  it('combines tokens and cost for billing records', () => {
    const billed = normalizeUsageWithCost(
      { input_tokens: 2000, output_tokens: 500 },
      RATES,
    );
    assert.equal(billed.input_tokens, 2000);
    assert.equal(billed.output_tokens, 500);
    assert.ok(Math.abs(billed.cost_usd - (2000 / 1e6) * 3 - (500 / 1e6) * 15) < 1e-12);
  });
});
