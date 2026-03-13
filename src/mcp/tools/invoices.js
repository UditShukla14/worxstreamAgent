/**
 * Invoices Tools - MCP Tool Definitions
 */

import { z } from 'zod';
import { registerTool } from '../server.js';
import { callWorxstreamAPI, normalizeFilter } from '../../services/httpClient.js';
import { getWorxstreamContext } from '../../config/index.js';

export function registerInvoiceTools() {

  const filterSchema = z.object({ search: z.string().optional() }).optional();

  // List invoices
  registerTool(
    'list_invoices',
    {
      title: 'List Invoices',
      description: 'List invoices. Can filter by customer_id, vendor_id, and filter.search.',
      inputSchema: {
        customer_id: z.number().optional().describe('Customer ID'),
        vendor_id: z.number().optional().describe('Vendor ID'),
        take: z.number().optional().describe('Number of results (default: 25)'),
        page: z.number().optional().describe('Page number (default: 1)'),
        sort: z.string().optional().describe('Sort field (default: "id")'),
        filter: filterSchema.describe('Filter object, e.g. { "search": "term" }'),
      },
    },
    async ({ customer_id, vendor_id, take = 25, page = 1, sort = 'id', filter } = {}) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/master-objects/list',
        data: {
          companyId,
          userId,
          appName: 'invoice',
          customer_id,
          vendor_id,
          page: page ?? 1,
          limit: take ?? 25,
          sort,
          filter: normalizeFilter(filter),
        },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Get invoice details
  registerTool(
    'get_invoice_details',
    {
      title: 'Get Invoice Details',
      description: 'Get invoice details by ID.',
      inputSchema: {
        id: z.number().describe('Invoice ID'),
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

  // Create invoice
  registerTool(
    'create_invoice',
    {
      title: 'Create Invoice',
      description: 'Create a new invoice.',
      inputSchema: {
        custom_number: z.string().optional().describe('Custom invoice number'),
        contact_id: z.number().describe('Contact ID'),
        customer_id: z.number().describe('Customer ID'),
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
          app_name: 'invoice',
          custom_number: input.custom_number,
          contact_id: input.contact_id,
          customer_id: input.customer_id,
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
