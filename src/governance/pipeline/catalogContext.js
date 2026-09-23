/**
 * Persistent governance catalog context.
 *
 * Active policies and active rules sit in process memory (and Redis when
 * available) for the life of the process. Agents read this snapshot on every
 * run. Mongo is queried only on a cache miss. The snapshot is dropped and
 * rebuilt when a policy or rule is created, updated, or deleted.
 */

import GovernancePolicy from '../models/GovernancePolicy.js';
import GovernanceRule from '../models/GovernanceRule.js';
import { redisDel, redisGet, redisSet, redisStatus } from '../services/redisClient.js';
import { eventTypesFromRule, ruleAppliesToEvent } from './ruleEvents.js';

const memory = new Map();

function companyKey(companyId) {
  return String(companyId || '').trim();
}

function dataKey(companyId) {
  return `governance:catalog:data:${companyKey(companyId)}`;
}

function versionKey(companyId) {
  return `governance:catalog:ver:${companyKey(companyId)}`;
}

function isoDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function mapPolicy(row) {
  return {
    id: String(row._id),
    name: row.name,
    type: row.type || 'policy',
    status: row.status || 'active',
    content: row.content || '',
    updatedAt: isoDate(row.updated_at),
  };
}

function mapRule(row) {
  const eventTypes = eventTypesFromRule(row);
  return {
    id: String(row._id),
    name: row.name,
    eventType: eventTypes[0] || row.event_type,
    eventTypes,
    condition: row.condition || '',
    action: row.action || '',
    priority: row.priority,
    active: row.active !== false,
    updatedAt: isoDate(row.updated_at),
  };
}

export function catalogForEvent(snapshot, eventType) {
  const policies = Array.isArray(snapshot?.policies) ? snapshot.policies : [];
  const rules = Array.isArray(snapshot?.rules) ? snapshot.rules : [];
  return {
    policies,
    rules: eventType
      ? rules.filter((row) => ruleAppliesToEvent(row, eventType))
      : rules,
    loadedAt: snapshot?.loadedAt || null,
    version: snapshot?.version || null,
  };
}

export async function fetchCatalogFromMongo(companyId) {
  const company_id = companyKey(companyId);
  const [policies, rules] = await Promise.all([
    GovernancePolicy.find({ company_id, status: 'active' })
      .select('name type status content updated_at')
      .sort({ updated_at: -1 })
      .lean(),
    GovernanceRule.find({ company_id, active: true })
      .select('name event_type event_types condition action priority active updated_at')
      .sort({ updated_at: -1 })
      .lean(),
  ]);
  return {
    policies: (policies || []).map(mapPolicy),
    rules: (rules || []).map(mapRule),
    loadedAt: new Date().toISOString(),
    version: Date.now().toString(),
  };
}

async function readRedisVersion(companyId) {
  if (!redisStatus().enabled) return null;
  return redisGet(versionKey(companyId));
}

async function readRedisSnapshot(companyId) {
  if (!redisStatus().enabled) return null;
  const raw = await redisGet(dataKey(companyId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeRedisSnapshot(companyId, snapshot) {
  if (!redisStatus().enabled) return;
  const id = companyKey(companyId);
  await redisSet(dataKey(id), JSON.stringify(snapshot));
  await redisSet(versionKey(id), String(snapshot.version || Date.now()));
}

/**
 * Return the company's active catalog. Hits memory, then Redis, then Mongo.
 * Does not filter by event type — call catalogForEvent for that.
 */
export async function getCatalogContext(companyId) {
  const id = companyKey(companyId);
  if (!id) {
    return { policies: [], rules: [], loadedAt: null, version: null };
  }

  const cached = memory.get(id);
  const redisVersion = await readRedisVersion(id);
  if (cached && (!redisVersion || redisVersion === cached.version)) {
    return cached;
  }

  const fromRedis = await readRedisSnapshot(id);
  if (fromRedis && (!redisVersion || redisVersion === fromRedis.version)) {
    memory.set(id, fromRedis);
    return fromRedis;
  }

  const snapshot = await fetchCatalogFromMongo(id);
  memory.set(id, snapshot);
  await writeRedisSnapshot(id, snapshot);
  console.log(
    `🛡️  Catalog context loaded for company ${id} (${snapshot.policies.length} policies, ${snapshot.rules.length} rules)`,
  );
  return snapshot;
}

/**
 * Drop the cached catalog so the next read reloads from Mongo.
 * Call this after any policy/rule create, update, or delete.
 */
export async function invalidateCatalogContext(companyId) {
  const id = companyKey(companyId);
  if (!id) return;
  memory.delete(id);
  if (!redisStatus().enabled) return;
  await redisDel(dataKey(id));
  await redisSet(versionKey(id), Date.now().toString());
}

/** Reload from Mongo immediately so the next agent run does not wait on a miss. */
export async function refreshCatalogContext(companyId) {
  await invalidateCatalogContext(companyId);
  return getCatalogContext(companyId);
}

/** Test helper: put a snapshot in memory without touching Mongo. */
export function primeCatalogContext(companyId, snapshot) {
  const id = companyKey(companyId);
  memory.set(id, {
    policies: Array.isArray(snapshot?.policies) ? snapshot.policies : [],
    rules: Array.isArray(snapshot?.rules) ? snapshot.rules : [],
    loadedAt: snapshot?.loadedAt || new Date().toISOString(),
    version: snapshot?.version || 'test',
  });
}

export function peekCatalogContext(companyId) {
  return memory.get(companyKey(companyId)) || null;
}

export function clearCatalogContext() {
  memory.clear();
}

function companyIdFromDoc(doc) {
  return doc?.company_id != null ? String(doc.company_id) : '';
}

function attachInvalidationHooks(model) {
  model.schema.post('save', (doc) => {
    const companyId = companyIdFromDoc(doc);
    if (companyId) void invalidateCatalogContext(companyId);
  });
  model.schema.post('findOneAndDelete', (doc) => {
    const companyId = companyIdFromDoc(doc);
    if (companyId) void invalidateCatalogContext(companyId);
  });
}

attachInvalidationHooks(GovernancePolicy);
attachInvalidationHooks(GovernanceRule);
