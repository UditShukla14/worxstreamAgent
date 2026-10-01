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

  it('orchestrator getTools uses LLM tool search (or fallback) and excludes governance', async () => {
    const agent = new BaseAgent('nova', AGENT_DEFINITIONS.nova);
    const tools = await agent.getTools('estimate report for the last 2 weeks');
    assert.ok(tools.length > 0, 'orchestrator should have tools');
    assert.ok(tools.length <= 40, 'tool search should cap schemas per turn');
    const names = tools.map((t) => t.name).filter(Boolean);
    const serialized = JSON.stringify(tools);
    assert.ok(!serialized.includes('get_relevant_policies'));
    assert.ok(!serialized.includes('invoke_agent'));
    assert.ok(
      names.includes('generate_estimate_report') || names.includes('resolve_entity'),
      `expected generate_estimate_report or resolve_entity, got: ${names.slice(0, 12).join(', ')}`,
    );
  });

  it('pipeline default path is single Nova with primary LLM streaming (no OutputFormatter)', () => {
    const src = readFileSync(pipelinePath, 'utf8');
    assert.ok(src.includes("type: 'orchestrator'"));
    assert.ok(src.includes("getAgentInstance('nova')"));
    assert.ok(src.includes('_streamAssistantText'));
    assert.ok(!src.includes('formatOutputStreaming'));
    assert.ok(src.includes('getExecutionPlan'));
  });

  it('shared rules are conversation-native with page-wise safety only', () => {
    assert.ok(COWORKER_SHARED_RULES.includes('professional coworker') || COWORKER_SHARED_RULES.includes('ChatGPT/Claude'));
    assert.ok(!COWORKER_SHARED_RULES.includes('ANSWER PROPORTIONALITY'));
    assert.ok(COWORKER_SHARED_RULES.includes('limit=25') || COWORKER_SHARED_RULES.includes('ONE page'));
  });
});
