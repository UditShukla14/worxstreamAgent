/**
 * Multi-Agent System — public API.
 *
 * Usage:
 *   import { initializeAgents, routeToAgents, callAgent, callAgentsParallel } from './agents/index.js';
 *
 *   // At startup (after MCP tools are registered):
 *   initializeAgents();
 *
 *   // Auto-route:
 *   const result = await routeToAgents("list all estimates");
 *
 *   // Direct call:
 *   const result = await callAgent("estimate", "list all estimates");
 *
 *   // Parallel:
 *   const results = await callAgentsParallel(["customer", "invoice"], "...");
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
export { getContext, updateContext, buildContextPrompt, clearContext } from './ConversationContext.js';
export {
  initializeAgentInstances as initializeAgents,
  getAgentInstance,
  getAllAgentInstances,
  routeToAgents,
  resolveAgentKeys,
  callAgent,
  callAgentsParallel,
  callAgentsSequential,
} from './router.js';
