import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detectDeterministicAgentKeys } from '../../src/nova/agents/router.js';
import {
  buildToolSelectionHint,
  initialToolChoice,
} from '../../src/nova/agents/toolChoicePolicy.js';

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
