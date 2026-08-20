/**
 * Seed governance policies and rules for a company, then re-index RAG chunks.
 * Idempotent: upserts on (company_id, seed_key).
 */

import GovernancePolicy from '../models/GovernancePolicy.js';
import GovernanceRule from '../models/GovernanceRule.js';
import { syncGovernanceDocumentChunks } from './rag.js';
import { refreshCatalogContext } from './catalogContext.js';
import { SEED_POLICIES, SEED_RULES } from './seedData.js';
import { ruleChunkContent } from './ruleEvents.js';

/**
 * @param {string} companyId
 * @returns {Promise<{ policies: { inserted: number, updated: number }, rules: { inserted: number, updated: number } }>}
 */
export async function seedGovernanceForCompany(companyId) {
  const company_id = String(companyId);
  const result = {
    policies: { inserted: 0, updated: 0 },
    rules: { inserted: 0, updated: 0 },
  };

  for (const seed of SEED_POLICIES) {
    const existing = await GovernancePolicy.findOne({ company_id, seed_key: seed.seed_key });
    let doc;
    if (existing) {
      existing.name = seed.name;
      existing.type = seed.type;
      existing.status = seed.status;
      existing.content = seed.content;
      doc = await existing.save();
      result.policies.updated += 1;
    } else {
      doc = await GovernancePolicy.create({
        company_id,
        seed_key: seed.seed_key,
        name: seed.name,
        type: seed.type,
        status: seed.status,
        content: seed.content,
      });
      result.policies.inserted += 1;
    }
    await syncGovernanceDocumentChunks({
      companyId: company_id,
      documentId: String(doc._id),
      documentType: 'policy',
      name: doc.name,
      content: doc.content,
      enabled: doc.status === 'active',
    });
  }

  for (const seed of SEED_RULES) {
    const existing = await GovernanceRule.findOne({ company_id, seed_key: seed.seed_key });
    let doc;
    if (existing) {
      existing.name = seed.name;
      existing.event_type = seed.event_type;
      existing.event_types = [seed.event_type];
      existing.condition = seed.condition;
      existing.action = seed.action;
      existing.priority = seed.priority;
      existing.active = seed.active;
      doc = await existing.save();
      result.rules.updated += 1;
    } else {
      doc = await GovernanceRule.create({
        company_id,
        seed_key: seed.seed_key,
        name: seed.name,
        event_type: seed.event_type,
        event_types: [seed.event_type],
        condition: seed.condition,
        action: seed.action,
        priority: seed.priority,
        active: seed.active,
      });
      result.rules.inserted += 1;
    }
    await syncGovernanceDocumentChunks({
      companyId: company_id,
      documentId: String(doc._id),
      documentType: 'rule',
      name: doc.name,
      content: ruleChunkContent(doc),
      enabled: Boolean(doc.active),
    });
  }

  await refreshCatalogContext(company_id);
  return result;
}
