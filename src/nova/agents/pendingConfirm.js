/**
 * Pending write-tool confirmations (Redis + in-memory fallback).
 */

import { randomUUID } from 'crypto';
import { config } from '../../config/index.js';
import { redisDel, redisGet, redisSet } from '../../services/redisClient.js';
import { getToolRegistrySnapshot } from '../../mcp/server.js';
import { inferCapabilitiesFromToolName } from '../../mcp/toolCapabilities.js';

/** Process-local fallback when Redis is down (same pattern as SMS drafts). */
const memoryPending = new Map();

function confirmKey(ref) {
  const companyId = String(ref.companyId || ref.company_id || '');
  const userId = String(ref.userId || ref.user_id || '');
  const conversationId = String(ref.conversationId || ref.conversation_id || '');
  if (!conversationId) return '';
  return `ws:pending:${companyId}:${userId}:${conversationId}`;
}

function pruneMemoryPending() {
  const now = Date.now();
  for (const [key, row] of memoryPending) {
    if (row.expiresAt && row.expiresAt < now) memoryPending.delete(key);
  }
}

export function isWriteTool(toolName) {
  const caps = inferCapabilitiesFromToolName(toolName);
  if (caps.safety === 'write') return true;
  const n = String(toolName || '').toLowerCase();
  if (n.startsWith('create_') || n.startsWith('update_') || n.startsWith('delete_')) return true;
  // Outbound email still uses the env write gate when COWORKER_CONFIRM_WRITES=true
  if (n === 'send_object_email') return true;
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

export { getToolRegistrySnapshot };
