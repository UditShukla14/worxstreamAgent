/**
 * Vendors Tools - MCP Tool Definitions
 */

import { z } from 'zod';
import { registerTool } from '../server.js';
import { callWorxstreamAPI } from '../../services/httpClient.js';
import { getWorxstreamContext } from '../../config/index.js';

export function registerVendorTools() {

  registerTool(
    'list_vendors',
    {
      title: 'List Vendors',
      description: 'Get all vendors/suppliers.',
      inputSchema: {
        search: z.string().optional().describe('Search term'),
      },
    },
    async ({ search }) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/master/vendor/vendor-list',
        data: {
          company_id: companyId,
          user_id: userId,
          filter: { search: search || '' },
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
