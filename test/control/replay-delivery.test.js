import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { eventFromWorxstreamWebhook } from '../../src/control/fromDelivery.js';
import { replayGovernanceDeliveries } from '../../src/control/replayDelivery.js';

describe('failed delivery requestPayload', () => {
  it('runs from the stored WorxStream envelope without a new webhook', () => {
    const event = eventFromWorxstreamWebhook({
      deliveryId: 'whd_20260819_dquwj2lhehot',
      eventCode: 'estimate_updated',
      objectType: 'estimate',
      objectId: 80000019747,
      companyId: 30000000021,
      requestPayload: {
        event: 'estimate_updated',
        deliveryId: 'whd_20260819_dquwj2lhehot',
        companyId: 30000000021,
        object: { type: 'estimate', id: 80000019747 },
        data: {
          companyId: 30000000021,
          customNumber: '26-5153',
          estimateId: null,
          id: 80000019747,
          sections: [{ items: [{ productServiceId: 220000000462 }] }],
        },
      },
    }, { companyId: '30000000021' });

    assert.equal(event.event_type, 'estimate.updated');
    assert.equal(event.company_id, '30000000021');
    assert.equal(event.payload.id, 80000019747);
    assert.equal(event.payload.estimate_id, 80000019747);
    assert.equal(event.payload.sections[0].items[0].productServiceId, 220000000462);
  });
});

describe('replayGovernanceDeliveries', () => {
  it('rejects a mismatched company_id without starting a run', async () => {
    const result = await replayGovernanceDeliveries(
      [{
        deliveryId: 'd1',
        eventCode: 'estimate_updated',
        companyId: '99',
        requestPayload: { event: 'estimate_updated', data: { id: 1 } },
      }],
      { companyId: '21', userId: '1' },
    );
    assert.equal(result.started.length, 0);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0].error, /company_id/);
  });

  it('rejects a row with no event type', async () => {
    const result = await replayGovernanceDeliveries(
      [{ deliveryId: 'd2', requestPayload: { data: { id: 1 } } }],
      { companyId: '21', userId: '1' },
    );
    assert.equal(result.started.length, 0);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0].error, /event_type/);
  });
});
