import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.WORXSTREAM_BASE_URL ||= 'http://localhost';
process.env.ANTHROPIC_API_KEY ||= 'sk-test';

const { COWORKER_SHARED_RULES } = await import('../../src/nova/agents/coworkerRules.js');
const planSource = await import('node:fs').then((fs) => fs.readFileSync(new URL('../../src/nova/agents/executionPlan.js', import.meta.url), 'utf8'));
await import('../../src/mcp/tools/index.js');
const { getToolIndex } = await import('../../src/mcp/toolIndex.js');

describe('the agent knows its mailbox tools exist', () => {
  const mailTools = () => (getToolIndex().byDomain.mail || []).map((t) => t.name);

  it('names every registered mail tool in the shared rules, so the model searches mail instead of asking', () => {
    for (const name of mailTools()) assert.ok(COWORKER_SHARED_RULES.includes(name), `${name} missing from the shared rules`);
    assert.match(COWORKER_SHARED_RULES, /instead of asking which platform/);
  });

  it('tells the planner a mailbox question is never a clarification', () => {
    for (const name of mailTools()) assert.ok(planSource.includes(name), `${name} missing from the planner prompt`);
    assert.match(planSource, /never clarify: do not ask which platform/);
  });

  it('keeps the mail tools reachable by the orchestrator (not governance-only)', () => {
    const domains = new Set((getToolIndex().byDomain.mail || []).map((t) => t.capabilities.domain));
    assert.deepEqual([...domains], ['mail']);
    assert.ok(mailTools().length >= 10);
  });
});
