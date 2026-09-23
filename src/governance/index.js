/**
 * Control Tower / governance public API.
 * Coworker (Nova) lives under src/nova — do not import coworkerPipeline here.
 */

export {
  GOVERNANCE_AGENT_DEFINITIONS,
  GOVERNANCE_AGENT_KEYS,
  AEGIS_AGENT_KEY,
  VIGIL_AGENT_KEY,
  isGovernanceAgentKey,
  getGovernanceAgentName,
  pipelineGovernanceAgentKeys,
} from './agents/definitions.js';
export {
  initializeGovernanceAgents,
  getGovernanceAgent,
  getGovernanceAgentKeys,
} from './agents/registry.js';
export {
  getPipelineForEvent,
  listPipelines,
  countActivePipelines,
  PIPELINE_BY_EVENT,
  normalizeEventType,
} from './pipeline/pipelineConfig.js';
export {
  runPipeline,
  startPipelineInBackground,
  stopPipelineRun,
  restartPipelineRun,
  evaluateGovernanceEvent,
} from './pipeline/runner.js';
export { acceptGovernanceEvent } from './pipeline/ingest.js';
export { reconcileOrphanedRuns } from './pipeline/reconcileOrphanedRuns.js';
export {
  runAlertSweep,
  decideAlertAction,
  deleteAlertsPermanently,
  resolveAlertsById,
  backfillMissingResolveReasons,
  LEGACY_RESOLVE_REASON,
  isAlertSweepRunning,
} from './vigil/alertSweep.js';
export { verifyWebhookRequest, verifyWebhookAuth } from './pipeline/verifyWebhook.js';
export { agentStatFromRuns, runBelongsToAgent } from './pipeline/dashboardStats.js';
export {
  eventFromWorxstreamWebhook,
  eventFromWorxstreamDelivery,
} from './pipeline/fromDelivery.js';
export { replayGovernanceDeliveries } from './pipeline/replayDelivery.js';
export {
  reindexDocument,
  removeDocumentChunks,
  syncGovernanceDocumentChunks,
} from './pipeline/rag.js';
export {
  getCatalogContext,
  invalidateCatalogContext,
  refreshCatalogContext,
  catalogForEvent,
} from './pipeline/catalogContext.js';
