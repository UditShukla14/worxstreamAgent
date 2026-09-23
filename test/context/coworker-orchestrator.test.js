/**
 * Single Nova orchestrator mode (default) — Claude/OpenAI-style tool chat.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

process.env.WORXSTREAM_BASE_URL ||= 'http://localhost';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pipelinePath = join(__dirname, '../../src/nova/agents/coworkerPipeline.js');
const configPath = join(__dirname, '../../src/config/index.js');

await import('../../src/mcp/tools/index.js');
const { AGENT_DEFINITIONS, getAgentDescriptionsForRouter, isChildAgentKey } = await import(
  '../../src/nova/agents/agentDefinitions.js'
);
const { BaseAgent } = await import('../../src/nova/agents/BaseAgent.js');
const { config } = await import('../../src/config/index.js');
const { COWORKER_SHARED_RULES } = await import('../../src/nova/agents/coworkerRules.js');

describe('coworker orchestrator mode', () => {
  it('defaults config.coworker.mode to orchestrator', () => {
    assert.equal(config.coworker.mode, 'orchestrator');
    const src = readFileSync(configPath, 'utf8');
    assert.ok(src.includes("COWORKER_MODE || 'orchestrator'"));
  });

  it('Nova is marked orchestrator with tool-search', () => {
    assert.equal(AGENT_DEFINITIONS.nova.orchestrator, true);
    assert.equal(AGENT_DEFINITIONS.nova.useToolSearch, true);
    assert.ok(AGENT_DEFINITIONS.nova.systemPrompt.includes('function calling'));
  });

  it('router descriptions exclude Nova orchestrator', () => {
    const text = getAgentDescriptionsForRouter();
    assert.ok(!text.includes('"nova"'));
    assert.ok(text.includes('"invoice"'));
    assert.equal(isChildAgentKey('invoice'), true);
    assert.equal(isChildAgentKey('nova'), false);
  });

  it('orchestrator getTools exposes product tools and excludes governance', () => {
    const agent = new BaseAgent('nova', AGENT_DEFINITIONS.nova);
    const tools = agent.getTools();
    assert.ok(tools.length > 0, 'orchestrator should have tools');
    const names = tools
      .map((t) => t.name || t?.input_examples?.[0]?.name)
      .filter(Boolean);
    // Tool-search wrappers may defer names; allow either deferred catalog or explicit names.
    const serialized = JSON.stringify(tools);
    assert.ok(!serialized.includes('get_relevant_policies'));
    assert.ok(!serialized.includes('invoke_agent'));
    assert.ok(
      names.includes('resolve_entity')
      || serialized.includes('resolve_entity')
      || serialized.includes('tool_search')
      || tools.some((t) => t.type === 'tool_search' || t.name === 'tool_search'),
      'expected tool-search or resolve_entity in orchestrator tools',
    );
  });

  it('pipeline default path is single Nova (no router/plan/formatter)', () => {
    const src = readFileSync(pipelinePath, 'utf8');
    assert.ok(src.includes("type: 'orchestrator'"));
    assert.ok(src.includes('forceFormatter'));
    assert.ok(src.includes("getAgentInstance('nova')"));
    assert.ok(src.includes('COWORKER_MODE=specialists') || src.includes("mode !== 'specialists'"));
  });

  it('shared proportionality applies to every kind of question', () => {
    assert.ok(COWORKER_SHARED_RULES.includes('every kind of question'));
    assert.ok(COWORKER_SHARED_RULES.includes('do not hardcode phrase lists'));
  });
});
