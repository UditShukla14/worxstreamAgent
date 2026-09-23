/**
 * Sales Order Tools — MCP wrappers for /master-objects/*-salesorder
 */

import { z } from 'zod';
import { registerTool } from '../server.js';
import { callWorxstreamAPI, normalizeFilter } from '../../services/httpClient.js';
import { getWorxstreamContext } from '../../config/index.js';
import { getMaxListPageSize } from '../../nova/agents/policies/listPolicies.js';

function asText(result) {
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}

export function registerSalesOrderTools() {
  const filterSchema = z.object({
    search: z.string().optional(),
    advance: z.array(z.object({
      db_attribute: z.string().describe('e.g. created_date, created_at'),
      operator: z.string().describe('e.g. BETWEEN, >=, <='),
      value: z.union([z.string(), z.number(), z.array(z.string())]).describe('For BETWEEN use [from_date, to_date] as YYYY-MM-DD'),
    })).optional().describe('Date range filters'),
  }).optional();

  registerTool(
    'list_sales_orders',
    {
      title: 'List Sales Orders',
      description: 'List one page of sales orders (default page=1, limit=25, hard-capped). Returns pagination.has_more and pagination.next_page — call again with the next page when the user wants more. Never dump the full tenant dataset. filter.search is text only (NOT status).',
      inputSchema: {
        customer_id: z.number().optional().describe('Customer ID'),
        vendor_id: z.number().optional().describe('Vendor ID'),
        limit: z.number().optional().describe('Page size (default 25, max enforced by runtime)'),
        page: z.number().optional().describe('Page number (default: 1). Use next_page from prior response for more.'),
        filter: filterSchema.describe('Filter object. search: text only. advance: date ranges. Do NOT put status in search.'),
      },
    },
    async ({ customer_id, vendor_id, limit = 25, page = 1, filter } = {}) => {
      const { companyId, userId } = getWorxstreamContext();
      const normalized = normalizeFilter(filter);
      const max = getMaxListPageSize();
      const effectiveLimit = Math.min(Math.max(1, Number(limit) || 25), max);
      const effectivePage = Math.max(1, Math.floor(Number(page) || 1));

      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/master-objects/list',
        data: {
          companyId,
          userId,
          appName: 'salesorder',
          customer_id,
          vendor_id,
          page: effectivePage,
          limit: effectiveLimit,
          filter: normalized,
        },
      });

      if (result?.success && result?.data && typeof result.data === 'object') {
        const payload = result.data;
        const rows = Array.isArray(payload?.data) ? payload.data : [];
        const pagination = payload?.pagination && typeof payload.pagination === 'object' ? payload.pagination : null;
        const currentPage = pagination?.currentPage ?? effectivePage;
        const lastPage = pagination?.lastPage;
        const total = pagination?.total;
        const hasMore = Number.isFinite(currentPage) && Number.isFinite(lastPage)
          ? currentPage < lastPage
          : (Number.isFinite(total) ? rows.length < total : false);
        const nextPage = Number.isFinite(currentPage) && Number.isFinite(lastPage) && currentPage < lastPage
          ? currentPage + 1
          : null;

        result.data = {
          ...payload,
          pagination: {
            ...(pagination || {}),
            returned: rows.length,
            has_more: Boolean(hasMore),
            next_page: nextPage,
          },
        };
      }
      return asText(result);
    }
  );

  registerTool(
    'get_sales_order_details',
    {
      title: 'Get Sales Order Details',
      description: 'Get sales order details by ID.',
      inputSchema: {
        id: z.number().describe('Sales order ID'),
      },
    },
    async ({ id }) => {
      const { companyId, userId } = getWorxstreamContext();
      return asText(await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/master-objects/show',
        data: { company_id: companyId, user_id: userId, id },
      }));
    }
  );

  registerTool(
    'create_sales_order',
    {
      title: 'Create Sales Order',
      description: 'Create a new sales order.',
      inputSchema: {
        custom_number: z.string().optional().describe('Custom sales order number'),
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
      return asText(await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/master-objects/store',
        data: {
          company_id: companyId,
          user_id: userId,
          app_name: 'salesorder',
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
      }));
    }
  );
}
