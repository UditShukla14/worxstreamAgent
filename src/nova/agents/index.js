/**
 * Multi-Agent System — public API.
 *
 * Usage:
 *   import { initializeAgents, runCoworkerTurn, callAgent } from './agents/index.js';
 *
 *   // At startup (after MCP tools are registered):
 *   initializeAgents();
 *
 *   // Unified pipeline (routing + execution + formatting):
 *   const result = await runCoworkerTurn({ message: "list all estimates", ... });
 *
 *   // Direct call:
 *   const result = await callAgent("estimate", "list all estimates");
 */

export {
  AGENT_DEFINITIONS,
  getAgentKeys,
  getStatusLabelForAgent,
  STATUS_LABEL_THINKING,
  STATUS_LABEL_FORMATTING,
} from './agentDefinitions.js';
export { BaseAgent } from './BaseAgent.js';
export { formatOutput, formatOutputStreaming } from './OutputFormatter.js';
export {
  getContext,
  updateContext,
  buildContextPrompt,
  clearContext,
  applyClarificationPick,
  saveContext,
} from './ConversationContext.js';
export {
  runCoworkerTurn,
  runConfirmAction,
  deleteConversationFull,
  loadConversationState,
} from './coworkerPipeline.js';
export {
  initializeAgentInstances as initializeAgents,
  getAgentInstance,
  getAllAgentInstances,
  resolveAgentKeys,
  callAgent,
} from './router.js';
