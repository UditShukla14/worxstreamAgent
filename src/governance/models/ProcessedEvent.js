import mongoose from 'mongoose';

const processedEventSchema = new mongoose.Schema({
  company_id: { type: String, required: true },
  event_id: { type: String, required: true },
  event_type: { type: String, default: '' },
  accepted_at: { type: Date, default: Date.now },
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
});

processedEventSchema.index({ company_id: 1, event_id: 1 }, { unique: true });

const ProcessedEvent = mongoose.model('ProcessedEvent', processedEventSchema);

export default ProcessedEvent;
