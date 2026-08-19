import mongoose from 'mongoose';

const alertSchema = new mongoose.Schema({
  company_id: { type: String, required: true, index: true },
  alert_id: { type: String, required: true },
  run_id: { type: String, default: '' },
  event_id: { type: String, default: '' },
  severity: { type: String, enum: ['critical', 'warning', 'info'], default: 'warning' },
  message: { type: String, required: true },
  detail: { type: String, default: '' },
  triggered_by: { type: String, default: '' },
  related_entity: { type: String, default: '' },
  customer_type: { type: String, default: '' },
  event_type: { type: String, default: '' },
  policy_violated: { type: String, default: '' },
  suggested_action: { type: String, default: '' },
  agent_response_excerpt: { type: String, default: '' },
  status: { type: String, enum: ['open', 'resolved'], default: 'open' },
  timestamp: { type: Date, default: Date.now },
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
});

alertSchema.index({ company_id: 1, alert_id: 1 }, { unique: true });
alertSchema.index({ company_id: 1, status: 1, timestamp: -1 });

const GovernanceAlert = mongoose.model('GovernanceAlert', alertSchema);

export default GovernanceAlert;
