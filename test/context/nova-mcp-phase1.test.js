import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  extractNumericThreshold,
  mergeStructuredOverLlm,
  runStructuredCatalogChecks,
} from '../../src/governance/pipeline/structuredChecks.js';
import { stripDuplicatedSharedRules, COWORKER_SHARED_RULES } from '../../src/nova/agents/coworkerRules.js';
import { isPublicMcpTool } from '../../src/nova/mcpSurface.js';
import { listPlaybookDomains, getPlaybookForDomain } from '../../src/nova/agents/playbooks.js';
import { AGENT_DEFINITIONS } from '../../src/nova/agents/agentDefinitions.js';

describe('coworker shared rules', () => {
  it('strips duplicated DATE/STATUS/INTER-AGENT blocks', () => {
    const raw = `You are X.\nDATE AWARENESS: foo bar\nmore\nSTATUS FILTERING: baz\nINTER-AGENT: qux\nTOOL USAGE:\n- list`;
    const cleaned = stripDuplicatedSharedRules(raw);
    assert.ok(!cleaned.includes('DATE AWARENESS'));
    assert.ok(!cleaned.includes('STATUS FILTERING'));
    assert.ok(!cleaned.includes('INTER-AGENT'));
    assert.ok(cleaned.includes('TOOL USAGE'));
    assert.ok(COWORKER_SHARED_RULES.includes('DATE AWARENESS'));
  });

  it('includes conversation-native answering without shape taxonomy', () => {
    assert.ok(COWORKER_SHARED_RULES.includes('Answer naturally from conversation'));
    assert.ok(!COWORKER_SHARED_RULES.includes('ANSWER PROPORTIONALITY'));
    assert.ok(COWORKER_SHARED_RULES.includes('ONE page'));
  });

  it('nova is the default tool-using orchestrator', () => {
    assert.equal(AGENT_DEFINITIONS.nova.orchestrator, true);
    assert.equal(AGENT_DEFINITIONS.nova.useToolSearch, true);
    assert.ok(!/ANSWER PROPORTIONALITY \(always/i.test(AGENT_DEFINITIONS.nova.systemPrompt));
  });

  it('crm pilot uses crm+deal domains and tool search', () => {
    assert.deepEqual(AGENT_DEFINITIONS.crm.domains, ['crm', 'deal']);
    assert.equal(AGENT_DEFINITIONS.crm.useToolSearch, true);
    assert.equal(AGENT_DEFINITIONS.communications.useToolSearch, true);
  });

  it('reports agent no longer mandates charts for every numerical answer', () => {
    const prompt = AGENT_DEFINITIONS.reports.systemPrompt;
    assert.ok(!/VISUAL PRESENTATION \(MANDATORY\)/i.test(prompt));
    assert.ok(/narrow metric|proportional/i.test(prompt));
  });

  it('reports playbook includes chart XML fragment', () => {
    assert.ok(listPlaybookDomains().includes('reports'));
    const text = getPlaybookForDomain('reports');
    assert.ok(text.includes('<chart'));
  });
});

describe('public MCP face', () => {
  it('excludes governance tools from public MCP', () => {
    assert.equal(isPublicMcpTool('get_relevant_policies', { domain: 'governance' }), false);
    assert.equal(isPublicMcpTool('invoke_agent', { domain: 'governance' }), false);
    assert.equal(isPublicMcpTool('list_estimates', { domain: 'estimate' }), true);
  });
});

describe('structured catalog checks', () => {
  it('extracts margin and stock thresholds from catalog text', () => {
    assert.deepEqual(extractNumericThreshold('Flag when margin is below 20%'), {
      kind: 'margin_below',
      threshold: 20,
    });
    assert.deepEqual(extractNumericThreshold('Reorder when stock less than 5'), {
      kind: 'stock_below',
      threshold: 5,
    });
    assert.equal(extractNumericThreshold('Be nice to customers'), null);
  });

  it('flags low margin from payload without inventing thresholds', () => {
    const findings = runStructuredCatalogChecks({
      catalogItems: [{ name: 'Flag Low Margin Estimates', content: 'margin below 20%' }],
      payload: { grossProfitPercentage: 12 },
    });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].verdict, 'flag');
    assert.equal(findings[0].structured, true);
  });

  it('does nothing when catalog text has no numeric pattern', () => {
    const findings = runStructuredCatalogChecks({
      catalogItems: [{ name: 'Credit Hold', content: 'Review overdue invoices carefully' }],
      payload: { grossProfitPercentage: 5 },
    });
    assert.equal(findings.length, 0);
  });

  it('structured findings win over LLM for the same check name', () => {
    const merged = mergeStructuredOverLlm(
      [{ check: 'Flag Low Margin Estimates', verdict: 'pass' }],
      [{ check: 'Flag Low Margin Estimates', verdict: 'flag', structured: true }],
    );
    assert.equal(merged.length, 1);
    assert.equal(merged[0].verdict, 'flag');
  });
});
