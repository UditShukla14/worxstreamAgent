import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const formatterPath = join(__dirname, '../../src/nova/agents/OutputFormatter.js');
const routerPath = join(__dirname, '../../src/nova/agents/router.js');
const soulPath = join(__dirname, '../../SOUL.md');

describe('answer proportionality contracts', () => {
  it('formatter synthesizes for the question and may trim dumps', () => {
    const src = readFileSync(formatterPath, 'utf8');
    assert.ok(src.includes('SYNTHESIZE for the user\'s question'));
    assert.ok(!src.includes('Do NOT remove information from the raw data'));
    assert.ok(src.includes('Count / total'));
    assert.ok(src.includes('Charts only for report/analytics'));
  });

  it('router prefers entity agents for counts over reports', () => {
    const src = readFileSync(routerPath, 'utf8');
    assert.ok(src.includes('NOT reports'));
    assert.ok(src.includes('how many invoices got paid'));
  });

  it('SOUL includes answer proportionality and single-orchestrator identity', () => {
    const soul = readFileSync(soulPath, 'utf8');
    assert.ok(soul.includes('Answer proportionality'));
    assert.ok(soul.includes('one Nova agent with MCP tools'));
  });
});
