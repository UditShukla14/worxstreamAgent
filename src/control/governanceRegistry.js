/**
 * Separate instance map for master (governance) agents.
 * Chat router uses AGENT_DEFINITIONS only — these keys never enter that map.
 */

import { BaseAgent } from '../agents/BaseAgent.js';
import { GOVERNANCE_AGENT_DEFINITIONS, GOVERNANCE_AGENT_KEYS } from './governanceAgents.js';

const governanceInstances = new Map();

export function initializeGovernanceAgents() {
  governanceInstances.clear();
  for (const [key, def] of Object.entries(GOVERNANCE_AGENT_DEFINITIONS)) {
    governanceInstances.set(key, new BaseAgent(key, def));
  }
  console.log(`🛡️  Initialized ${governanceInstances.size} governance agents (${GOVERNANCE_AGENT_KEYS.join(', ')})`);
}

export function getGovernanceAgent(key) {
  return governanceInstances.get(key);
}

export function getGovernanceAgentKeys() {
  return [...governanceInstances.keys()];
}
