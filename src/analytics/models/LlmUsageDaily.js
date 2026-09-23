/**
 * Daily rollup of Anthropic usage for fast admin dashboards.
 *
 * Dimensions:
 * - user_id '' = company-wide day total
 * - agent_key '' = all agents/phases combined
 * - agent_key set = one specialist (estimate, invoice, nova, …) or control phase
 *   (router, formatter, summary, …)
 */

import mongoose from 'mongoose';

const llmUsageDailySchema = new mongoose.Schema(
  {
    company_id: { type: String, required: true },
    /** Empty string = company-wide aggregate for the day. */
    user_id: { type: String, default: '' },
    /**
     * Empty string = all agents combined.
     * Otherwise specialist key (estimate, nova, …) or phase label (router, formatter).
     */
    agent_key: { type: String, default: '' },
    /** Anthropic model id for this row (empty = all models rolled together). */
    model: { type: String, default: '' },
    /** UTC calendar day YYYY-MM-DD */
    date: { type: String, required: true },
    input_tokens: { type: Number, default: 0 },
    output_tokens: { type: Number, default: 0 },
    cache_creation_input_tokens: { type: Number, default: 0 },
    cache_read_input_tokens: { type: Number, default: 0 },
    total_tokens: { type: Number, default: 0 },
    cost_usd: { type: Number, default: 0 },
    call_count: { type: Number, default: 0 },
    updated_at: { type: Date, default: Date.now },
  },
  {
    collection: 'llm_usage_daily',
    timestamps: false,
  },
);

llmUsageDailySchema.index(
  { company_id: 1, user_id: 1, date: 1, agent_key: 1, model: 1 },
  { unique: true },
);
llmUsageDailySchema.index({ date: 1 });
llmUsageDailySchema.index({ company_id: 1, date: 1 });
llmUsageDailySchema.index({ company_id: 1, agent_key: 1, date: 1 });

const LlmUsageDaily =
  mongoose.models.LlmUsageDaily
  || mongoose.model('LlmUsageDaily', llmUsageDailySchema);

export default LlmUsageDaily;
