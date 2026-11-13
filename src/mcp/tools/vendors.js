/**
 * Vendors Tools - MCP Tool Definitions
 */

import { z } from 'zod';
import { registerTool } from '../server.js';
import { callWorxstreamAPI, normalizeFilter } from '../../services/httpClient.js';
import { getWorxstreamContext } from '../../config/index.js';

export function registerVendorTools() {

  const filterSchema = z.object({ search: z.string().optional() }).optional();

  registerTool(
    'list_vendors',
    {
      title: 'List Vendors',
      description: 'List vendors/suppliers one page at a time (default limit 25). Match by name with filter.search. For one vendor use get_vendor_details; for a name-to-ID lookup use resolve_entity.',
      inputSchema: {
        limit: z.number().optional().describe('Number of results (default: 25)'),
        page: z.number().optional().describe('Page number (default: 1)'),
        filter: filterSchema.describe('Filter object, e.g. { "search": "term" }'),
      },
    },
    async ({ limit = 25, page = 1, filter } = {}) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/master/vendor/vendor-list',
        data: {
          companyId,
          userId,
          page: page ?? 1,
          limit: limit ?? 25,
          filter: normalizeFilter(filter),
        },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'get_vendor_details',
    {
      title: 'Get Vendor Details',
      description: 'Get one vendor with contact details, terms and status. Requires the vendor ID; find it with list_vendors.',
      inputSchema: {
        id: z.number().describe('Vendor ID'),
      },
    },
    async ({ id }) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/master/vendor/vendor-details',
        data: { company_id: companyId, user_id: userId, id },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'list_vendor_accounts',
    {
      title: 'List Vendor Accounts',
      description: 'List vendor accounts (Motili and similar supplier accounts).',
      inputSchema: {
        search: z.string().optional().describe('Search account name or number'),
        page: z.number().optional().describe('Page number (default: 1)'),
        take: z.number().optional().describe('Results per page (default: 25)'),
      },
    },
    async ({ search, page = 1, take = 25 } = {}) => {
      const { companyId, userId } = getWorxstreamContext();
      const data = { companyId, userId, page: page ?? 1, take: take ?? 25 };
      if (search?.trim()) data.search = search.trim();
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/vendor-accounts/list',
        data,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'get_vendor_accounts_dropdown',
    {
      title: 'Get Vendor Accounts Dropdown',
      description: 'List active vendor accounts as id/label options, for choosing a vendor account when creating a bill or payment.',
      inputSchema: {
        account_type: z.string().optional().describe('Account type filter (default: motili)'),
      },
    },
    async ({ account_type = 'motili' } = {}) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/vendor-accounts/dropdown',
        data: { companyId, userId, is_active: 1, account_type: account_type || 'motili' },
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'update_vendor',
    {
      title: 'Update Vendor',
      description: 'Change fields on an existing vendor (only the fields passed are changed). This writes data: state what will change and confirm with the user.',
      inputSchema: {
        id: z.number().describe('Vendor ID'),
        first_name: z.string().optional().describe('First name'),
        last_name: z.string().optional().describe('Last name'),
        email: z.string().optional().describe('Email'),
        phone_number: z.string().optional().describe('Phone'),
        tags: z.array(z.string()).optional().describe('Tags'),
        notes: z.string().optional().describe('Notes'),
        is_auto_po: z.boolean().optional().describe('Auto PO enabled'),
      },
    },
    async (input) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'PUT',
        endpoint: '/master/vendor/update-vendor',
        data: { company_id: companyId, user_id: userId, ...input },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
