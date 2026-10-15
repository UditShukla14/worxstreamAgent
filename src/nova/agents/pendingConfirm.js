/**
 * Pending write-tool confirmations (Redis + in-memory fallback).
 */

import { createHash, randomUUID } from 'crypto';
import { config } from '../../config/index.js';
import { redisDel, redisGet, redisSet } from '../../services/redisClient.js';
import { getToolRegistrySnapshot } from '../../mcp/server.js';
import { inferCapabilitiesFromToolName } from '../../mcp/toolCapabilities.js';

/** Process-local fallback when Redis is down (same pattern as SMS drafts). */
const memoryPending = new Map();
const memoryRecentConfirmed = new Map();

function confirmKey(ref) {
  const companyId = String(ref.companyId || ref.company_id || '');
  const userId = String(ref.userId || ref.user_id || '');
  const conversationId = String(ref.conversationId || ref.conversation_id || '');
  if (!conversationId) return '';
  return `ws:pending:${companyId}:${userId}:${conversationId}`;
}

function recentConfirmedKey(ref) {
  const base = confirmKey(ref);
  return base ? `${base}:recent` : '';
}

/** Stable fingerprint so a post-confirm resume cannot re-fire the same write. */
export function fingerprintWriteInput(toolName, input) {
  const payload = JSON.stringify({
    tool: String(toolName || ''),
    input: input && typeof input === 'object' ? input : {},
  });
  return createHash('sha256').update(payload).digest('hex').slice(0, 32);
}

function pruneMemoryPending() {
  const now = Date.now();
  for (const [key, row] of memoryPending) {
    if (row.expiresAt && row.expiresAt < now) memoryPending.delete(key);
  }
  for (const [key, row] of memoryRecentConfirmed) {
    if (row.expiresAt && row.expiresAt < now) memoryRecentConfirmed.delete(key);
  }
}

export function isWriteTool(toolName) {
  const caps = inferCapabilitiesFromToolName(toolName);
  if (caps.safety === 'write') return true;
  const n = String(toolName || '').toLowerCase();
  if (n.startsWith('create_') || n.startsWith('update_') || n.startsWith('delete_')) return true;
  // Outbound email still uses the env write gate when COWORKER_CONFIRM_WRITES=true
  if (n === 'send_object_email' || n === 'send_email') return true;
  // Scribe schedule mutations (create/pause/resume/delete/run/update)
  if (n.startsWith('scribe_') && !n.includes('list') && !n.includes('get_')) return true;
  return false;
}

/**
 * Tools whose confirmation is owned by the agent chat flow (draft → user says
 * confirm → send), not COWORKER_CONFIRM_WRITES / UI pending_confirmation.
 */
export function usesAgentChatConfirm(toolName) {
  return String(toolName || '').toLowerCase() === 'send_sms';
}

export function shouldConfirmWrites(context = {}) {
  if (context._skipWriteConfirm) return false;
  if (context._approvedConfirmations?.length) return false;
  return Boolean(config.coworker?.confirmWrites);
}

/**
 * @param {object} ref
 * @param {object} payload
 */
export async function storePendingConfirm(ref, payload) {
  const key = confirmKey(ref);
  if (!key) {
    console.warn('⏸️ Write confirm skipped store: missing conversationId on planRef');
    return null;
  }
  const confirmationId = payload.confirmationId || randomUUID();
  const ttl = config.coworker?.pendingConfirmTtlSeconds ?? 300;
  const ttlSec = ttl > 0 ? ttl : 300;
  const data = {
    confirmationId,
    tool: payload.tool,
    input: payload.input,
    agentKey: payload.agentKey,
    userMessage: payload.userMessage,
    createdAt: Date.now(),
  };
  pruneMemoryPending();
  memoryPending.set(key, { ...data, expiresAt: Date.now() + ttlSec * 1000 });
  const ok = await redisSet(key, JSON.stringify(data), { ex: ttlSec });
  if (!ok) {
    console.warn('⏸️ Write confirm stored in memory only (Redis unavailable)', {
      tool: payload.tool,
      confirmationId,
    });
  }
  return confirmationId;
}

export async function getPendingConfirm(ref) {
  const key = confirmKey(ref);
  if (!key) return null;
  const raw = await redisGet(key);
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      /* fall through to memory */
    }
  }
  pruneMemoryPending();
  const mem = memoryPending.get(key);
  return mem || null;
}

export async function clearPendingConfirm(ref) {
  const key = confirmKey(ref);
  if (!key) return;
  await redisDel(key);
  memoryPending.delete(key);
}

/**
 * After a UI-approved write runs, remember it so a follow-up turn that
 * re-calls the same tool+args returns the cached result (no second confirm,
 * no duplicate create).
 */
export async function storeRecentConfirmedWrite(ref, payload) {
  const key = recentConfirmedKey(ref);
  if (!key) return;
  const ttl = config.coworker?.pendingConfirmTtlSeconds ?? 300;
  const ttlSec = Math.max(60, ttl > 0 ? ttl : 300);
  const data = {
    tool: payload.tool,
    inputFingerprint: payload.inputFingerprint
      || fingerprintWriteInput(payload.tool, payload.input),
    result: payload.result,
    createdAt: Date.now(),
  };
  pruneMemoryPending();
  memoryRecentConfirmed.set(key, { ...data, expiresAt: Date.now() + ttlSec * 1000 });
  await redisSet(key, JSON.stringify(data), { ex: ttlSec });
}

export async function getRecentConfirmedWrite(ref) {
  const key = recentConfirmedKey(ref);
  if (!key) return null;
  const raw = await redisGet(key);
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      /* fall through */
    }
  }
  pruneMemoryPending();
  const mem = memoryRecentConfirmed.get(key);
  if (mem?.expiresAt && mem.expiresAt < Date.now()) {
    memoryRecentConfirmed.delete(key);
    return null;
  }
  return mem || null;
}

export { getToolRegistrySnapshot };
