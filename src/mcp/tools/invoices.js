/**
 * Invoices Tools - MCP Tool Definitions
 */

import { z } from 'zod';
import { registerTool } from '../server.js';
import { callWorxstreamAPI, normalizeFilter } from '../../services/httpClient.js';
import { getWorxstreamContext } from '../../config/index.js';

export function registerInvoiceTools() {

  const filterSchema = z.object({
    search: z.string().optional(),
    advance: z.array(z.object({
      db_attribute: z.string().describe('e.g. created_date, created_at'),
      operator: z.string().describe('e.g. BETWEEN, >=, <='),
      value: z.union([z.string(), z.number(), z.array(z.string())]).describe('For BETWEEN use [from_date, to_date] as YYYY-MM-DD'),
    })).optional().describe('Date range filters, e.g. [{ db_attribute: "created_date", operator: "BETWEEN", value: ["2025-02-01","2025-02-28"] }]'),
  }).optional();

  // List invoices
  registerTool(
    'list_invoices',
    {
      title: 'List Invoices',
      description: 'List invoices. Defaults to page=1 and limit=25. Supports automatic pagination hints (has_more, next_page, total). Use all_pages=true to fetch multiple pages (up to max_pages). filter.search is text only (invoice #, customer names — NOT status). For "paid/open invoices": use only date range in filter.advance; filter results by status when presenting.',
      inputSchema: {
        customer_id: z.number().optional().describe('Customer ID'),
        vendor_id: z.number().optional().describe('Vendor ID'),
        limit: z.number().optional().describe('Number of results (default: 25)'),
        page: z.number().optional().describe('Page number (default: 1)'),
        all_pages: z.boolean().optional().describe('If true, fetch pages sequentially and combine results'),
        max_pages: z.number().optional().describe('Safety cap when all_pages=true (default: 10)'),
        filter: filterSchema.describe('Filter object. search: text only (invoice #, customer name). advance: date ranges. Do NOT put status (paid/draft) in search.'),
      },
    },
    async ({ customer_id, vendor_id, limit = 25, page = 1, all_pages = false, max_pages = 10, filter } = {}) => {
      const { companyId, userId } = getWorxstreamContext();
      const normalized = normalizeFilter(filter);
      const effectiveLimit = limit;

      const fetchPage = async (p) => callWorxstreamAPI({
        method: 'POST',
        endpoint: '/master-objects/list',
        data: {
          companyId,
          userId,
          appName: 'invoice',
          customer_id,
          vendor_id,
          page: p ?? 1,
          limit: effectiveLimit ?? 25,
          filter: normalized,
        },
      });

      // Default: single page
      if (!all_pages) {
        const result = await fetchPage(page ?? 1);
        // Attach pagination hints for agents/UI
        if (result?.success && result?.data && typeof result.data === 'object') {
          const payload = result.data;
          const rows = Array.isArray(payload?.data) ? payload.data : [];
          const pagination = payload?.pagination && typeof payload.pagination === 'object' ? payload.pagination : null;
          const currentPage = pagination?.currentPage;
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
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      // all_pages: aggregate up to max_pages
      const safeMaxPages = Number.isFinite(max_pages) && max_pages > 0 ? Math.min(max_pages, 50) : 10;
      const startPage = page ?? 1;

      const first = await fetchPage(startPage);
      if (!first?.success) {
        return { content: [{ type: 'text', text: JSON.stringify(first, null, 2) }] };
      }

      const payload = first.data;
      const combined = Array.isArray(payload?.data) ? [...payload.data] : [];
      const lastPage = payload?.pagination?.lastPage;
      const totalPages = Number.isFinite(lastPage) ? lastPage : (startPage + safeMaxPages - 1);

      for (let p = startPage + 1; p <= totalPages && p < startPage + safeMaxPages; p++) {
        const next = await fetchPage(p);
        if (!next?.success) break;
        const nextPayload = next.data;
        const nextRows = Array.isArray(nextPayload?.data) ? nextPayload.data : [];
        combined.push(...nextRows);
        // Stop early if API returns fewer than limit items
        if ((effectiveLimit ?? 25) > 0 && nextRows.length < (effectiveLimit ?? 25)) break;
      }

      const merged = {
        ...first,
        data: {
          ...payload,
          data: combined,
          pagination: {
            ...(payload?.pagination || {}),
            aggregated: true,
            aggregatedPagesMax: safeMaxPages,
            aggregatedCount: combined.length,
          },
        },
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(merged, null, 2) }],
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
