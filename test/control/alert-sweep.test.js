import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decideAlertAction, actionFromReview } from '../../src/control/alertSweep.js';
import { isGovernanceAgentKey, pipelineGovernanceAgentKeys, VIGIL_AGENT_KEY } from '../../src/control/governanceAgents.js';
import { isChildAgentKey } from '../../src/agents/agentDefinitions.js';

const catalog = {
  policies: [
    { name: 'Credit Hold Policy', status: 'active' },
    { name: 'Inventory Fulfilment Policy', status: 'active' },
    { name: 'Minimum Margin Policy', status: 'draft' },
  ],
  rules: [
    { name: 'Resellers', active: true, eventTypes: ['invoice.created', 'invoice.updated'] },
    { name: 'Flag Low Margin Estimates', active: true, eventTypes: ['estimate.created'] },
    { name: 'Old Stock Rule', active: false, eventTypes: ['product.updated'] },
  ],
};

describe('Vigil alert sweep decisions', () => {
  it('reviews alerts backed by an active policy', () => {
    assert.equal(decideAlertAction({
      triggered_by: 'Credit Hold Policy',
      policy_violated: 'Credit Hold Policy',
      event_type: 'invoice.created',
    }, catalog), 'review');
  });

  it('reviews alerts backed by an active rule that applies to the event', () => {
    assert.equal(decideAlertAction({
      triggered_by: 'Resellers',
      policy_violated: 'Resellers',
      event_type: 'invoice.created',
    }, catalog), 'review');
  });

  it('deletes invented default-threshold alerts that are not in the catalog', () => {
    assert.equal(decideAlertAction({
      triggered_by: 'Gross Margin — Default Threshold',
      policy_violated: 'Gross Margin — Default Threshold',
      event_type: 'invoice.created',
    }, catalog), 'delete');
  });

  it('deletes alerts that only match a draft policy', () => {
    assert.equal(decideAlertAction({
      triggered_by: 'Minimum Margin Policy',
      policy_violated: 'Minimum Margin Policy',
      event_type: 'invoice.created',
    }, catalog), 'delete');
  });

  it('deletes alerts for an active rule that does not apply to the event type', () => {
    assert.equal(decideAlertAction({
      triggered_by: 'Flag Low Margin Estimates',
      policy_violated: 'Flag Low Margin Estimates',
      event_type: 'invoice.created',
    }, catalog), 'delete');
  });

  it('deletes alerts that only match an inactive rule', () => {
    assert.equal(decideAlertAction({
      triggered_by: 'Old Stock Rule',
      policy_violated: 'Old Stock Rule',
      event_type: 'product.updated',
    }, catalog), 'delete');
  });

  it('deletes alerts with no catalog labels', () => {
    assert.equal(decideAlertAction({
      triggered_by: 'Aegis',
      policy_violated: 'N/A — System Error',
      event_type: 'invoice.created',
    }, catalog), 'delete');
  });
});

describe('Vigil status updates from a catalog re-check', () => {
  const alert = {
    triggered_by: 'Credit Hold Policy',
    policy_violated: 'Credit Hold Policy',
    event_type: 'invoice.created',
  };

  it('resolves an open alert when the current check passes', () => {
    assert.equal(actionFromReview(alert, [
      { check: 'Credit Hold Policy', verdict: 'pass', policyViolated: null },
    ], { evaluationOk: true }), 'resolve');
  });

  it('keeps an open alert when the current check still flags', () => {
    assert.equal(actionFromReview(alert, [
      { check: 'Credit Hold Policy', verdict: 'flag', policyViolated: 'Credit Hold Policy' },
    ], { evaluationOk: true }), 'keep');
  });

  it('resolves an open alert when Aegis no longer reports that check', () => {
    assert.equal(actionFromReview(alert, [
      { check: 'Inventory Fulfilment Policy', verdict: 'flag', policyViolated: 'Inventory Fulfilment Policy' },
    ], { evaluationOk: true }), 'resolve');
  });

  it('keeps the alert when the re-check did not return structured findings', () => {
    assert.equal(actionFromReview(alert, [], { evaluationOk: false }), 'keep');
  });
});

describe('Vigil isolation', () => {
  it('is a governance housekeeping key, not a chat child, and not a pipeline agent', () => {
    assert.equal(isGovernanceAgentKey(VIGIL_AGENT_KEY), true);
    assert.equal(isChildAgentKey(VIGIL_AGENT_KEY), false);
    assert.deepEqual(pipelineGovernanceAgentKeys(), ['aegis']);
  });
});
