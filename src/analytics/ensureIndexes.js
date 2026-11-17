/**
 * Ensure llm_usage_daily unique index includes agent_key + model.
 * Drops the legacy { company_id, user_id, date } unique index if present.
 */

import mongoose from 'mongoose';
import WalletTransaction from './models/WalletTransaction.js';
import NovaPlan from './models/NovaPlan.js';
import { ensureDefaultNovaPlans, migrateLegacyNovaPlans } from './novaPlans.js';
import AppPlan from '../apps/models/AppPlan.js';
import CompanyAppWallet from '../apps/models/CompanyAppWallet.js';
import CompanyAppSubscription from '../apps/models/CompanyAppSubscription.js';
import { ensureDefaultPlans } from '../apps/plans.js';
import { capExistingRavenCompanies } from '../apps/subscriptions.js';
import LlmUsageDaily from './models/LlmUsageDaily.js';

export async function ensureAnalyticsIndexes() {
  const db = mongoose.connection?.db;
  if (!db) return;

  const coll = db.collection('llm_usage_daily');
  // A fresh database has no llm_usage_daily yet (indexes() throws): that must not skip the steps below.
  let indexes = [];
  try {
    indexes = await coll.indexes();
  } catch {
    indexes = [];
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

  // Wallet history indexes (including the unique payment_ref guard).
  try {
    await WalletTransaction.createIndexes();
  } catch (err) {
    console.warn('⚠️  Could not create wallet transaction indexes:', err?.message || err);
  }

  // Nova credit plans: unique plan_id, and the default catalogue on a first boot.
  try {
    await NovaPlan.createIndexes();
    const converted = await migrateLegacyNovaPlans();
    if (converted) console.log(`📦 Converted ${converted} Nova plans to the price-only format`);
    const seeded = await ensureDefaultNovaPlans();
    if (seeded) console.log(`📦 Seeded ${seeded} default Nova credit plans`);
  } catch (err) {
    console.warn('⚠️  Could not prepare Nova plans:', err?.message || err);
  }

  // AI apps hub (Raven): unique (company, app) rows and plans, and the default Raven catalogue on a first boot.
  try {
    await Promise.all([AppPlan.createIndexes(), CompanyAppWallet.createIndexes(), CompanyAppSubscription.createIndexes()]);
    const seeded = await ensureDefaultPlans('raven');
    if (seeded) console.log(`📦 Seeded ${seeded} default Raven credit plans`);
    // Companies that already used Raven without a credit limit are capped at the default credit. New companies get nothing free.
    const { capped, subscribed } = await capExistingRavenCompanies({
      usageCompanyIds: () => LlmUsageDaily.distinct('company_id', { agent_key: 'raven', user_id: '', model: '' }),
    });
    if (capped || subscribed) console.log(`📦 Raven: ${capped} existing companies capped at the default credit (${subscribed} added as existing users)`);
  } catch (err) {
    console.warn('⚠️  Could not prepare AI app plans:', err?.message || err);
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
