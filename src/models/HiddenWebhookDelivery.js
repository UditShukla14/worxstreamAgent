import mongoose from 'mongoose';

/**
 * Control Tower hide-list for WorxStream webhook deliveries.
 * Source rows stay in WorxStream; this is a company-scoped soft delete.
 */
const hiddenWebhookDeliverySchema = new mongoose.Schema({
  company_id: { type: String, required: true, index: true },
  delivery_id: { type: String, required: true },
  deleted_at: { type: Date, default: Date.now },
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
});

hiddenWebhookDeliverySchema.index({ company_id: 1, delivery_id: 1 }, { unique: true });

const HiddenWebhookDelivery = mongoose.model('HiddenWebhookDelivery', hiddenWebhookDeliverySchema);

export default HiddenWebhookDelivery;
