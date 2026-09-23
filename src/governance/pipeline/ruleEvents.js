/**
 * Rules can apply to one or more webhook events.
 * `event_type` is the first/legacy field; `event_types` is the full list.
 */

import { normalizeEventType } from './pipelineConfig.js';

function uniqueNormalized(values) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => normalizeEventType(value))
      .filter(Boolean),
  )];
}

function asEventList(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    return raw.includes(',') ? raw.split(',') : [raw];
  }
  return [];
}

export function eventTypesFromRule(rule) {
  if (!rule || typeof rule !== 'object') return [];
  const fromList = uniqueNormalized(rule.event_types ?? rule.eventTypes);
  if (fromList.length > 0) return fromList;
  return uniqueNormalized([rule.event_type ?? rule.eventType]);
}

export function parseRuleEventTypes(body) {
  if (!body || typeof body !== 'object') return [];
  const raw = body.eventTypes ?? body.event_types ?? body.eventType ?? body.event_type;
  return uniqueNormalized(asEventList(raw));
}

export function ruleAppliesToEvent(rule, eventType) {
  const current = normalizeEventType(eventType);
  if (!current) return false;
  return eventTypesFromRule(rule).some((type) => type === current);
}

export function ruleChunkContent(rule) {
  const events = eventTypesFromRule(rule);
  const eventLine = events.length > 0 ? events.join(', ') : (rule.event_type || '');
  return `${rule.name}\nEvent: ${eventLine}\nWhen: ${rule.condition}\nThen: ${rule.action}`;
}
