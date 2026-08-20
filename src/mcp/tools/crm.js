/**
 * CRM module tools — notes, activities, diaries, calendar, calls, global search
 */

import { z } from 'zod';
import { registerTool } from '../server.js';
import { callWorxstreamAPI } from '../../services/httpClient.js';
import { getWorxstreamContext } from '../../config/index.js';

function asText(result) {
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}

export function registerCrmTools() {
  registerTool(
    'list_notes',
    {
      title: 'List Notes',
      description: 'List notes attached to an object (deal, customer, job, etc.).',
      inputSchema: {
        object_name: z.string().describe('Object type, e.g. deal, customer, invoice'),
        object_id: z.number().describe('Object ID'),
        app_id: z.number().describe('App ID for that object type'),
        page: z.number().optional().describe('Page number'),
        per_page: z.number().optional().describe('Results per page'),
        search: z.string().optional().describe('Search note text'),
      },
    },
    async ({ object_name, object_id, app_id, page, per_page, search }) => {
      const { companyId, userId } = getWorxstreamContext();
      const data = { company_id: companyId, user_id: userId, object_name, object_id, app_id };
      if (page !== undefined) data.page = page;
      if (per_page !== undefined) data.per_page = per_page;
      if (search?.trim()) data.search = search.trim();
      return asText(await callWorxstreamAPI({ method: 'GET', endpoint: '/modules/get-notes', data }));
    }
  );

  registerTool(
    'create_note',
    {
      title: 'Create Note',
      description: 'Create a note on an object.',
      inputSchema: {
        object_name: z.string().describe('Object type, e.g. deal, customer'),
        object_id: z.number().describe('Object ID'),
        app_id: z.number().describe('App ID'),
        title: z.string().describe('Note title'),
        notes: z.string().describe('Note body'),
        is_active: z.boolean().optional().describe('Active flag (default: true)'),
      },
    },
    async (input) => {
      const { companyId, userId } = getWorxstreamContext();
      return asText(await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/modules/create-notes',
        data: { company_id: companyId, user_id: userId, ...input },
      }));
    }
  );

  registerTool(
    'list_activities',
    {
      title: 'List Activities',
      description: 'List CRM activities (meetings, follow-ups) for an object or owner.',
      inputSchema: {
        object_name: z.string().optional().describe('Object type'),
        object_id: z.number().optional().describe('Object ID'),
        app_id: z.number().optional().describe('App ID'),
        owner_id: z.number().optional().describe('Owner team-member ID'),
        from_date: z.string().optional().describe('From date YYYY-MM-DD'),
        to_date: z.string().optional().describe('To date YYYY-MM-DD'),
      },
    },
    async (input = {}) => {
      const { companyId, userId } = getWorxstreamContext();
      return asText(await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/modules/get-activities',
        data: { company_id: companyId, user_id: userId, ...input },
      }));
    }
  );

  registerTool(
    'list_diaries',
    {
      title: 'List Diaries',
      description: 'List CRM diaries/activity calendars. Defaults to the current user.',
      inputSchema: {
        created_by: z.number().optional().describe('Team-member / user ID who owns the diaries'),
      },
    },
    async ({ created_by } = {}) => {
      const { companyId, userId } = getWorxstreamContext();
      const data = { company_id: companyId, user_id: userId };
      data.created_by = created_by ?? Number(userId);
      return asText(await callWorxstreamAPI({ method: 'GET', endpoint: '/modules/get-diaries', data }));
    }
  );

  registerTool(
    'list_calendar_events',
    {
      title: 'List Calendar Events',
      description: 'List company calendar events for a year/month.',
      inputSchema: {
        year: z.number().describe('Year, e.g. 2026'),
        month: z.number().describe('Month 1-12'),
      },
    },
    async ({ year, month }) => {
      const { companyId, userId } = getWorxstreamContext();
      return asText(await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/modules/calendar-events',
        data: { company_id: companyId, user_id: userId, year, month },
      }));
    }
  );

  registerTool(
    'list_event_boards',
    {
      title: 'List Event Boards',
      description: 'List CRM event boards.',
      inputSchema: {},
    },
    async () => {
      const { companyId, userId } = getWorxstreamContext();
      return asText(await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/modules/get-event-boards',
        data: { company_id: companyId, user_id: userId },
      }));
    }
  );

  registerTool(
    'list_calls',
    {
      title: 'List Calls',
      description: 'List call logs attached to an object.',
      inputSchema: {
        object_name: z.string().describe('Object type'),
        object_id: z.number().describe('Object ID'),
        app_id: z.number().describe('App ID'),
      },
    },
    async ({ object_name, object_id, app_id }) => {
      const { companyId, userId } = getWorxstreamContext();
      return asText(await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/modules/get-calls',
        data: { company_id: companyId, user_id: userId, object_name, object_id, app_id },
      }));
    }
  );

  registerTool(
    'global_search',
    {
      title: 'Global Search',
      description: 'Search across WorxStream objects (deals, jobs, invoices, customers, etc.) by text.',
      inputSchema: {
        search: z.string().min(1).describe('Search query'),
        object_name: z.string().optional().describe('Limit to one object type, e.g. deal, invoice, customer'),
      },
    },
    async ({ search, object_name }) => {
      const { companyId, userId } = getWorxstreamContext();
      const data = { company_id: companyId, user_id: userId, search };
      if (object_name) data.object_name = object_name;
      return asText(await callWorxstreamAPI({ method: 'GET', endpoint: '/modules/global-search', data }));
    }
  );
}
