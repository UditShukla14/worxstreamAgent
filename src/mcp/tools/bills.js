/**
 * Bills Tools - MCP Tool Definitions
 * Same API pattern as estimate/invoice; app_name: 'bill'
 */

import { z } from 'zod';
import { registerTool } from '../server.js';
import { callWorxstreamAPI } from '../../services/httpClient.js';
import { getWorxstreamContext } from '../../config/index.js';

const APP_NAME = 'bill';

export function registerBillTools() {

  registerTool(
    'list_bills',
    {
      title: 'List Bills',
      description: 'Get all bills. Can filter by customer_id, vendor_id, and search.',
      inputSchema: {
        customer_id: z.number().optional().describe('Customer ID'),
        vendor_id: z.number().optional().describe('Vendor ID'),
        search: z.string().optional().describe('Search term'),
        take: z.number().optional().describe('Number of results (default: 100)'),
        page: z.number().optional().describe('Page number (default: 1)'),
        sort: z.string().optional().describe('Sort field (default: "id")'),
      },
    },
    async ({ customer_id, vendor_id, search, take = 100, page = 1, sort = 'id' }) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/master-objects/list',
        data: {
          company_id: companyId,
          user_id: userId,
          app_name: APP_NAME,
          customer_id,
          vendor_id,
          take,
          page,
          sort,
          filter: search ? { advance: { search } } : {},
        },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'get_bill_details',
    {
      title: 'Get Bill Details',
      description: 'Get bill details by ID.',
      inputSchema: {
        id: z.number().describe('Bill ID'),
      },
    },
    async ({ id }) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/master-objects/show',
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

  registerTool(
    'create_bill',
    {
      title: 'Create Bill',
      description: 'Create a new bill.',
      inputSchema: {
        custom_number: z.string().optional().describe('Custom bill number'),
        contact_id: z.number().describe('Contact ID'),
        customer_id: z.number().describe('Customer ID'),
        vendor_id: z.number().optional().describe('Vendor ID'),
        job_name: z.string().optional().describe('Job name'),
        issue_date: z.string().describe('Issue date (YYYY-MM-DD)'),
        due_date: z.string().optional().describe('Due date (YYYY-MM-DD)'),
        sub_total: z.number().describe('Subtotal'),
        grand_total: z.number().describe('Grand total'),
        currency: z.string().optional().describe('Currency code (default: USD)'),
        notes: z.string().optional().describe('Notes'),
      },
    },
    async (input) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/master-objects/store',
        data: {
          company_id: companyId,
          user_id: userId,
          app_name: APP_NAME,
          custom_number: input.custom_number,
          contact_id: input.contact_id,
          customer_id: input.customer_id,
          vendor_id: input.vendor_id,
          job_name: input.job_name,
          issue_date: input.issue_date,
          due_date: input.due_date,
          sub_total: input.sub_total,
          discount_total: 0,
          discount_source: '1',
          object_tax_percentage: 0,
          object_tax_amount: 0,
          credit_card_tax_percentage: 0,
          grand_total: input.grand_total,
          gross_profit_total: 0,
          gross_profit_percentage: 0,
          currency: input.currency || 'USD',
          notes: input.notes,
          sections: [],
        },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
