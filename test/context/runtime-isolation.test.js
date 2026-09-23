/**
 * Phase 0 isolation: Nova coworker vs Control Tower governance.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { getAgentKeys, AGENT_DEFINITIONS } from '../../src/nova/agents/agentDefinitions.js';
import {
  GOVERNANCE_AGENT_KEYS,
  isGovernanceAgentKey,
  AEGIS_AGENT_KEY,
  VIGIL_AGENT_KEY,
} from '../../src/governance/agents/definitions.js';
import { GovernanceAgent } from '../../src/governance/agents/GovernanceAgent.js';
import { BaseAgent } from '../../src/nova/agents/BaseAgent.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../..');

describe('nova vs governance isolation', () => {
  it('chat agent keys never include aegis or vigil', () => {
    const keys = getAgentKeys();
    assert.ok(!keys.includes(AEGIS_AGENT_KEY));
    assert.ok(!keys.includes(VIGIL_AGENT_KEY));
    assert.ok(Object.prototype.hasOwnProperty.call(AGENT_DEFINITIONS, 'nova'));
  });

  it('governance keys are only aegis/vigil family', () => {
    assert.ok(isGovernanceAgentKey(AEGIS_AGENT_KEY));
    assert.ok(isGovernanceAgentKey(VIGIL_AGENT_KEY));
    for (const key of GOVERNANCE_AGENT_KEYS) {
      assert.ok(!Object.prototype.hasOwnProperty.call(AGENT_DEFINITIONS, key));
    }
  });

  it('GovernanceAgent does not load SOUL.md into its prompt', () => {
    const soul = readFileSync(join(repoRoot, 'SOUL.md'), 'utf8');
    const agent = new GovernanceAgent('aegis', {
      name: 'aegis_agent',
      description: 'test',
      domain: 'governance',
      systemPrompt: 'GOVERNANCE_ONLY_PROMPT',
      extraTools: [],
    });
    assert.equal(agent.systemPrompt, 'GOVERNANCE_ONLY_PROMPT');
    assert.ok(!agent.systemPrompt.includes(soul.slice(0, 40)));
  });

  it('BaseAgent and GovernanceAgent are distinct classes', () => {
    assert.notEqual(BaseAgent, GovernanceAgent);
  });

  it('legacy src/agents and src/control folders are gone', () => {
    assert.equal(existsSync(join(repoRoot, 'src/agents')), false);
    assert.equal(existsSync(join(repoRoot, 'src/control')), false);
  });
});
