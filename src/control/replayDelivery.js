/**
 * Replay failed WorxStream deliveries into the governance pipeline.
 * Uses the stored delivery payload. Does not call Laravel to re-POST the webhook.
 */

import { randomUUID } from 'crypto';
import { eventFromWorxstreamWebhook } from './fromDelivery.js';
import { acceptGovernanceEvent } from './ingestEvent.js';

function asRows(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((row) => row && typeof row === 'object' && !Array.isArray(row));
}

function deliveryIdOf(row) {
  return String(row.deliveryId ?? row.delivery_id ?? row.id ?? '').trim();
}

/**
 * @param {object[]} rows
 * @param {{ companyId: string, userId?: string }} ids
 */
export async function replayGovernanceDeliveries(rows, { companyId, userId } = {}) {
  const tenantCompanyId = String(companyId || '').trim();
  const started = [];
  const errors = [];

  for (const row of asRows(rows)) {
    const deliveryId = deliveryIdOf(row);
    const event = eventFromWorxstreamWebhook(row, {
      companyId: tenantCompanyId,
      userId,
      eventType: row.eventCode ?? row.event_code,
      eventId: deliveryId,
    });

    if (event.company_id && tenantCompanyId && event.company_id !== tenantCompanyId) {
      errors.push({ deliveryId, error: 'company_id does not match this session' });
      continue;
    }
    if (!event.event_type) {
      errors.push({ deliveryId, error: 'event_type is required' });
      continue;
    }

    event.company_id = tenantCompanyId || event.company_id;
    event.user_id = event.user_id || (userId != null ? String(userId) : undefined);
    const originalId = event.event_id || deliveryId || 'delivery';
    event.event_id = `${originalId}:redeliver:${randomUUID()}`;

    try {
      const result = await acceptGovernanceEvent(event);
      started.push({
        deliveryId: originalId,
        accepted: result.accepted,
        skipped: result.skipped,
        event_id: result.event_id,
        event_type: result.event_type,
      });
    } catch (error) {
      errors.push({ deliveryId: originalId, error: error.message || 'Pipeline could not be started' });
    }
  }

  return { started, errors };
}
