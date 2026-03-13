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
      description: 'List vendors/suppliers. Supports filter.search.',
      inputSchema: {
        take: z.number().optional().describe('Number of results (default: 25)'),
        page: z.number().optional().describe('Page number (default: 1)'),
        filter: filterSchema.describe('Filter object, e.g. { "search": "term" }'),
      },
    },
    async ({ take = 25, page = 1, filter } = {}) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/master/vendor/vendor-list',
        data: {
          companyId,
          userId,
          page: page ?? 1,
          limit: take ?? 25,
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
      description: 'Get vendor details.',
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
    'update_vendor',
    {
      title: 'Update Vendor',
      description: 'Update vendor.',
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
