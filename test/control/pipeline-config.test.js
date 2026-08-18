import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getPipelineForEvent, listPipelines } from '../../src/control/pipelineConfig.js';
import { eventFromWorxstreamDelivery } from '../../src/control/fromDelivery.js';
import { isChildAgentKey } from '../../src/agents/agentDefinitions.js';
import { isGovernanceAgentKey } from '../../src/control/governanceAgents.js';
import { parseAgentVerdict, parseGovernanceFindings, runStatusFromSteps, stripJsonCodeFence } from '../../src/control/parseVerdict.js';
import { entityLabelFromPayload, buildRagQuery, buildMasterMessage } from '../../src/control/contextBuilder.js';
import { tokenize, chunkText, scoreChunk } from '../../src/control/rag.js';

describe('pipeline config', () => {
  it('maps governed events to Aegis', () => {
    assert.deepEqual(getPipelineForEvent('estimate.created'), ['aegis']);
  });

  it('normalizes Worxstream snake_case catalog codes without flattening entity names', () => {
    assert.deepEqual(getPipelineForEvent('estimate_created'), ['aegis']);
    assert.deepEqual(getPipelineForEvent('credit_memo_created'), ['aegis']);
    assert.deepEqual(getPipelineForEvent('invoice_paid'), ['aegis']);
    assert.deepEqual(getPipelineForEvent('estimateCreated'), ['aegis']);
    assert.deepEqual(getPipelineForEvent('creditMemoCreated'), ['aegis']);
  });

  it('returns an empty pipeline for unknown events', () => {
    assert.deepEqual(getPipelineForEvent('unknown.event'), []);
    assert.deepEqual(getPipelineForEvent(''), []);
  });

  it('lists every configured pipeline', () => {
    const listed = listPipelines();
    assert.ok(listed.length >= 8);
    assert.ok(listed.every((row) => row.eventType && Array.isArray(row.agents)));
    assert.ok(listed.every((row) => row.agents.length === 1 && row.agents[0] === 'aegis'));
  });
});

describe('eventFromWorxstreamDelivery', () => {
  it('maps catalog event_code and object ids into a pipeline event', () => {
    const event = eventFromWorxstreamDelivery(
      {
        deliveryId: 'del_1',
        eventCode: 'estimate_created',
        objectType: 'estimate',
        objectId: 1001,
        requestPayload: { total: 500, margin_pct: 12 },
        companyId: 1,
      },
      { companyId: '1', userId: '9' },
    );

    assert.equal(event.event_type, 'estimate.created');
    assert.equal(event.event_id, 'del_1');
    assert.equal(event.company_id, '1');
    assert.equal(event.payload.estimate_id, 1001);
    assert.equal(event.payload.total, 500);
  });

  it('prefers envelope event_id and nested payload', () => {
    const event = eventFromWorxstreamDelivery(
      {
        deliveryId: 'del_2',
        eventCode: 'credit_memo_created',
        requestPayload: {
          event_type: 'credit_memo.created',
          event_id: 'evt_abc',
          payload: { credit_memo_id: 44, amount: 20 },
        },
      },
      { companyId: '1' },
    );

    assert.equal(event.event_type, 'credit_memo.created');
    assert.equal(event.event_id, 'evt_abc');
    assert.equal(event.payload.credit_memo_id, 44);
    assert.equal(event.payload.event_type, undefined);
  });

  it('does not let an empty nested payload wipe delivery object ids', () => {
    const event = eventFromWorxstreamDelivery(
      {
        deliveryId: 'del_3',
        eventCode: 'estimate_created',
        objectType: 'estimate',
        objectId: 80000017810,
        requestPayload: { payload: {} },
      },
      { companyId: '1', userId: '9' },
    );

    assert.equal(event.event_type, 'estimate.created');
    assert.equal(event.payload.estimate_id, 80000017810);
  });

  it('infers estimate_id from event code when objectType is missing', () => {
    const event = eventFromWorxstreamDelivery(
      {
        deliveryId: 'del_4',
        eventCode: 'estimate_created',
        objectId: 99,
        requestPayload: {},
      },
      { companyId: '1' },
    );

    assert.equal(event.payload.estimate_id, 99);
  });
});

describe('agent isolation', () => {
  it('keeps chat keys and governance keys in separate sets', () => {
    assert.equal(isChildAgentKey('estimate'), true);
    assert.equal(isChildAgentKey('aegis'), false);
    assert.equal(isChildAgentKey('nova'), false);
    assert.equal(isGovernanceAgentKey('aegis'), true);
    assert.equal(isGovernanceAgentKey('profitPolicy'), false);
    assert.equal(isGovernanceAgentKey('estimate'), false);
  });
});

describe('parseAgentVerdict', () => {
  it('parses fenced JSON', () => {
    const raw = '```json\n{"verdict":"flag","severity":"critical","message":"Low margin","detail":"14%","policyViolated":"Minimum Margin Policy","suggestedAction":"Reprice","relatedEntity":"Estimate #1"}\n```';
    const parsed = parseAgentVerdict(raw);
    assert.equal(parsed.verdict, 'flag');
    assert.equal(parsed.severity, 'critical');
    assert.equal(parsed.policyViolated, 'Minimum Margin Policy');
  });

  it('defaults missing flag severity to warning', () => {
    const parsed = parseAgentVerdict('{"verdict":"flag","message":"Hold","detail":"3 overdue"}');
    assert.equal(parsed.verdict, 'flag');
    assert.equal(parsed.severity, 'warning');
  });

  it('treats unparseable text as error', () => {
    const parsed = parseAgentVerdict('not json at all');
    assert.equal(parsed.verdict, 'error');
  });

  it('strips code fences', () => {
    assert.equal(stripJsonCodeFence('```json\n{}\n```'), '{}');
  });

  it('derives run status from steps', () => {
    assert.equal(runStatusFromSteps([{ verdict: 'pass' }, { verdict: 'flag' }]), 'flagged');
    assert.equal(runStatusFromSteps([{ verdict: 'pass' }]), 'pass');
    assert.equal(runStatusFromSteps([{ verdict: 'error' }]), 'error');
    assert.equal(runStatusFromSteps([]), 'error');
    assert.equal(runStatusFromSteps([{ verdict: 'pass' }, { verdict: 'skipped' }]), 'pass');
    assert.equal(runStatusFromSteps([{ verdict: 'flag' }, { verdict: 'skipped' }]), 'flagged');
    assert.equal(runStatusFromSteps([{ verdict: 'pass' }, { verdict: 'running' }]), 'error');
    assert.equal(runStatusFromSteps([{ verdict: 'skipped' }]), 'error');
  });
});

describe('parseGovernanceFindings', () => {
  it('expands findings into one check per policy', () => {
    const findings = parseGovernanceFindings(JSON.stringify({
      verdict: 'flag',
      findings: [
        { check: 'Minimum Margin Policy', verdict: 'flag', severity: 'critical', message: 'Low margin', detail: '5%' },
        { check: 'Customer Credit Hold', verdict: 'pass', message: 'Ok', detail: 'No overdue' },
      ],
    }));
    assert.equal(findings.length, 2);
    assert.equal(findings[0].verdict, 'flag');
    assert.equal(findings[0].check, 'Minimum Margin Policy');
    assert.match(findings[0].agentKey, /^aegis_/);
    assert.equal(findings[1].verdict, 'pass');
  });

  it('wraps a legacy single verdict as one finding', () => {
    const findings = parseGovernanceFindings('{"verdict":"pass","message":"Ok","detail":"fine"}');
    assert.equal(findings.length, 1);
    assert.equal(findings[0].verdict, 'pass');
  });
});

describe('context builder + rag scoring', () => {
  it('labels entities from payload', () => {
    assert.equal(entityLabelFromPayload({ estimate_id: 1001 }), 'Estimate #1001');
    assert.equal(entityLabelFromPayload({ estimate_number: '26-3797-3', estimate_id: 8001 }), 'Estimate #26-3797-3');
    assert.equal(entityLabelFromPayload({ customer_id: 9, name: 'Acme' }), 'Acme (Customer #9)');
  });

  it('builds a query that includes the agent and event', () => {
    const q = buildRagQuery('estimate.created', 'aegis', { estimate_id: 1 });
    assert.match(q, /aegis/);
    assert.match(q, /estimate.created/);
    assert.match(q, /policy/);
  });

  it('chunks long text and scores overlap', () => {
    const chunks = chunkText('Margin policy.\n\nMinimum 20%.\n\nEscalate below 10%.', 40);
    assert.ok(chunks.length >= 1);
    const tokens = tokenize('profit margin policy estimate 20');
    assert.ok(scoreChunk(tokens, 'Minimum margin policy of 20 percent') > 0);
    assert.equal(scoreChunk(tokens, 'zzz'), 0);
  });

  it('injects the shared snapshot into the master message', () => {
    const message = buildMasterMessage({
      eventType: 'estimate.created',
      payload: { estimate_id: 1 },
      companyId: '1',
      ragChunks: [],
      agentKey: 'customerCheck',
      snapshot: { ids: { estimate_id: 1, customer_id: 9 }, entity: { id: 1 }, errors: [] },
    });
    assert.match(message, /SHARED ENTITY SNAPSHOT/);
    assert.match(message, /customer_id": 9/);
    assert.match(message, /Do not call list_estimates/);
  });
});

describe('shared governance context', () => {
  it('extracts ids and maps product qty to stock_qty', async () => {
    const { extractEntityIds, pickStockQty, compactProduct } = await import('../../src/control/hydrateSharedContext.js');
    assert.equal(extractEntityIds({ estimate_id: 1, customer_id: 2 }, 'estimate.created').customer_id, 2);
    assert.deepEqual(pickStockQty({ qty: 12 }), { stock_qty: 12, stock_field: 'qty' });
    assert.equal(pickStockQty({}).stock_qty, null);
    const product = compactProduct({ id: 9, title: 'AC', qty: 4, cost_price: 10 });
    assert.equal(product.stock_qty, 4);
    assert.equal(product.stock_field, 'qty');
  });
});
