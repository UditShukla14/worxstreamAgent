import mongoose from 'mongoose';

/**
 * Legacy hide-list for WorxStream webhook deliveries.
 * Migrated onto WebhookDelivery.deleted_at by GET/POST /api/control/deliveries.
 * Do not add new writes here.
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
