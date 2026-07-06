import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Importing the tools index pulls in config/httpClient, which read
// WORXSTREAM_BASE_URL at module load. Set it before the dynamic imports
// below (static imports would hoist above this assignment).
process.env.WORXSTREAM_BASE_URL ||= 'http://localhost';

await import('../../src/mcp/tools/index.js'); // side effect: registers all tools
const { getToolIndex } = await import('../../src/mcp/toolIndex.js');
const { AGENT_DEFINITIONS } = await import('../../src/agents/agentDefinitions.js');
const { ENTITY_LOOKUPS } = await import('../../src/mcp/tools/lookup.js');

const index = getToolIndex();

const AGENT_DOMAINS = new Set(
  Object.values(AGENT_DEFINITIONS)
    .map((def) => def.domain)
    .filter((d) => d && d !== 'none'),
);
// 'reports' has its own agent handling; 'lookup' is the universal resolve_entity
// bucket auto-included for every agent by BaseAgent.getTools().
const KNOWN_DOMAINS = new Set([...AGENT_DOMAINS, 'reports', 'lookup']);

function bucketNames(domain) {
  return (index.byDomain[domain] || []).map((t) => t.name);
}

describe('agent tool domains', () => {
  it('every agent domain has at least one tool in its union bucket', () => {
    for (const [key, def] of Object.entries(AGENT_DEFINITIONS)) {
      if (!def.domain || def.domain === 'none') continue;
      const domains = def.domains || [def.domain];
      const union = domains.flatMap((d) => bucketNames(d));
      assert.ok(
        union.length > 0,
        `agent "${key}" has no tools for domain(s) [${domains.join(', ')}]`,
      );
    }
  });

  it('no registered tool lands in unknown or an orphan domain', () => {
    for (const tool of index.tools) {
      const domain = tool?.capabilities?.domain || 'unknown';
      assert.ok(
        KNOWN_DOMAINS.has(domain),
        `tool "${tool.name}" has non-agent domain "${domain}"`,
      );
    }
  });

  it('organization contacts belong to company, not the CRM contact bucket', () => {
    assert.ok(!bucketNames('contact').includes('list_organization_contacts'));
    assert.ok(bucketNames('company').includes('list_organization_contacts'));
  });

  it('hr/finance/company tools land in their agent buckets', () => {
    assert.ok(bucketNames('hr').includes('list_departments'));
    assert.ok(bucketNames('finance').includes('list_taxes'));
    assert.ok(bucketNames('company').includes('list_branches'));
  });

  it('every extraTools entry refers to a registered tool', () => {
    const registered = new Set(index.tools.map((t) => t.name));
    for (const [key, def] of Object.entries(AGENT_DEFINITIONS)) {
      for (const name of def.extraTools || []) {
        assert.ok(
          registered.has(name),
          `agent "${key}" extraTools entry "${name}" is not a registered tool`,
        );
      }
    }
  });

  it('task agent can resolve assignees via cross-domain lookups', () => {
    assert.ok(AGENT_DEFINITIONS.task.extraTools.includes('get_team_members_dropdown'));
    assert.ok(AGENT_DEFINITIONS.task.extraTools.includes('list_team_members'));
  });

  it('resolve_entity lands in the universal lookup bucket', () => {
    assert.ok(bucketNames('lookup').includes('resolve_entity'));
  });

  it('every resolve_entity dispatch target is a registered tool', () => {
    const registered = new Set(index.tools.map((t) => t.name));
    for (const [entityType, { tool }] of Object.entries(ENTITY_LOOKUPS)) {
      assert.ok(
        registered.has(tool),
        `resolve_entity dispatch for "${entityType}" points to unregistered tool "${tool}"`,
      );
    }
  });
});
