import mongoose from 'mongoose';

const scheduleRowSchema = new mongoose.Schema({
  entity_type: { type: String, enum: ['estimate', 'invoice'], required: true },
  entity_id: { type: Number, required: true },
  label: { type: String, default: '' },
  customer_name: { type: String, default: '' },
  reason: { type: String, default: '' },
  snapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { _id: false });

const scheduleProgressStepSchema = new mongoose.Schema({
  key: { type: String, required: true },
  label: { type: String, required: true },
  status: {
    type: String,
    enum: ['pending', 'running', 'done', 'error', 'warn'],
    default: 'pending',
  },
  detail: { type: String, default: '' },
  /** Compact step output (totals, recipients) — not full raw API dumps. */
  output_summary: { type: mongoose.Schema.Types.Mixed, default: undefined },
  at: { type: Date, default: Date.now },
}, { _id: false });

/**
 * One Scribe schedule execution — durable like ConversationTurn.log.
 * Collection kept as `reportruns` for existing Mongo data.
 */
const scheduleRunSchema = new mongoose.Schema({
  company_id: { type: String, required: true, index: true },
  user_id: { type: String, default: '', index: true },
  definition_id: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  definition_name: { type: String, default: '' },
  kind: {
    type: String,
    enum: ['criteria_report', 'flow_recipe'],
    default: 'criteria_report',
  },
  flow_type: { type: String, default: null },
  conversation_id: { type: String, default: null },
  trigger: { type: String, enum: ['manual', 'scheduled'], default: 'manual' },
  period_start: { type: Date, required: true },
  period_end: { type: Date, required: true },
  status: {
    type: String,
    enum: ['running', 'completed', 'error', 'partial'],
    default: 'running',
  },
  started_at: { type: Date, default: Date.now },
  finished_at: { type: Date, default: null },
  summary: {
    scanned: { type: Number, default: 0 },
    matched: { type: Number, default: 0 },
    estimates: { type: Number, default: 0 },
    invoices: { type: Number, default: 0 },
    metrics: { type: mongoose.Schema.Types.Mixed, default: undefined },
  },
  rows: { type: [scheduleRowSchema], default: [] },
  progress: {
    phase: { type: String, default: 'starting' },
    steps: { type: [scheduleProgressStepSchema], default: [] },
  },
  error_message: { type: String, default: '' },
  error_stack: { type: String, default: '' },
  error_code: { type: String, default: '' },
  failed_step: { type: String, default: '' },
  delivery: {
    channel: { type: String, default: '' },
    to: { type: [String], default: undefined },
    subject: { type: String, default: '' },
    status: { type: String, default: '' },
    provider_id: { type: String, default: '' },
    detail: { type: String, default: '' },
  },
  generated_at: { type: Date, default: Date.now },
  deleted_at: { type: Date, default: null, index: true },
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  collection: 'reportruns',
});

scheduleRunSchema.index({ company_id: 1, generated_at: -1 });
scheduleRunSchema.index({ company_id: 1, definition_id: 1, generated_at: -1 });
scheduleRunSchema.index({ company_id: 1, deleted_at: 1, generated_at: -1 });
scheduleRunSchema.index({ company_id: 1, status: 1, created_at: -1 });
scheduleRunSchema.index({ company_id: 1, kind: 1, generated_at: -1 });

const ScheduleRun = mongoose.models.ScheduleRun
  || mongoose.model('ScheduleRun', scheduleRunSchema);

export default ScheduleRun;
