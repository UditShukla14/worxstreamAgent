import mongoose from 'mongoose';

/**
 * Inbound WorxStream webhook deliveries received by the agent.
 * Soft-delete with deleted_at — list queries omit those rows (same as PipelineRun).
 */
const webhookDeliverySchema = new mongoose.Schema({
  company_id: { type: String, required: true, index: true },
  delivery_id: { type: String, required: true },
  event_id: { type: String, default: '' },
  event_code: { type: String, default: '' },
  object_type: { type: String, default: '' },
  object_id: { type: String, default: null },
  endpoint_url: { type: String, default: '' },
  status: { type: String, default: 'sent' },
  attempts: { type: Number, default: 1 },
  max_attempts: { type: Number, default: 1 },
  request_headers: { type: mongoose.Schema.Types.Mixed, default: null },
  request_payload: { type: mongoose.Schema.Types.Mixed, default: null },
  response_status: { type: Number, default: null },
  response_body_excerpt: { type: String, default: null },
  error_message: { type: String, default: null },
  sent_at: { type: Date, default: Date.now },
  deleted_at: { type: Date, default: null, index: true },
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
});

webhookDeliverySchema.index({ company_id: 1, delivery_id: 1 }, { unique: true });
webhookDeliverySchema.index({ company_id: 1, sent_at: -1 });

const WebhookDelivery = mongoose.model('WebhookDelivery', webhookDeliverySchema);

export default WebhookDelivery;
