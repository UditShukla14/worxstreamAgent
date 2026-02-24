/**
 * Jobs Tools - MCP Tool Definitions
 */

import { z } from 'zod';
import { registerTool } from '../server.js';
import { callWorxstreamAPI } from '../../services/httpClient.js';
import { getWorxstreamContext } from '../../config/index.js';

export function registerJobTools() {

  // List jobs
  registerTool(
    'list_jobs',
    {
      title: 'List Jobs',
      description: 'Get all jobs.',
      inputSchema: {},
    },
    async () => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/transaction/job/get-jobs',
        data: {
          company_id: companyId,
          user_id: userId,
        },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Get job details
  registerTool(
    'get_job_details',
    {
      title: 'Get Job Details',
      description: 'Get job details by ID.',
      inputSchema: {
        id: z.number().describe('Job ID'),
      },
    },
    async ({ id }) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/transaction/job/get-job-details',
        data: {
          company_id: companyId,
          user_id: userId,
          id,
        },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Create job
  registerTool(
    'create_job',
    {
      title: 'Create Job',
      description: 'Create a new job.',
      inputSchema: {
        contact_id: z.number().describe('Contact ID'),
        address_id: z.number().optional().describe('Address ID'),
        job_name: z.string().describe('Job name'),
        job_location: z.string().optional().describe('Job location/address'),
        valid_until: z.string().optional().describe('Valid until date (YYYY-MM-DD)'),
        description: z.string().optional().describe('Job description'),
        start_date: z.string().optional().describe('Start date (YYYY-MM-DD)'),
        end_date: z.string().optional().describe('End date (YYYY-MM-DD)'),
        status: z.string().optional().describe('Status (default: "1")'),
        pipeline_id: z.number().optional().describe('Pipeline ID'),
        pipeline_stage_id: z.number().optional().describe('Pipeline stage ID'),
        sales_manager_id: z.number().optional().describe('Sales manager user ID'),
      },
    },
    async (input) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/transaction/job/create-jobs',
        data: {
          company_id: companyId,
          user_id: userId,
          contact_id: input.contact_id,
          address_id: input.address_id || null,
          job_name: input.job_name,
          job_location: input.job_location || null,
          valid_until: input.valid_until || null,
          description: input.description || null,
          start_date: input.start_date || null,
          end_date: input.end_date || null,
          status: input.status || '1',
          pipeline_id: input.pipeline_id || null,
          pipeline_stage_id: input.pipeline_stage_id || null,
          sales_manager_id: input.sales_manager_id || userId,
          is_active: true,
        },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
