/**
 * Pending write-tool confirmations (Redis).
 */

import { randomUUID } from 'crypto';
import { config } from '../config/index.js';
import { redisDel, redisGet, redisSet } from '../services/redisClient.js';
import { getToolRegistrySnapshot } from '../mcp/server.js';
import { inferCapabilitiesFromToolName } from '../mcp/toolCapabilities.js';

function confirmKey(ref) {
  const companyId = String(ref.companyId || ref.company_id || '');
  const userId = String(ref.userId || ref.user_id || '');
  const conversationId = String(ref.conversationId || ref.conversation_id || '');
  if (!conversationId) return '';
  return `ws:pending:${companyId}:${userId}:${conversationId}`;
}

export function isWriteTool(toolName) {
  const caps = inferCapabilitiesFromToolName(toolName);
  if (caps.safety === 'write') return true;
  const n = String(toolName || '').toLowerCase();
  return n.startsWith('create_') || n.startsWith('update_') || n.startsWith('delete_');
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
  if (!key) return null;
  const confirmationId = payload.confirmationId || randomUUID();
  const ttl = config.coworker?.pendingConfirmTtlSeconds ?? 300;
  const data = {
    confirmationId,
    tool: payload.tool,
    input: payload.input,
    agentKey: payload.agentKey,
    userMessage: payload.userMessage,
    createdAt: Date.now(),
  };
  await redisSet(key, JSON.stringify(data), { ex: ttl > 0 ? ttl : 300 });
  return confirmationId;
}

export async function getPendingConfirm(ref) {
  const key = confirmKey(ref);
  if (!key) return null;
  const raw = await redisGet(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function clearPendingConfirm(ref) {
  const key = confirmKey(ref);
  if (!key) return;
  await redisDel(key);
}

export { getToolRegistrySnapshot };
