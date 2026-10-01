/**
 * Unit tests for local tool-search helpers (LLM picker + keyword fallback).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  detectToolIntent,
  selectToolsForTurn,
} from '../src/mcp/selectToolsForTurn.js';

const CATALOG = [
  { name: 'resolve_entity', description: 'Resolve name to ID' },
  { name: 'list_estimates', description: 'List estimates page' },
  { name: 'generate_estimate_report', description: 'Estimate analytics report' },
  { name: 'list_invoices', description: 'List invoices page' },
  { name: 'generate_invoice_report', description: 'Invoice analytics report' },
  { name: 'get_report_filters', description: 'Report filters' },
  { name: 'draft_sms', description: 'Draft SMS' },
  { name: 'send_sms', description: 'Send SMS' },
  { name: 'get_sms_status', description: 'SMS status' },
  { name: 'list_customers', description: 'List customers' },
];

describe('selectToolsForTurn (keyword fallback)', () => {
  it('detects report + estimate intent', () => {
    const intent = detectToolIntent('need estimate report for last 2 weeks');
    assert.equal(intent.wantsReport, true);
    assert.ok(intent.entityHints.includes('estimate'));
  });

  it('prefers generate_estimate_report over list_estimates for report asks', () => {
    const picked = selectToolsForTurn(CATALOG, 'Provide an estimate report for the last two weeks', {
      maxTools: 12,
    });
    const names = picked.map((t) => t.name);
    assert.ok(names.includes('generate_estimate_report'));
    assert.ok(names.includes('get_report_filters') || names.includes('resolve_entity'));
    assert.ok(!names.includes('list_estimates') || names.indexOf('generate_estimate_report') < names.indexOf('list_estimates'));
  });
});
