/**
 * Separate instance map for master (governance) agents.
 * Chat router uses AGENT_DEFINITIONS only — these keys never enter that map.
 */

import { BaseAgent } from '../agents/BaseAgent.js';
import { GOVERNANCE_AGENT_DEFINITIONS } from './governanceAgents.js';

const governanceInstances = new Map();

export function initializeGovernanceAgents() {
  governanceInstances.clear();
  const started = [];
  for (const [key, def] of Object.entries(GOVERNANCE_AGENT_DEFINITIONS)) {
    if (def.housekeeping) continue;
    governanceInstances.set(key, new BaseAgent(key, def));
    started.push(key);
  }
  console.log(`🛡️  Initialized ${governanceInstances.size} governance agents (${started.join(', ')})`);
}

export function getGovernanceAgent(key) {
  return governanceInstances.get(key);
}

export function getGovernanceAgentKeys() {
  return [...governanceInstances.keys()];
}
