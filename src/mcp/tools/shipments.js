/**
 * Shipment Tools — MCP wrappers for the shipment master object (/master-objects/*-shipment).
 * Source of truth: apps/web/src/services/shipmentService.ts + API_ENDPOINTS.SHIPMENT.
 * A shipment is released from an estimate: only items with remaining quantity can be shipped.
 * (RXO carrier shipments under /rxo/shipments are a separate integration and not covered here.)
 */

import { z } from 'zod';
import { registerTool } from '../server.js';
import { callWorxstreamAPI, normalizeFilter } from '../../services/httpClient.js';
import { getWorxstreamContext } from '../../config/index.js';
import { getMaxListPageSize } from '../../nova/agents/policies/listPolicies.js';

function asText(result) {
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}

export function registerShipmentTools() {
  const filterSchema = z.object({
    search: z.string().optional().describe('Free text matched against shipment number, customer and job name. Never a status.'),
    advance: z.array(z.object({
      db_attribute: z.string().describe('Date column, e.g. created_at'),
      operator: z.string().describe('BETWEEN, >= or <='),
      value: z.union([z.string(), z.number(), z.array(z.string())]).describe('For BETWEEN pass [from_date, to_date] as YYYY-MM-DD'),
    })).optional().describe('Date-range filters'),
  }).optional();

  registerTool(
    'list_shipments',
    {
      title: 'List Shipments',
      description:
        'List shipments (goods released from estimates for delivery), one page at a time (page default 1, limit default 25, capped by the runtime). '
        + 'The response includes pagination.has_more and pagination.next_page; request the next page only when the user wants more. '
        + 'Use this to find shipments by number, customer or date. To check what can still be shipped for an estimate use get_estimate_releasable_items; '
        + 'for a single shipment use get_shipment_details.',
      inputSchema: {
        page: z.number().optional().describe('Page number, starting at 1'),
        limit: z.number().optional().describe('Page size (default 25)'),
        filter: filterSchema,
      },
    },
    async ({ page = 1, limit = 25, filter } = {}) => {
      const { companyId, userId } = getWorxstreamContext();
      const effectiveLimit = Math.min(Math.max(1, Number(limit) || 25), getMaxListPageSize());
      const effectivePage = Math.max(1, Math.floor(Number(page) || 1));
      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/master-objects/list-shipment',
        data: {
          company_id: companyId,
          user_id: userId,
          page: effectivePage,
          limit: effectiveLimit,
          filter: normalizeFilter(filter),
        },
      });

      if (result?.success && result?.data && typeof result.data === 'object') {
        const payload = result.data;
        const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.data?.shipments) ? payload.data.shipments : [];
        const pagination = payload?.pagination && typeof payload.pagination === 'object' ? payload.pagination : null;
        const currentPage = pagination?.currentPage ?? effectivePage;
        const lastPage = pagination?.lastPage;
        const hasMore = Number.isFinite(currentPage) && Number.isFinite(lastPage) && currentPage < lastPage;
        result.data = {
          ...payload,
          pagination: {
            ...(pagination || {}),
            returned: rows.length,
            has_more: hasMore,
            next_page: hasMore ? currentPage + 1 : null,
          },
        };
      }
      return asText(result);
    },
  );

  registerTool(
    'get_shipment_details',
    {
      title: 'Get Shipment Details',
      description:
        'Get one shipment with its sections, line items, quantities, customer and status. Requires the shipment ID; '
        + 'find it with list_shipments when the user gives a number or customer instead.',
      inputSchema: {
        id: z.number().describe('Shipment ID'),
      },
    },
    async ({ id }) => {
      const { companyId, userId } = getWorxstreamContext();
      return asText(await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/master-objects/show-shipment',
        data: { company_id: companyId, user_id: userId, id },
      }));
    },
  );

  registerTool(
    'get_estimate_releasable_items',
    {
      title: 'Get Estimate Releasable Items',
      description:
        'For an estimate, list each line item with its original, already-released, in-shipment, blocked and remaining quantity, and whether it can be selected. '
        + 'Call this before create_shipment_from_estimate to choose valid item IDs and quantities; a quantity cannot exceed remainingQty.',
      inputSchema: {
        estimate_id: z.number().describe('Estimate ID the shipment is released from'),
      },
    },
    async ({ estimate_id }) => {
      const { companyId, userId } = getWorxstreamContext();
      return asText(await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/master-objects/release/releasable-items',
        data: { company_id: companyId, user_id: userId, estimate_id },
      }));
    },
  );

  registerTool(
    'create_shipment_from_estimate',
    {
      title: 'Create Shipment From Estimate',
      description:
        'Create a shipment by releasing selected line items of an estimate. This writes data: confirm the estimate and the items with quantities with the user first. '
        + 'Get valid item IDs and maximum quantities from get_estimate_releasable_items. Returns the new shipment ID.',
      inputSchema: {
        estimate_id: z.number().describe('Estimate ID to release items from'),
        items: z.array(z.object({
          item_id: z.number().describe('itemId of the estimate line item (from get_estimate_releasable_items)'),
          qty: z.number().positive().describe('Quantity to ship; at most remainingQty'),
        })).min(1).describe('Line items and quantities to include in the shipment'),
      },
    },
    async ({ estimate_id, items }) => {
      const { companyId, userId } = getWorxstreamContext();
      return asText(await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/master-objects/shipment/create-from-estimate',
        data: { company_id: companyId, user_id: userId, estimate_id, items },
      }));
    },
  );

  registerTool(
    'clone_shipment',
    {
      title: 'Clone Shipment',
      description: 'Create a copy of an existing shipment. This writes data: confirm with the user first. Returns the new shipment.',
      inputSchema: {
        id: z.number().describe('Shipment ID to copy'),
      },
    },
    async ({ id }) => {
      const { companyId, userId } = getWorxstreamContext();
      return asText(await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/master-objects/clone-shipment',
        data: { companyId, userId, id },
      }));
    },
  );

  registerTool(
    'delete_shipment',
    {
      title: 'Delete Shipment',
      description: 'Soft-delete a shipment by ID. Destructive: state which shipment will be deleted and get the user\'s explicit confirmation first.',
      inputSchema: {
        id: z.number().describe('Shipment ID'),
      },
    },
    async ({ id }) => {
      const { companyId, userId } = getWorxstreamContext();
      return asText(await callWorxstreamAPI({
        method: 'DELETE',
        endpoint: '/master-objects/soft-delete-shipment',
        data: { companyId, userId, id },
      }));
    },
  );
}
