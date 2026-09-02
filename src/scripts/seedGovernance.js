/**
 * Connect to Mongo and seed governance policies/rules.
 *
 * Usage (from agent/):
 *   node src/scripts/seedGovernance.js
 *   SEED_COMPANY_ID=123 node src/scripts/seedGovernance.js
 *
 * By default, rows that already exist for a seed_key are skipped (Control Tower
 * is source of truth). To reset seeded rows to seedData.js defaults:
 *   SEED_FORCE_UPDATE=1 node src/scripts/seedGovernance.js
 */

import mongoose from 'mongoose';
import { config } from '../config/index.js';
import { connectDB, disconnectDB } from '../db/connection.js';
import Conversation from '../models/Conversation.js';
import { seedGovernanceForCompany } from '../control/seedGovernance.js';
import { SEED_POLICIES, SEED_RULES } from '../control/seedData.js';

function resolveCompanyId(conversationIds) {
  const fromEnv = (process.env.SEED_COMPANY_ID || process.env.DEFAULT_COMPANY_ID || '').trim();
  if (fromEnv) return fromEnv;
  if (conversationIds.length === 1) return conversationIds[0];
  if (conversationIds.length > 1) return conversationIds[0];
  return '1';
}

async function main() {
  const mongoUrl = config.database.url;
  if (!mongoUrl) {
    console.error('❌ MONGODB_URL is not set in agent/.env — cannot seed.');
    process.exit(1);
  }

  console.log('🔌 Connecting to MongoDB…');
  await connectDB();
  const state = mongoose.connection.readyState;
  const dbName = mongoose.connection.name;
  if (state !== 1) {
    console.error(`❌ MongoDB is not connected (readyState=${state}).`);
    process.exit(1);
  }
  console.log(`✅ MongoDB connected (db=${dbName})`);

  const conversationIds = await Conversation.distinct('company_id');
  if (conversationIds.length > 0) {
    console.log(`ℹ️  Existing conversation company_ids: ${conversationIds.join(', ')}`);
  }

  const companyId = resolveCompanyId(conversationIds.map(String));
  const forceUpdate = process.env.SEED_FORCE_UPDATE === '1';
  console.log(
    `🌱 Seeding ${SEED_POLICIES.length} policies and ${SEED_RULES.length} rules for company_id=${companyId}`
    + (forceUpdate ? ' (force update enabled)' : ' (insert-only — existing seed rows skipped)'),
  );

  const result = await seedGovernanceForCompany(companyId, { forceUpdate });
  console.log(
    `✅ Policies: ${result.policies.inserted} inserted, ${result.policies.updated} updated, ${result.policies.skipped} skipped`,
  );
  console.log(
    `✅ Rules: ${result.rules.inserted} inserted, ${result.rules.updated} updated, ${result.rules.skipped} skipped`,
  );
  console.log('✅ RAG chunks re-indexed');

  await disconnectDB();
}

main().catch(async (error) => {
  console.error('❌ Seed failed:', error.message || error);
  try {
    await disconnectDB();
  } catch {
    // ignore
  }
  process.exit(1);
});
