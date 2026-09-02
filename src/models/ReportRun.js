import mongoose from 'mongoose';

const reportRowSchema = new mongoose.Schema({
  entity_type: { type: String, enum: ['estimate', 'invoice'], required: true },
  entity_id: { type: Number, required: true },
  label: { type: String, default: '' },
  customer_name: { type: String, default: '' },
  reason: { type: String, default: '' },
  snapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { _id: false });

const reportRunSchema = new mongoose.Schema({
  company_id: { type: String, required: true, index: true },
  definition_id: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  definition_name: { type: String, default: '' },
  period_start: { type: Date, required: true },
  period_end: { type: Date, required: true },
  status: { type: String, enum: ['running', 'completed', 'error'], default: 'running' },
  summary: {
    scanned: { type: Number, default: 0 },
    matched: { type: Number, default: 0 },
    estimates: { type: Number, default: 0 },
    invoices: { type: Number, default: 0 },
  },
  rows: { type: [reportRowSchema], default: [] },
  error_message: { type: String, default: '' },
  generated_at: { type: Date, default: Date.now },
  deleted_at: { type: Date, default: null, index: true },
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
});

reportRunSchema.index({ company_id: 1, generated_at: -1 });
reportRunSchema.index({ company_id: 1, definition_id: 1, generated_at: -1 });

const ReportRun = mongoose.model('ReportRun', reportRunSchema);

export default ReportRun;
