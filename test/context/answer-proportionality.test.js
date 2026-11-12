import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { COWORKER_SHARED_RULES } from '../../src/nova/agents/coworkerRules.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const formatterPath = join(__dirname, '../../src/nova/agents/OutputFormatter.js');
const routerPath = join(__dirname, '../../src/nova/agents/router.js');
const soulPath = join(__dirname, '../../SOUL.md');
const listPoliciesPath = join(__dirname, '../../src/nova/agents/policies/listPolicies.js');

describe('llm-native answer contracts (no shape taxonomy)', () => {
  it('coworkerRules has no ANSWER PROPORTIONALITY taxonomy', () => {
    assert.ok(!COWORKER_SHARED_RULES.includes('ANSWER PROPORTIONALITY'));
    assert.ok(COWORKER_SHARED_RULES.includes('you choose the representation'));
    assert.ok(COWORKER_SHARED_RULES.includes('one page at a time'));
  });

  it('shared rules let the model choose the representation and teach only what the UI renders', () => {
    assert.ok(COWORKER_SHARED_RULES.includes('Presenting answers'));
    assert.ok(COWORKER_SHARED_RULES.includes('Markdown table'));
    assert.ok(COWORKER_SHARED_RULES.includes('<stats>'));
    assert.ok(COWORKER_SHARED_RULES.includes('<chart-data'));
    assert.ok(COWORKER_SHARED_RULES.includes('instead of counting rows yourself'));
    assert.ok(COWORKER_SHARED_RULES.includes('"Showing N of M"'));
  });

  it('prompt base stays lean (context budget) and free of shouting', () => {
    assert.ok(COWORKER_SHARED_RULES.length < 5200, `shared rules grew to ${COWORKER_SHARED_RULES.length} chars`);
    assert.ok(!/\b(CRITICAL|MUST|NEVER|ALWAYS)\b/.test(COWORKER_SHARED_RULES));
    const soul = readFileSync(soulPath, 'utf8');
    assert.ok(soul.length < 3200, `SOUL.md grew to ${soul.length} chars`);
    assert.ok(!/\b(CRITICAL|MUST|NEVER|ALWAYS)\b/.test(soul));
  });

  it('formatter preserves agent intent and restores UI chrome', () => {
    const src = readFileSync(formatterPath, 'utf8');
    assert.ok(src.includes('Do NOT replace a list of rows with a prose summary'));
    assert.ok(src.includes('<table'));
    assert.ok(src.includes('badge='));
    assert.ok(src.includes('status="'));
    assert.ok(src.includes('<details'));
    assert.ok(src.includes('<stats'));
  });

  it('router decides from meaning and context, not keyword examples', () => {
    const src = readFileSync(routerPath, 'utf8');
    assert.ok(src.includes('Decide from meaning and context'));
    assert.ok(!src.includes('how many invoices got paid'));
  });

  it('SOUL does not hardcode answer-shape taxonomy', () => {
    const soul = readFileSync(soulPath, 'utf8');
    assert.ok(!soul.includes('Answer proportionality'));
  });

  it('list policies strip all_pages and clamp page size', () => {
    const src = readFileSync(listPoliciesPath, 'utf8');
    assert.ok(src.includes('getMaxListPageSize'));
    assert.ok(src.includes('delete next.all_pages'));
  });
});
