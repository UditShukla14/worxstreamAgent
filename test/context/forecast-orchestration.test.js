import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detectDeterministicAgentKeys } from '../../src/nova/agents/router.js';
import {
  buildToolSelectionHint,
  initialToolChoice,
} from '../../src/nova/agents/toolChoicePolicy.js';
import {
  detectDomainAgentKeys,
  isKnowledgeOnlyRequest,
  shouldRequireToolUse,
} from '../../src/nova/agents/intentPolicy.js';

const REPORT_TOOLS = [
  { type: 'function', function: { name: 'generate_invoice_report' } },
  { type: 'function', function: { name: 'generate_estimate_report' } },
  { type: 'function', function: { name: 'resolve_entity' } },
];

describe('forecast orchestration', () => {
  it('routes forecast and predictive outlook requests to reports without an LLM decision', () => {
    assert.deepEqual(
      detectDeterministicAgentKeys('Give me a conservative forecasting outlook for Goodman products'),
      ['reports'],
    );
  });

  it('keeps an affirmative follow-up attached to the offered report', () => {
    const history = [{
      role: 'assistant',
      content: 'I can pull the invoice report for the requested forecast. Would you like me to run it?',
    }];
    assert.deepEqual(detectDeterministicAgentKeys('yes', history), ['reports']);
  });

  it('forces invoice history as the first tool for a forecast', () => {
    const choice = initialToolChoice(
      'reports',
      REPORT_TOOLS,
      'forecast Goodman demand from last year purchases',
      true,
    );
    assert.deepEqual(choice, {
      type: 'function',
      function: { name: 'generate_invoice_report' },
    });
  });

  it('carries forecast intent into a short yes follow-up', () => {
    const hint = buildToolSelectionHint('yes', {
      _conversationHistory: [
        { role: 'user', content: 'Forecast Goodman demand from last winter purchases' },
        { role: 'assistant', content: 'Would you like me to pull the report?' },
      ],
    });
    const choice = initialToolChoice('reports', REPORT_TOOLS, hint, true);
    assert.equal(choice.function.name, 'generate_invoice_report');
  });
});

describe('general tool orchestration', () => {
  const invoiceTools = [
    { type: 'function', function: { name: 'list_invoices' } },
    { type: 'function', function: { name: 'get_invoice_details' } },
    { type: 'function', function: { name: 'create_invoice' } },
    { type: 'function', function: { name: 'resolve_entity' } },
  ];

  it('routes common Worxstream domains without depending on the router model', () => {
    assert.deepEqual(detectDomainAgentKeys('show recent invoices for customer Acme'), ['invoice', 'customer']);
    assert.deepEqual(detectDeterministicAgentKeys('show recent invoices for customer Acme'), ['invoice']);
    assert.deepEqual(detectDeterministicAgentKeys('create a purchase order for supplier ABC'), ['purchaseOrder']);
    assert.deepEqual(detectDeterministicAgentKeys('check inventory stock for SKU A1'), ['inventory']);
  });

  it('keeps general affirmative follow-ups on the previous domain', () => {
    const history = [
      { role: 'user', content: 'Show recent invoices for Acme' },
      { role: 'assistant', content: 'Would you like me to pull the invoice list?' },
    ];
    assert.deepEqual(detectDeterministicAgentKeys('go ahead', history), ['invoice']);
  });

  it('does not force tools for general how-to explanations', () => {
    assert.equal(isKnowledgeOnlyRequest('How do I create an invoice?'), true);
    const hint = buildToolSelectionHint('How do I create an invoice?', {});
    assert.equal(shouldRequireToolUse('invoice', hint), false);
    assert.equal(initialToolChoice('invoice', invoiceTools, hint), 'auto');
  });

  it('requires and pins a high-confidence live-data function', () => {
    const hint = buildToolSelectionHint('Show my recent invoices', {});
    assert.equal(shouldRequireToolUse('invoice', hint), true);
    assert.deepEqual(initialToolChoice('invoice', invoiceTools, hint), {
      type: 'function',
      function: { name: 'list_invoices' },
    });
  });

  it('requires a tool for a Nova execution plan even for an uncommon domain', () => {
    const hint = buildToolSelectionHint('Process the requested operation', {
      _executionPlanText: '[Execution plan]\nGoal: Process the operation\nSteps: Call the matching function',
    });
    assert.equal(shouldRequireToolUse('nova', hint), true);
  });
});
