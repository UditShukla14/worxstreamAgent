import mongoose from 'mongoose';

const policySchema = new mongoose.Schema({
  company_id: { type: String, required: true, index: true },
  seed_key: { type: String, default: undefined },
  name: { type: String, required: true },
  type: { type: String, enum: ['policy', 'rule'], default: 'policy' },
  status: { type: String, enum: ['active', 'draft'], default: 'active' },
  content: { type: String, required: true },
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
});

policySchema.index({ company_id: 1, updated_at: -1 });
policySchema.index(
  { company_id: 1, seed_key: 1 },
  {
    unique: true,
    partialFilterExpression: { seed_key: { $type: 'string' } },
  },
);

policySchema.pre('save', function stripNullSeedKey() {
  if (this.seed_key == null || this.seed_key === '') {
    this.seed_key = undefined;
    this.markModified('seed_key');
  }
});

const GovernancePolicy = mongoose.model('GovernancePolicy', policySchema);

export default GovernancePolicy;
