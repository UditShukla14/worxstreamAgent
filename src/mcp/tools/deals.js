/**
 * Deal & Pipeline Tools — CRM deals, pipelines, stages
 */

import { z } from 'zod';
import { registerTool } from '../server.js';
import { callWorxstreamAPI } from '../../services/httpClient.js';
import { getWorxstreamContext } from '../../config/index.js';

function asText(result) {
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}

export function registerDealTools() {
  registerTool(
    'list_deals',
    {
      title: 'List Deals',
      description: 'List CRM deals. Supports search, pipeline/stage filters, and date range.',
      inputSchema: {
        search: z.string().optional().describe('Search title, number, or contact'),
        pipeline_id: z.number().optional().describe('Pipeline ID'),
        pipeline_stage_id: z.number().optional().describe('Pipeline stage ID'),
        deal_owner: z.number().optional().describe('Owner team-member ID'),
        contact_id: z.number().optional().describe('Contact ID'),
        date_from: z.string().optional().describe('Close/created from YYYY-MM-DD'),
        date_to: z.string().optional().describe('Close/created to YYYY-MM-DD'),
        page: z.number().optional().describe('Page number (default: 1)'),
        take: z.number().optional().describe('Results per page (default: 25)'),
        with_pipelines: z.boolean().optional().describe('Include pipeline objects in the response'),
      },
    },
    async ({ search, pipeline_id, pipeline_stage_id, deal_owner, contact_id, date_from, date_to, page = 1, take = 25, with_pipelines } = {}) => {
      const { companyId, userId } = getWorxstreamContext();
      const data = {
        company_id: companyId,
        user_id: userId,
        page: page ?? 1,
        take: take ?? 25,
      };
      if (search?.trim()) data.search = search.trim();
      if (pipeline_id !== undefined) data.pipeline_id = pipeline_id;
      if (pipeline_stage_id !== undefined) data.pipeline_stage_id = pipeline_stage_id;
      if (deal_owner !== undefined) data.deal_owner = deal_owner;
      if (contact_id !== undefined) data.contact_id = contact_id;
      if (date_from) data.date_from = date_from;
      if (date_to) data.date_to = date_to;
      if (with_pipelines !== undefined) data.with_pipelines = with_pipelines;
      return asText(await callWorxstreamAPI({ method: 'POST', endpoint: '/transaction/deal/get-deals', data }));
    }
  );

  registerTool(
    'get_deal_details',
    {
      title: 'Get Deal Details',
      description: 'Get a deal by ID.',
      inputSchema: { id: z.number().describe('Deal ID') },
    },
    async ({ id }) => {
      const { companyId, userId } = getWorxstreamContext();
      return asText(await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/transaction/deal/get-deal-details',
        data: { company_id: companyId, user_id: userId, id },
      }));
    }
  );

  registerTool(
    'create_deal',
    {
      title: 'Create Deal',
      description: 'Create a CRM deal. Confirm title and amount with the user first when they did not provide them.',
      inputSchema: {
        title: z.string().describe('Deal title'),
        deal_amount: z.number().optional().describe('Deal amount'),
        pipeline_id: z.number().optional().describe('Pipeline ID'),
        pipeline_stage_id: z.number().optional().describe('Pipeline stage ID'),
        contact_id: z.number().optional().describe('Contact ID'),
        deal_owner: z.number().optional().describe('Owner team-member ID'),
        close_date: z.string().optional().describe('Expected close date YYYY-MM-DD'),
        priority: z.union([z.string(), z.number()]).optional().describe('Priority'),
        deal_type: z.union([z.string(), z.number()]).optional().describe('Deal type'),
        deal_source: z.union([z.string(), z.number()]).optional().describe('Deal source'),
        custom_number: z.string().optional().describe('Custom deal number'),
      },
    },
    async (input) => {
      const { companyId, userId } = getWorxstreamContext();
      return asText(await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/transaction/deal/create-deals',
        data: { company_id: companyId, user_id: userId, ...input },
      }));
    }
  );

  registerTool(
    'change_deal_stage',
    {
      title: 'Change Deal Stage',
      description: 'Move a deal to another pipeline stage.',
      inputSchema: {
        id: z.number().describe('Deal ID'),
        pipeline_id: z.number().describe('Pipeline ID'),
        pipeline_stage_id: z.number().describe('Target pipeline stage ID'),
      },
    },
    async ({ id, pipeline_id, pipeline_stage_id }) => {
      const { companyId, userId } = getWorxstreamContext();
      return asText(await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/transaction/deal/change-deal-stage',
        data: { company_id: companyId, user_id: userId, id, pipeline_id, pipeline_stage_id },
      }));
    }
  );

  registerTool(
    'list_pipelines',
    {
      title: 'List Sales Pipelines',
      description: 'List CRM sales pipelines. Pass with_stages=true to include stages.',
      inputSchema: {
        with_stages: z.boolean().optional().describe('Include stages (default: false)'),
      },
    },
    async ({ with_stages = false } = {}) => {
      const { companyId, userId } = getWorxstreamContext();
      return asText(await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/modules/get-pipelines',
        data: { company_id: companyId, user_id: userId, with_stages: with_stages || false },
      }));
    }
  );

  registerTool(
    'list_pipeline_stages',
    {
      title: 'List Pipeline Stages',
      description: 'List stages for a sales pipeline.',
      inputSchema: {
        pipeline_id: z.number().describe('Pipeline ID'),
      },
    },
    async ({ pipeline_id }) => {
      const { companyId, userId } = getWorxstreamContext();
      return asText(await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/modules/get-pipeline-stages',
        data: { company_id: companyId, user_id: userId, pipeline_id },
      }));
    }
  );
}
