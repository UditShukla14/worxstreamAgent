import mongoose from 'mongoose';

const toolCallSchema = new mongoose.Schema({
  name: { type: String, required: true },
  input: { type: mongoose.Schema.Types.Mixed, default: {} },
  success: { type: Boolean, default: true },
  durationMs: { type: Number, default: 0 },
}, { _id: false });

const agentStepSchema = new mongoose.Schema({
  agentKey: { type: String, required: true },
  agentName: { type: String, required: true },
  verdict: { type: String, enum: ['pass', 'flag', 'error', 'running', 'skipped'], required: true },
  responseExcerpt: { type: String, default: '' },
  toolsUsed: { type: [toolCallSchema], default: [] },
  durationMs: { type: Number, default: 0 },
  tokens: { type: Number, default: 0 },
  message: { type: String, default: '' },
  detail: { type: String, default: '' },
  policyViolated: { type: String, default: null },
  suggestedAction: { type: String, default: null },
  relatedEntity: { type: String, default: '' },
  severity: { type: String, default: null },
}, { _id: false });

const pipelineRunSchema = new mongoose.Schema({
  company_id: { type: String, required: true, index: true },
  run_id: { type: String, required: true },
  event_id: { type: String, required: true },
  event_type: { type: String, required: true },
  entity_label: { type: String, default: '' },
  user_id: { type: String, default: '' },
  payload: { type: mongoose.Schema.Types.Mixed, default: {} },
  pipeline: { type: [String], default: [] },
  execution_mode: { type: String, enum: ['single', 'parallel', 'sequential'], default: 'sequential' },
  plan_reason: { type: String, default: '' },
  steps: { type: [agentStepSchema], default: [] },
  status: { type: String, enum: ['pass', 'flagged', 'error', 'running', 'stopped'], default: 'running' },
  total_duration_ms: { type: Number, default: 0 },
  total_tokens: { type: Number, default: 0 },
  timestamp: { type: Date, default: Date.now },
  deleted_at: { type: Date, default: null, index: true },
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
});

pipelineRunSchema.index({ company_id: 1, run_id: 1 }, { unique: true });
pipelineRunSchema.index({ company_id: 1, event_id: 1 });
pipelineRunSchema.index({ company_id: 1, timestamp: -1 });

const PipelineRun = mongoose.model('PipelineRun', pipelineRunSchema);

export default PipelineRun;
