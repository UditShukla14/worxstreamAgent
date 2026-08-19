import mongoose from 'mongoose';

const ruleSchema = new mongoose.Schema({
  company_id: { type: String, required: true, index: true },
  seed_key: { type: String, default: undefined },
  name: { type: String, required: true },
  event_type: { type: String, required: true },
  event_types: { type: [String], default: [] },
  condition: { type: String, required: true },
  action: { type: String, required: true },
  priority: { type: Number, default: 2, min: 1, max: 5 },
  active: { type: Boolean, default: true },
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
});

ruleSchema.index({ company_id: 1, event_type: 1, active: 1 });
ruleSchema.index({ company_id: 1, seed_key: 1 }, { unique: true, sparse: true });

const GovernanceRule = mongoose.model('GovernanceRule', ruleSchema);

export default GovernanceRule;
