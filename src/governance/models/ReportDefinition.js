import mongoose from 'mongoose';

const reportDefinitionSchema = new mongoose.Schema({
  company_id: { type: String, required: true, index: true },
  user_id: { type: String, required: true },
  name: { type: String, required: true },
  description: { type: String, default: '' },
  entity_types: {
    type: [String],
    enum: ['estimate', 'invoice'],
    default: ['estimate', 'invoice'],
  },
  criteria_type: {
    type: String,
    enum: ['missing_fields', 'negative_profit'],
    required: true,
  },
  criteria_fields: { type: [String], default: [] },
  interval_days: { type: Number, default: 1, min: 1, max: 90 },
  run_at_hour_utc: { type: Number, default: 23, min: 0, max: 23 },
  active: { type: Boolean, default: true },
  last_run_at: { type: Date, default: null },
  next_run_at: { type: Date, default: null, index: true },
  deleted_at: { type: Date, default: null, index: true },
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
});

reportDefinitionSchema.index({ company_id: 1, active: 1, next_run_at: 1 });

const ReportDefinition = mongoose.model('ReportDefinition', reportDefinitionSchema);

export default ReportDefinition;
