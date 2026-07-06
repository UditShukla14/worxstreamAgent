/**
 * Customers Tools - MCP Tool Definitions
 * Customers are business entities used for invoices, estimates, and jobs (separate from CRM contacts)
 */

import { z } from 'zod';
import { registerTool } from '../server.js';
import { callWorxstreamAPI, normalizeFilter } from '../../services/httpClient.js';
import { getWorxstreamContext } from '../../config/index.js';

export function registerCustomerTools() {

  const filterSchema = z.object({ search: z.string().optional() }).optional();

  registerTool(
    'list_customers',
    {
      title: 'List Customers',
      description: 'List customers (customer records, not CRM contacts). Supports filter.search for name/search. Use list_contacts for CRM contacts instead.',
      inputSchema: {
        limit: z.number().optional().describe('Number of results (default: 25)'),
        page: z.number().optional().describe('Page number (default: 1)'),
        filter: filterSchema.describe('Filter object, e.g. { "search": "green sc" }'),
      },
    },
    async ({ limit = 25, page = 1, filter } = {}) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/master/customer/customer-list',
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
    'get_customer_details',
    {
      title: 'Get Customer Details',
      description: 'Get customer details by ID (customer record, not CRM contact). Customers are business entities used for invoices, estimates, and jobs. Use get_contact_details for CRM contacts instead.',
      inputSchema: {
        id: z.number().describe('Customer master ID (300-series, e.g. 30000000037). From list_customers use customer_id/customerId on the row — NOT the 200-series list row id.'),
      },
    },
    async ({ id }) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/master/customer/customer-details',
        data: { company_id: companyId, user_id: userId, id },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'update_customer',
    {
      title: 'Update Customer',
      description: 'Update customer with multiple fields. For updating a single field/attribute, use quick_update_customer instead.',
      inputSchema: {
        id: z.number().describe('Customer ID'),
        first_name: z.string().optional().describe('First name'),
        last_name: z.string().optional().describe('Last name'),
        email: z.string().optional().describe('Email'),
        phone_number: z.string().optional().describe('Phone'),
        tags: z.array(z.string()).optional().describe('Tags'),
        notes: z.string().optional().describe('Notes'),
      },
    },
    async (input) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'PUT',
        endpoint: '/master/customer/update-customer',
        data: { company_id: companyId, user_id: userId, ...input },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'get_customer_dropdown',
    {
      title: 'Get Customer Dropdown',
      description: 'Get customers for dropdown.',
      inputSchema: {
        search: z.string().optional().describe('Search term'),
      },
    },
    async ({ search }) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/master/customer/customer-dropdowns',
        data: { company_id: companyId, user_id: userId, search: search || '' },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'quick_update_customer',
    {
      title: 'Quick Update Customer',
      description: 'Quick update a SINGLE attribute/field of a customer. Use this when updating only one field (e.g., email, phone, name). For multiple field updates, use update_customer instead.',
      inputSchema: {
        id: z.number().describe('Customer ID'),
        db_attribute: z.string().describe('Database attribute name (e.g., "first_name", "email")'),
        value: z.union([z.string(), z.number(), z.boolean()]).describe('New value'),
      },
    },
    async (input) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/master/customer/quick-update-customer',
        data: { company_id: companyId, user_id: userId, ...input },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
