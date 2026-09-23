/**
 * Accept a governance event, dedupe by (company_id, event_id), run the pipeline.
 */

import { randomUUID } from 'crypto';
import ProcessedEvent from '../models/ProcessedEvent.js';
import PipelineRun from '../models/PipelineRun.js';
import { startPipelineInBackground } from './pipelineRunner.js';
import { getPipelineForEvent, normalizeEventType } from './pipelineConfig.js';
import { getDefaultTenantIds } from '../config/index.js';

/**
 * @param {object} input
 * @returns {Promise<{
 *   accepted: boolean,
 *   duplicate: boolean,
 *   skipped: boolean,
 *   reason?: string,
 *   event_id: string,
 *   event_type: string,
 *   pipeline: string[],
 * }>}
 */
export async function acceptGovernanceEvent(input) {
  const eventType = normalizeEventType(input?.event_type);
  if (!eventType) {
    const error = new Error('event_type is required');
    error.status = 400;
    throw error;
  }

  const defaults = getDefaultTenantIds();
  const companyId = input?.company_id != null ? String(input.company_id) : defaults.companyId;
  const userId = input?.user_id != null ? String(input.user_id) : defaults.userId;
  const eventId = input?.event_id != null && String(input.event_id).trim()
    ? String(input.event_id).trim()
    : `evt_${randomUUID()}`;
  const pipeline = getPipelineForEvent(eventType);

  const event = {
    event_type: eventType,
    event_id: eventId,
    timestamp: input?.timestamp || new Date().toISOString(),
    company_id: companyId,
    user_id: userId,
    payload: input?.payload && typeof input.payload === 'object' ? input.payload : {},
  };

  try {
    await ProcessedEvent.create({
      company_id: companyId,
      event_id: eventId,
      event_type: eventType,
    });
  } catch (error) {
    if (error?.code === 11000) {
      const existingRun = await PipelineRun.findOne({
        company_id: companyId,
        event_id: eventId,
      }).select('_id status').lean();
      if (!existingRun && pipeline.length > 0) {
        startPipelineInBackground(event);
        return {
          accepted: true,
          duplicate: false,
          skipped: false,
          event_id: eventId,
          event_type: eventType,
          pipeline,
        };
      }
      return {
        accepted: false,
        duplicate: true,
        skipped: false,
        event_id: eventId,
        event_type: eventType,
        pipeline,
      };
    }
    throw error;
  }

  if (pipeline.length === 0) {
    return {
      accepted: false,
      duplicate: false,
      skipped: true,
      reason: 'no_pipeline',
      event_id: eventId,
      event_type: eventType,
      pipeline,
    };
  }

  startPipelineInBackground(event);

  return {
    accepted: true,
    duplicate: false,
    skipped: false,
    event_id: eventId,
    event_type: eventType,
    pipeline,
  };
}

