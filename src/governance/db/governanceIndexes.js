/**
 * Ensure governance seed_key indexes allow multiple user-created rules/policies
 * (no seed_key) while keeping seeded rows unique per company.
 */

import GovernancePolicy from '../models/GovernancePolicy.js';
import GovernanceRule from '../models/GovernanceRule.js';

const SEED_KEY_INDEX = 'company_id_1_seed_key_1';

const GOVERNANCE_MODELS = [GovernancePolicy, GovernanceRule];

export function indexNeedsRebuild(index) {
  if (!index || index.name !== SEED_KEY_INDEX) return false;
  const partial = index.partialFilterExpression;
  if (partial?.seed_key?.$type === 'string') return false;
  // Legacy non-partial or sparse-only indexes still collide on seed_key: null.
  return true;
}

/**
 * @param {import('mongoose').Model} Model
 */
async function rebuildSeedKeyIndex(Model) {
  await Model.updateMany(
    { $or: [{ seed_key: null }, { seed_key: '' }] },
    { $unset: { seed_key: '' } },
  );

  const collection = Model.collection;
  const indexes = await collection.indexes();
  const existing = indexes.find((idx) => idx.name === SEED_KEY_INDEX);
  if (indexNeedsRebuild(existing)) {
    await collection.dropIndex(SEED_KEY_INDEX);
  }

  await Model.syncIndexes();
}

export async function ensureGovernanceSeedKeyIndexes() {
  for (const Model of GOVERNANCE_MODELS) {
    await rebuildSeedKeyIndex(Model);
  }
}
