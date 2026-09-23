import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const formatterPath = join(__dirname, '../../src/nova/agents/OutputFormatter.js');
const routerPath = join(__dirname, '../../src/nova/agents/router.js');
const soulPath = join(__dirname, '../../SOUL.md');
const listPoliciesPath = join(__dirname, '../../src/nova/agents/policies/listPolicies.js');

describe('answer proportionality contracts', () => {
  it('formatter uses LLM intent judgment, not phrase maps', () => {
    const src = readFileSync(formatterPath, 'utf8');
    assert.ok(src.includes('Infer intent from the user'));
    assert.ok(src.includes('not from fixed phrase lists'));
    assert.ok(src.includes('LLM judgment'));
    assert.ok(src.includes('keep the rows'));
    assert.ok(!src.includes('Do NOT remove information from the raw data'));
  });

  it('router decides from meaning and context, not keyword examples', () => {
    const src = readFileSync(routerPath, 'utf8');
    assert.ok(src.includes('Decide from meaning and context'));
    assert.ok(!src.includes('how many invoices got paid'));
    assert.ok(src.includes('not keyword lists'));
  });

  it('SOUL includes conversation-based proportionality', () => {
    const soul = readFileSync(soulPath, 'utf8');
    assert.ok(soul.includes('Answer proportionality'));
    assert.ok(soul.includes('full conversation'));
    assert.ok(soul.includes('one Nova agent with MCP tools'));
  });

  it('list policies strip all_pages and clamp page size', () => {
    const src = readFileSync(listPoliciesPath, 'utf8');
    assert.ok(!src.includes('STATUS_KEYWORDS'));
    assert.ok(!src.includes('ALL_HINTS'));
    assert.ok(src.includes('getMaxListPageSize'));
    assert.ok(src.includes('delete next.all_pages') || src.includes("delete next.all_pages"));
    assert.ok(src.includes('shouldFetchAllPages'));
  });
});
