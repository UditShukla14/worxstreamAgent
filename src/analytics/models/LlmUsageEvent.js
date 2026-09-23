/**
 * Append-only Anthropic usage ledger — one document per Messages API call.
 */

import mongoose from 'mongoose';

export const LLM_USAGE_PHASES = [
  'agent',
  'router',
  'formatter',
  'nova_plan',
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
    model: { type: String, required: true },
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

llmUsageEventSchema.index({ company_id: 1, created_at: -1 });
llmUsageEventSchema.index({ company_id: 1, user_id: 1, created_at: -1 });
llmUsageEventSchema.index({ created_at: -1 });

const LlmUsageEvent =
  mongoose.models.LlmUsageEvent
  || mongoose.model('LlmUsageEvent', llmUsageEventSchema);

export default LlmUsageEvent;
