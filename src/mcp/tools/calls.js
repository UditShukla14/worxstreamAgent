/**
 * Calls tools — LiveKit voice-agent session reports (header Calls → `/calls`).
 * Source of truth: apps/web/src/services/voiceAgentSessionReportService.ts
 * + Calls UI list payload (filter.advance on started_at, value as [from, to]).
 *
 * Distinct from CRM `list_calls` (object-attached logs via /modules/get-calls).
 */

import { z } from 'zod';
import { registerTool } from '../server.js';
import { callWorxstreamAPI } from '../../services/httpClient.js';
import { getWorxstreamContext } from '../../config/index.js';
import { getMaxListPageSize } from '../../nova/agents/policies/listPolicies.js';

function asText(result) {
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}

/**
 * Build filter.advance for the Calls list API (same shape as the web Calls page).
 * Date range MUST use started_at + BETWEEN + string[] value — not created_at, not "from,to".
 */
function buildCallsAdvanceFilter({
  startedFrom,
  startedTo,
  status,
  outcome,
  assignedTo,
} = {}) {
  const advance = [];

  const from = startedFrom ? String(startedFrom).trim() : '';
  const to = startedTo ? String(startedTo).trim() : '';
  if (from || to) {
    const start = from || to;
    const end = to || from;
    advance.push({
      db_attribute: 'started_at',
      operator: 'BETWEEN',
      value: [start, end],
    });
  }

  if (status != null && String(status).trim() !== '') {
    advance.push({
      db_attribute: 'status',
      operator: '=',
      value: String(status).trim(),
    });
  }

  if (outcome != null && String(outcome).trim() !== '') {
    advance.push({
      db_attribute: 'outcome',
      operator: '=',
      value: String(outcome).trim(),
    });
  }

  if (assignedTo != null && String(assignedTo).trim() !== '') {
    advance.push({
      db_attribute: 'assigned_to',
      operator: '=',
      value: String(assignedTo).trim(),
    });
  }

  return advance.length > 0 ? { advance } : null;
}

function attachListPagination(result, effectivePage, effectiveLimit) {
  if (!result?.success || !result?.data || typeof result.data !== 'object') return result;

  // callWorxstreamAPI → { success, data: axiosBody }
  // axiosBody → { success, message, data: { data: rows[], pagination } }
  const apiBody = result.data;
  const listPayload = apiBody?.data && typeof apiBody.data === 'object' ? apiBody.data : apiBody;
  const rows = Array.isArray(listPayload?.data) ? listPayload.data : [];
  const pagination = listPayload?.pagination && typeof listPayload.pagination === 'object'
    ? listPayload.pagination
    : null;
  const currentPage = pagination?.currentPage ?? effectivePage;
  const lastPage = pagination?.lastPage;
  const total = pagination?.total;
  const hasMore = Number.isFinite(currentPage) && Number.isFinite(lastPage)
    ? currentPage < lastPage
    : (Number.isFinite(total) ? rows.length < total : false);
  const nextPage = Number.isFinite(currentPage) && Number.isFinite(lastPage) && currentPage < lastPage
    ? currentPage + 1
    : null;

  const enriched = {
    ...listPayload,
    pagination: {
      ...(pagination || {}),
      returned: rows.length,
      has_more: Boolean(hasMore),
      next_page: nextPage,
    },
  };

  if (apiBody?.data && typeof apiBody.data === 'object' && !Array.isArray(apiBody.data)) {
    return { ...result, data: { ...apiBody, data: enriched } };
  }
  return { ...result, data: enriched };
}

export function registerCallsTools() {
  registerTool(
    'list_call_sessions',
    {
      title: 'List Call Sessions',
      description:
        'List voice-agent call sessions (Calls page). Matches the web Calls list API: pagination + filter.advance. '
        + 'For “yesterday” / a day / a range, pass started_from + started_to (YYYY-MM-DD) — filters started_at BETWEEN [from,to] (NOT created_at). '
        + 'Optional status / outcome / assigned_to filters (IDs as returned by get_call_session_filters). '
        + 'One page at a time (default limit 25, hard-capped). Use pagination.has_more / next_page for more. '
        + 'Pass app_id when known (Calls UI uses it, e.g. 39).',
      inputSchema: {
        search: z.string().optional().describe('Search caller name, phone, email, etc.'),
        status: z.union([z.string(), z.number()]).optional().describe('Status ID/code (from get_call_session_filters), e.g. 246'),
        outcome: z.union([z.string(), z.number()]).optional().describe('Outcome ID/code (from get_call_session_filters), e.g. 252'),
        assigned_to: z.union([z.string(), z.number()]).optional().describe('Assignee user/team-member id'),
        started_from: z.string().optional().describe('Call start date from YYYY-MM-DD (inclusive). Prefer this over created_*.'),
        started_to: z.string().optional().describe('Call start date to YYYY-MM-DD (inclusive). For one day, set both from and to to that day.'),
        /** @deprecated Use started_from — still accepted, mapped to started_at filter */
        created_from: z.string().optional().describe('Alias for started_from (maps to started_at filter)'),
        /** @deprecated Use started_to */
        created_to: z.string().optional().describe('Alias for started_to (maps to started_at filter)'),
        app_id: z.number().optional().describe('Calls app ID when known (web UI sends this, e.g. 39)'),
        with_trashed: z.boolean().optional().describe('Include soft-deleted (default: false)'),
        page: z.number().optional().describe('Page number (default: 1)'),
        limit: z.number().optional().describe('Page size (default 25, max enforced by runtime)'),
        sort: z.enum(['asc', 'desc']).optional().describe('Sort direction (default: desc)'),
        sort_by: z.string().optional().describe('Sort field (default: created_at; UI may use started_at)'),
      },
    },
    async ({
      search,
      status,
      outcome,
      assigned_to,
      started_from,
      started_to,
      created_from,
      created_to,
      app_id,
      with_trashed = false,
      page = 1,
      limit = 25,
      sort = 'desc',
      sort_by = 'created_at',
    } = {}) => {
      const { companyId, userId } = getWorxstreamContext();
      const max = getMaxListPageSize();
      const effectiveLimit = Math.min(Math.max(1, Number(limit) || 25), max);
      const effectivePage = Math.max(1, Math.floor(Number(page) || 1));

      const from = (started_from || created_from || '').toString().trim();
      const to = (started_to || created_to || '').toString().trim();

      const data = {
        company_id: companyId,
        user_id: userId,
        pagination: true,
        page: effectivePage,
        limit: effectiveLimit,
        sort: sort || 'desc',
        sort_by: sort_by || 'created_at',
      };
      if (search?.trim()) data.search = search.trim();
      if (app_id != null) data.app_id = app_id;
      if (with_trashed) data.with_trashed = true;

      const filter = buildCallsAdvanceFilter({
        startedFrom: from,
        startedTo: to,
        status,
        outcome,
        assignedTo: assigned_to,
      });
      if (filter) data.filter = filter;

      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/livekit/voice-agent/session-report/list',
        data,
      });
      return asText(attachListPagination(result, effectivePage, effectiveLimit));
    }
  );

  registerTool(
    'get_call_session_details',
    {
      title: 'Get Call Session Details',
      description:
        'Get one voice-agent call session by ID (summary, chat, recording URLs, status, assignee, sentiment, outcome).',
      inputSchema: {
        id: z.number().describe('Call session report ID'),
        with_trashed: z.boolean().optional().describe('Include soft-deleted (default: false)'),
      },
    },
    async ({ id, with_trashed = false }) => {
      const { companyId, userId } = getWorxstreamContext();
      const data = { company_id: companyId, user_id: userId, id };
      if (with_trashed) data.with_trashed = true;
      return asText(await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/livekit/voice-agent/session-report/show',
        data,
      }));
    }
  );

  registerTool(
    'get_call_session_filters',
    {
      title: 'Get Call Session Filters',
      description:
        'Load Calls filter options: status id→label map and assignedTo list. Call this to resolve numeric status/outcome codes (e.g. 246→Completed) before presenting or updating.',
      inputSchema: {},
    },
    async () => {
      const { companyId, userId } = getWorxstreamContext();
      return asText(await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/livekit/voice-agent/session-report/initial-data',
        data: { company_id: companyId, user_id: userId },
      }));
    }
  );

  registerTool(
    'update_call_session',
    {
      title: 'Update Call Session Field',
      description:
        'Quick-update one field: status, assigned_to, or outcome. Confirm with the user first. Use get_call_session_filters for valid IDs/labels.',
      inputSchema: {
        id: z.number().describe('Call session report ID'),
        db_attribute: z.enum(['status', 'assigned_to', 'outcome']).describe('Field to update'),
        value: z.union([z.string(), z.number()]).describe('New value (status/outcome id or assignee id)'),
      },
    },
    async ({ id, db_attribute, value }) => {
      const { companyId, userId } = getWorxstreamContext();
      return asText(await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/livekit/voice-agent/session-report/quick-update',
        data: {
          company_id: companyId,
          user_id: userId,
          id,
          db_attribute,
          value,
        },
      }));
    }
  );

  registerTool(
    'delete_call_session',
    {
      title: 'Delete Call Session',
      description: 'Soft-delete a voice-agent call session. Confirm with the user before deleting.',
      inputSchema: {
        id: z.number().describe('Call session report ID'),
      },
    },
    async ({ id }) => {
      const { companyId, userId } = getWorxstreamContext();
      return asText(await callWorxstreamAPI({
        method: 'DELETE',
        endpoint: '/livekit/voice-agent/session-report/soft-delete',
        data: { company_id: companyId, user_id: userId, id },
      }));
    }
  );
}
