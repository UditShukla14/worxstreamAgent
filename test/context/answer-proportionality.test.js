import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { COWORKER_SHARED_RULES } from '../../src/nova/agents/coworkerRules.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const routerPath = join(__dirname, '../../src/nova/agents/router.js');
const soulPath = join(__dirname, '../../SOUL.md');
const listPoliciesPath = join(__dirname, '../../src/nova/agents/policies/listPolicies.js');
const pipelinePath = join(__dirname, '../../src/nova/agents/coworkerPipeline.js');

describe('llm-native answer contracts (no shape taxonomy)', () => {
  it('coworkerRules has no ANSWER PROPORTIONALITY taxonomy', () => {
    assert.ok(!COWORKER_SHARED_RULES.includes('ANSWER PROPORTIONALITY'));
    assert.ok(COWORKER_SHARED_RULES.includes('professional coworker') || COWORKER_SHARED_RULES.includes('ChatGPT/Claude'));
    assert.ok(COWORKER_SHARED_RULES.includes('ONE page') || COWORKER_SHARED_RULES.includes('limit=25'));
  });

  it('primary LLM owns presentation — no OutputFormatter pass', () => {
    assert.ok(COWORKER_SHARED_RULES.includes('PRESENTATION'));
    assert.ok(COWORKER_SHARED_RULES.includes('<table'));
    assert.ok(COWORKER_SHARED_RULES.includes('<stats'));
    assert.ok(COWORKER_SHARED_RULES.includes('<chart'));
    const pipeline = readFileSync(pipelinePath, 'utf8');
    assert.ok(!pipeline.includes('formatOutputStreaming'));
    assert.ok(!pipeline.includes('formatOutput('));
    assert.ok(pipeline.includes('_streamAssistantText'));
  });

  it('router decides from meaning and context, not keyword examples', () => {
    const src = readFileSync(routerPath, 'utf8');
    assert.ok(src.includes('Decide from meaning and context'));
    assert.ok(!src.includes('how many invoices got paid'));
  });

  it('SOUL does not hardcode answer-shape taxonomy', () => {
    const soul = readFileSync(soulPath, 'utf8');
    assert.ok(soul.includes('professional') || soul.includes('ChatGPT/Claude'));
    assert.ok(!soul.includes('Answer proportionality'));
    assert.ok(soul.includes('every returned row') || soul.includes('EVERY returned row') || soul.includes('25 rows'));
  });

  it('list policies keep page-wise safety', () => {
    const src = readFileSync(listPoliciesPath, 'utf8');
    assert.ok(src.includes('all_pages') || src.includes('getMaxListPageSize'));
  });
});
