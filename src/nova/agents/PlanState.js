/**
 * PlanState — minimal per-conversation execution state.
 *
 * Purpose: enable bounded “self-check and continue” loops without relying on
 * brittle regex heuristics. Stored in Redis (best-effort, no hard dependency).
 */
 
import { redisDel, redisGet, redisSet } from '../services/redisClient.js';
import { config, getWorxstreamContext } from '../config/index.js';
 
function normalizeRef(ref) {
  if (typeof ref === 'string') {
    const { companyId, userId } = getWorxstreamContext();
    return { conversationId: ref, companyId: String(companyId), userId: String(userId) };
  }
  if (!ref || typeof ref !== 'object') return { conversationId: '', companyId: '', userId: '' };
  const { companyId, userId } = ref.companyId || ref.userId ? ref : getWorxstreamContext();
  return {
    conversationId: String(ref.conversationId || ref.conversation_id || ''),
    companyId: String(ref.companyId || ref.company_id || companyId || ''),
    userId: String(ref.userId || ref.user_id || userId || ''),
  };
}
 
function keyFor(ref) {
  const r = normalizeRef(ref);
  if (!r.conversationId) return '';
  return `ws:plan:${r.companyId}:${r.userId}:${r.conversationId}`;
}
 
/**
 * @typedef {object} PlanState
 * @property {number} attempts
 * @property {number} updatedAt
 */
 
/**
 * @param {string|object} ref
 * @returns {Promise<PlanState>}
 */
export async function getPlanState(ref) {
  const key = keyFor(ref);
  if (!key) return { attempts: 0, updatedAt: Date.now() };
  const raw = await redisGet(key);
  if (!raw) return { attempts: 0, updatedAt: Date.now() };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { attempts: 0, updatedAt: Date.now() };
    return {
      attempts: Number.isFinite(parsed.attempts) ? parsed.attempts : 0,
      updatedAt: Number.isFinite(parsed.updatedAt) ? parsed.updatedAt : Date.now(),
    };
  } catch {
    return { attempts: 0, updatedAt: Date.now() };
  }
}
 
/**
 * @param {string|object} ref
 * @param {Partial<PlanState>} patch
 */
export async function setPlanState(ref, patch) {
  const key = keyFor(ref);
  if (!key) return;
  const existing = await getPlanState(ref);
  const next = {
    ...existing,
    ...patch,
    updatedAt: Date.now(),
  };
  const ttlSeconds = Number.isFinite(config.redis?.contextTtlSeconds)
    ? config.redis.contextTtlSeconds
    : 1800;
  await redisSet(key, JSON.stringify(next), { ex: ttlSeconds > 0 ? ttlSeconds : 1800 });
}
 
export async function clearPlanState(ref) {
  const key = keyFor(ref);
  if (!key) return;
  await redisDel(key);
}
 
