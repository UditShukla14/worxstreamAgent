import mongoose from 'mongoose';

const chunkSchema = new mongoose.Schema({
  company_id: { type: String, required: true, index: true },
  document_id: { type: String, required: true },
  document_type: { type: String, enum: ['policy', 'rule'], required: true },
  name: { type: String, default: '' },
  text: { type: String, required: true },
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
});

chunkSchema.index({ company_id: 1, document_id: 1 });

const GovernanceChunk = mongoose.model('GovernanceChunk', chunkSchema);

export default GovernanceChunk;
