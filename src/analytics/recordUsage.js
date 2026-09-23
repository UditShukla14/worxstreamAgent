/**
 * Persist Anthropic usage for billing analytics (fire-and-forget).
 */

import { config } from '../config/index.js';
import { getRequestContext } from '../request/requestContext.js';
import { normalizeUsageWithCost } from './usageNormalize.js';
import LlmUsageEvent, { LLM_USAGE_PHASES } from './models/LlmUsageEvent.js';
import LlmUsageDaily from './models/LlmUsageDaily.js';

/**
 * @param {Date} [d]
 * @returns {string} YYYY-MM-DD UTC
 */
export function utcDateKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

/**
 * @param {object} meta
 * @param {import('./usageNormalize.js').AnthropicUsage|null|undefined} usage
 * @param {string} [model]
 */
export async function recordUsage(meta = {}, usage = null, model) {
  try {
    const als = getRequestContext() || {};
    const companyId = String(
      meta.companyId ?? meta.company_id ?? als.companyId ?? '',
    ).trim();
    const userId = String(
      meta.userId ?? meta.user_id ?? als.userId ?? '',
    ).trim();

    if (!companyId || !userId) {
      // Without tenant we cannot bill — skip quietly (e.g. boot-time probes).
      return null;
    }

    const phase = LLM_USAGE_PHASES.includes(meta.phase) ? meta.phase : 'agent';
    const rates = config.anthropic.pricing;
    const billed = normalizeUsageWithCost(usage, rates);
    const now = new Date();
    const date = utcDateKey(now);
    const modelId = String(model || meta.model || config.anthropic.model);

    const eventDoc = {
      company_id: companyId,
      user_id: userId,
      conversation_id: String(meta.conversationId ?? meta.conversation_id ?? ''),
      request_id: String(meta.requestId ?? meta.request_id ?? ''),
      phase,
      agent_key: String(meta.agentKey ?? meta.agent_key ?? ''),
      model: modelId,
      ...billed,
      created_at: now,
    };

    await LlmUsageEvent.create(eventDoc);

    const inc = {
      input_tokens: billed.input_tokens,
      output_tokens: billed.output_tokens,
      cache_creation_input_tokens: billed.cache_creation_input_tokens,
      cache_read_input_tokens: billed.cache_read_input_tokens,
      total_tokens: billed.total_tokens,
      cost_usd: billed.cost_usd,
      call_count: 1,
    };

    const upsertDaily = (uid) =>
      LlmUsageDaily.findOneAndUpdate(
        { company_id: companyId, user_id: uid, date },
        {
          $inc: inc,
          $set: { updated_at: now },
          $setOnInsert: { company_id: companyId, user_id: uid, date },
        },
        { upsert: true },
      );

    // Per-user row + company-wide row (user_id '').
    await Promise.all([upsertDaily(userId), upsertDaily('')]);

    return eventDoc;
  } catch (err) {
    console.error('⚠️  recordUsage failed:', err?.message || err);
    return null;
  }
}

/**
 * Fire-and-forget wrapper — never blocks the LLM response path.
 */
export function recordUsageAsync(meta, usage, model) {
  setImmediate(() => {
    recordUsage(meta, usage, model).catch(() => {});
  });
}
