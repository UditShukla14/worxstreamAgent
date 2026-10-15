import mongoose from 'mongoose';

/**
 * Scribe schedule definition.
 * kind=criteria_report — Control Tower missing-fields / negative-profit scans.
 * kind=flow_recipe — Nova-originated frozen flows (e.g. sales_email_briefing).
 *
 * Collection kept as `reportdefinitions` for existing Mongo data.
 */
const scheduleDefinitionSchema = new mongoose.Schema({
  company_id: { type: String, required: true, index: true },
  user_id: { type: String, required: true },
  name: { type: String, required: true },
  description: { type: String, default: '' },

  kind: {
    type: String,
    enum: ['criteria_report', 'flow_recipe'],
    default: 'criteria_report',
    index: true,
  },
  /** Nova chat that created this schedule (flow recipes). */
  source: {
    type: String,
    enum: ['control_tower', 'nova'],
    default: 'control_tower',
  },
  conversation_id: { type: String, default: null },

  // ── criteria_report fields ──────────────────────────────────────────
  entity_types: {
    type: [String],
    enum: ['estimate', 'invoice'],
    default: ['estimate', 'invoice'],
  },
  criteria_type: {
    type: String,
    enum: ['missing_fields', 'negative_profit'],
    required: false,
    default: null,
  },
  criteria_fields: { type: [String], default: [] },

  // ── flow_recipe fields ─────────────────────────────────────────────
  /** e.g. sales_email_briefing */
  flow_type: { type: String, default: null },
  /**
   * Frozen flow config — re-executed identically each run; only date-bound
   * values change. Shape depends on flow_type.
   */
  flow: { type: mongoose.Schema.Types.Mixed, default: null },

  // ── cadence (shared) ───────────────────────────────────────────────
  interval_days: { type: Number, default: 1, min: 1, max: 90 },
  run_at_hour_utc: { type: Number, default: 23, min: 0, max: 23 },
  /** IANA timezone for flow recipes (display + local hour resolution). */
  timezone: { type: String, default: 'UTC' },

  active: { type: Boolean, default: true },
  last_run_at: { type: Date, default: null },
  next_run_at: { type: Date, default: null, index: true },
  deleted_at: { type: Date, default: null, index: true },
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  collection: 'reportdefinitions',
});

scheduleDefinitionSchema.index({ company_id: 1, active: 1, next_run_at: 1 });
scheduleDefinitionSchema.index({ company_id: 1, kind: 1, active: 1 });

const ScheduleDefinition = mongoose.models.ScheduleDefinition
  || mongoose.model('ScheduleDefinition', scheduleDefinitionSchema);

export default ScheduleDefinition;
