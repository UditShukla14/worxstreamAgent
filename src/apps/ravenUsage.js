import { recordUsage } from '../analytics/recordUsage.js';
import { AppInputError } from './subscriptions.js';

const num = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.trunc(Number(v)) : 0);

/**
 * Record one Raven (mail agent) model call that the mail service reports. Goes through the same ledger, pricing and
 * rollups as every other call (agent_key 'raven'), and debits the company's Raven wallet.
 * Idempotent on `message_id` (the Anthropic message id), so a retried report never charges twice.
 */
export async function recordRavenUsage(body = {}) {
  const companyId = String(body.company_id || '').trim();
  const userId = String(body.user_id || '').trim();
  const model = String(body.model || '').trim();
  const messageId = String(body.message_id || '').trim();
  if (!companyId) throw new AppInputError('company_id is required');
  if (!userId) throw new AppInputError('user_id is required');
  if (!model) throw new AppInputError('model is required');
  if (!messageId) throw new AppInputError('message_id is required');
  const u = body.usage || {};
  const usage = {
    input_tokens: num(u.input_tokens),
    output_tokens: num(u.output_tokens),
    cache_creation_input_tokens: num(u.cache_creation_input_tokens),
    cache_read_input_tokens: num(u.cache_read_input_tokens),
  };
  if (usage.input_tokens + usage.output_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens === 0) {
    throw new AppInputError('usage has no tokens');
  }
  const event = await recordUsage(
    { companyId, userId, agentKey: 'raven', phase: 'agent', requestId: String(body.request_id || '') },
    usage,
    model,
    String(body.response_model || ''),
    { messageId },
  );
  return { recorded: Boolean(event), billable_usd: event?.billable_usd ?? null };
}
