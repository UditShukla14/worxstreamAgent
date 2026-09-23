/**
 * Ensure llm_usage_daily unique index includes agent_key + model.
 * Drops the legacy { company_id, user_id, date } unique index if present.
 */

import mongoose from 'mongoose';

export async function ensureAnalyticsIndexes() {
  const db = mongoose.connection?.db;
  if (!db) return;

  const coll = db.collection('llm_usage_daily');
  let indexes = [];
  try {
    indexes = await coll.indexes();
  } catch {
    return;
  }

  for (const idx of indexes) {
    const keys = Object.keys(idx.key || {});
    const isLegacyUnique =
      idx.unique
      && keys.length === 3
      && keys[0] === 'company_id'
      && keys[1] === 'user_id'
      && keys[2] === 'date';
    if (isLegacyUnique && idx.name) {
      try {
        await coll.dropIndex(idx.name);
        console.log(`📦 Dropped legacy llm_usage_daily index ${idx.name}`);
      } catch (err) {
        console.warn(`⚠️  Could not drop ${idx.name}:`, err?.message || err);
      }
    }
  }

  // Backfill missing dimension fields on older daily rows.
  await coll.updateMany(
    { agent_key: { $exists: false } },
    { $set: { agent_key: '' } },
  );
  await coll.updateMany(
    { model: { $exists: false } },
    { $set: { model: '' } },
  );
}
