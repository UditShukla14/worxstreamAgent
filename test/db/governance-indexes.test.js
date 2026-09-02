import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { indexNeedsRebuild } from '../../src/db/governanceIndexes.js';

describe('governance seed_key index migration', () => {
  it('rebuilds legacy non-partial unique indexes', () => {
    assert.equal(indexNeedsRebuild({ name: 'company_id_1_seed_key_1', unique: true }), true);
    assert.equal(
      indexNeedsRebuild({ name: 'company_id_1_seed_key_1', unique: true, sparse: true }),
      true,
    );
  });

  it('keeps partial indexes that only apply to string seed_key', () => {
    assert.equal(
      indexNeedsRebuild({
        name: 'company_id_1_seed_key_1',
        unique: true,
        partialFilterExpression: { seed_key: { $type: 'string' } },
      }),
      false,
    );
  });

  it('ignores unrelated indexes', () => {
    assert.equal(indexNeedsRebuild({ name: 'company_id_1' }), false);
    assert.equal(indexNeedsRebuild(undefined), false);
  });
});
