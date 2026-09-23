/**
 * Calls tools — LiveKit voice-agent session reports (header Calls → `/calls`).
 * Source: apps/web/src/services/voiceAgentSessionReportService.ts
 *
 * Distinct from CRM `list_calls` (object-attached call logs via /modules/get-calls).
 */

import { z } from 'zod';
import { registerTool } from '../server.js';
import { callWorxstreamAPI } from '../../services/httpClient.js';
import { getWorxstreamContext } from '../../config/index.js';
import { getMaxListPageSize } from '../../nova/agents/policies/listPolicies.js';

function asText(result) {
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}

function attachListPagination(result, effectivePage, effectiveLimit) {
  if (!result?.success || !result?.data || typeof result.data !== 'object') return result;

  // Service wraps API body; callWorxstreamAPI returns { success, data: axiosBody }.
  // axiosBody is typically { success, message, data: { data: rows[], pagination } }.
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
        'List voice-agent call sessions (Calls page). One page at a time (default limit 25, hard-capped). Returns pagination.has_more / next_page — ask before loading the next page. For a day or range use created_from + created_to (YYYY-MM-DD); that builds filter.advance BETWEEN on created_at (same as the Calls UI).',
      inputSchema: {
        search: z.string().optional().describe('Search caller name, phone, email, agent, etc.'),
        status: z.string().optional().describe('Call status filter'),
        assigned_to: z.string().optional().describe('Assignee filter (user/team-member id as string)'),
        created_from: z.string().optional().describe('Start date YYYY-MM-DD (inclusive). For a single day, set both from and to to that day.'),
        created_to: z.string().optional().describe('End date YYYY-MM-DD (inclusive).'),
        app_id: z.number().optional().describe('App ID when known from Calls UI context'),
        with_trashed: z.boolean().optional().describe('Include soft-deleted (default: false)'),
        page: z.number().optional().describe('Page number (default: 1)'),
        limit: z.number().optional().describe('Page size (default 25, max enforced by runtime)'),
        sort: z.enum(['asc', 'desc']).optional().describe('Sort direction (default: desc)'),
        sort_by: z.string().optional().describe('Sort field (default: created_at)'),
      },
    },
    async ({
      search,
      status,
      assigned_to,
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
      if (status) data.status = status;
      if (assigned_to != null && assigned_to !== '') data.assigned_to = String(assigned_to);
      if (app_id != null) data.app_id = app_id;
      if (with_trashed) data.with_trashed = true;

      const from = created_from ? String(created_from).trim() : '';
      const to = created_to ? String(created_to).trim() : '';
      if (from && to) {
        data.filter = {
          advance: [{
            db_attribute: 'created_at',
            operator: 'BETWEEN',
            value: `${from},${to}`,
          }],
        };
      } else if (from || to) {
        const day = from || to;
        data.filter = {
          advance: [{
            db_attribute: 'created_at',
            operator: 'BETWEEN',
            value: `${day},${day}`,
          }],
        };
      }

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
        'Get one voice-agent call session by ID (summary, chat history, quote lead, recording URLs, status, assignee, sentiment, outcome).',
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
        'Load Calls page filter options: status map and assignedTo team-member list. Call before updating status/assignee when unsure of valid values.',
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
        'Quick-update one field on a call session: status, assigned_to, or outcome. Confirm with the user before changing. Use get_call_session_filters for valid status/assignee values.',
      inputSchema: {
        id: z.number().describe('Call session report ID'),
        db_attribute: z.enum(['status', 'assigned_to', 'outcome']).describe('Field to update'),
        value: z.union([z.string(), z.number()]).describe('New value (status/outcome string, or assignee user id)'),
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
      description:
        'Soft-delete a voice-agent call session. Confirm with the user before deleting.',
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
