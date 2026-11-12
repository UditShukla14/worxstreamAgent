/**
 * Append-only Anthropic usage ledger — one document per Messages API call.
 */

import mongoose from 'mongoose';

export const LLM_USAGE_PHASES = [
  'agent',
  'router',
  'formatter',
  'nova_plan',
  'execution_plan',
  'self_check',
  'summary',
  'general_chat',
  'governance',
];

const llmUsageEventSchema = new mongoose.Schema(
  {
    company_id: { type: String, required: true, index: true },
    user_id: { type: String, required: true, index: true },
    conversation_id: { type: String, default: '' },
    request_id: { type: String, default: '' },
    phase: {
      type: String,
      required: true,
      enum: LLM_USAGE_PHASES,
    },
    agent_key: { type: String, default: '' },
    /** Model we requested (stable key for rollups / wallet tiers). */
    model: { type: String, required: true },
    /** Model the API actually reports having served (snapshot id) — billing uses this. */
    response_model: { type: String, default: '' },
    /** PRICING_VERSION of the catalog that produced the cost fields. */
    rates_version: { type: String, default: '' },
    /** True when the model was unknown / price unverified, so cost_usd is an estimate. */
    cost_estimated: { type: Boolean, default: false },
    /** Anthropic message id (msg_…): unique per API call → makes metering idempotent. */
    idempotency_key: { type: String, default: undefined },
    /** Rates ($/M tokens) actually applied — audit snapshot, so catalog edits never rewrite history. */
    rates: { type: mongoose.Schema.Types.Mixed, default: undefined },
    /** Integer micro-USD (authoritative money fields; *_usd below are derived floats for dashboards). */
    provider_cost_micros: { type: Number, default: 0 },
    billable_micros: { type: Number, default: 0 },
    /** Markup in effect for this event (0.2 = +20%). */
    markup_rate: { type: Number, default: 0 },
    /** Customer-facing amount = provider cost x (1 + markup). */
    billable_usd: { type: Number, default: 0 },
    /** Wallet debited for this event (false = pending/failed; reconcile will fix drift). */
    wallet_applied: { type: Boolean, default: false },
    /** Stream aborted before completion — usage is partial/estimated. */
    partial: { type: Boolean, default: false },
    /** Could not attribute to a company/user (not billed to any wallet; visible for reconciliation). */
    unattributed: { type: Boolean, default: false },
    input_tokens: { type: Number, default: 0 },
    output_tokens: { type: Number, default: 0 },
    cache_creation_input_tokens: { type: Number, default: 0 },
    cache_read_input_tokens: { type: Number, default: 0 },
    total_tokens: { type: Number, default: 0 },
    input_cost_usd: { type: Number, default: 0 },
    output_cost_usd: { type: Number, default: 0 },
    cache_write_cost_usd: { type: Number, default: 0 },
    cache_read_cost_usd: { type: Number, default: 0 },
    cost_usd: { type: Number, default: 0 },
    created_at: { type: Date, default: Date.now, index: true },
  },
  {
    collection: 'llm_usage_events',
    timestamps: false,
  },
);

llmUsageEventSchema.index(
  { idempotency_key: 1 },
  { unique: true, partialFilterExpression: { idempotency_key: { $type: 'string' } } },
);
llmUsageEventSchema.index({ company_id: 1, created_at: -1 });
llmUsageEventSchema.index({ company_id: 1, user_id: 1, conversation_id: 1 });
llmUsageEventSchema.index({ company_id: 1, user_id: 1, created_at: -1 });
llmUsageEventSchema.index({ created_at: -1 });

const LlmUsageEvent =
  mongoose.models.LlmUsageEvent
  || mongoose.model('LlmUsageEvent', llmUsageEventSchema);

export default LlmUsageEvent;
