/**
 * Payment Tools — received payments, deposits, payment methods
 */

import { z } from 'zod';
import { registerTool } from '../server.js';
import { callWorxstreamAPI } from '../../services/httpClient.js';
import { getWorxstreamContext } from '../../config/index.js';

function asText(result) {
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}

export function registerPaymentTools() {
  registerTool(
    'list_received_payments',
    {
      title: 'List Received Payments',
      description: 'List customer received payments. Filter by customer, status, method, or date range.',
      inputSchema: {
        customer_id: z.number().optional().describe('Customer ID'),
        status: z.string().optional().describe('Payment status'),
        payment_method: z.string().optional().describe('Payment method'),
        payment_date_from: z.string().optional().describe('From date YYYY-MM-DD'),
        payment_date_to: z.string().optional().describe('To date YYYY-MM-DD'),
        search: z.string().optional().describe('Search text'),
        page: z.number().optional().describe('Page number (default: 1)'),
        per_page: z.number().optional().describe('Results per page (default: 25)'),
      },
    },
    async ({ customer_id, status, payment_method, payment_date_from, payment_date_to, search, page = 1, per_page = 25 } = {}) => {
      const { companyId, userId } = getWorxstreamContext();
      const data = {
        companyId,
        userId,
        pagination: 1,
        per_page: per_page ?? 25,
        page: page ?? 1,
        sort: 'desc',
        sort_by: 'payment_date',
      };
      if (customer_id != null) data.customer_id = customer_id;
      if (status) data.status = status;
      if (payment_method) data.payment_method = payment_method;
      if (payment_date_from) data.payment_date_from = payment_date_from;
      if (payment_date_to) data.payment_date_to = payment_date_to;
      if (search) data.search = search;
      return asText(await callWorxstreamAPI({ method: 'POST', endpoint: '/received-payments/list', data }));
    }
  );

  registerTool(
    'get_received_payment_details',
    {
      title: 'Get Received Payment Details',
      description: 'Get a received payment by ID.',
      inputSchema: { id: z.number().describe('Received payment ID') },
    },
    async ({ id }) => {
      const { companyId, userId } = getWorxstreamContext();
      return asText(await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/received-payments/show',
        data: { companyId, userId, id, with_trashed: 1 },
      }));
    }
  );

  registerTool(
    'list_deposits',
    {
      title: 'List Deposits',
      description: 'List deposits recorded against a master object (invoice, sales order, etc.).',
      inputSchema: {
        object_id: z.number().describe('Master object ID (invoice, sales order, estimate)'),
      },
    },
    async ({ object_id }) => {
      const { companyId, userId } = getWorxstreamContext();
      return asText(await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/deposits/list',
        data: { companyId, userId, object_id },
      }));
    }
  );

  registerTool(
    'list_payment_methods',
    {
      title: 'List Payment Methods',
      description: 'List company payment methods.',
      inputSchema: {
        search: z.string().optional().describe('Search method name'),
        method_type: z.string().optional().describe('Method type'),
        is_active: z.union([z.boolean(), z.number()]).optional().describe('Active flag'),
        page: z.number().optional().describe('Page number (default: 1)'),
        per_page: z.number().optional().describe('Results per page (default: 25)'),
      },
    },
    async ({ search, method_type, is_active, page = 1, per_page = 25 } = {}) => {
      const { companyId, userId } = getWorxstreamContext();
      const data = {
        companyId,
        userId,
        pagination: 1,
        per_page: per_page ?? 25,
        page: page ?? 1,
        sort: 'asc',
        sort_by: 'method_name',
      };
      if (search) data.search = search;
      if (method_type) data.method_type = method_type;
      if (is_active != null) data.is_active = is_active;
      return asText(await callWorxstreamAPI({ method: 'GET', endpoint: '/payment-methods/list', data }));
    }
  );

  registerTool(
    'get_payment_methods_dropdown',
    {
      title: 'Get Payment Methods Dropdown',
      description: 'Active payment methods dropdown for receiving payments.',
      inputSchema: {},
    },
    async () => {
      const { companyId, userId } = getWorxstreamContext();
      return asText(await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/payment-methods/dropdown',
        data: { companyId, userId, is_active: 1 },
      }));
    }
  );
}
