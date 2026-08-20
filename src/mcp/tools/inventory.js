/**
 * Inventory Tools — warehouses, stock, batches, serials, adjustments, transfers
 */

import { z } from 'zod';
import { registerTool } from '../server.js';
import { callWorxstreamAPI } from '../../services/httpClient.js';
import { getWorxstreamContext } from '../../config/index.js';

function asText(result) {
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}

export function registerInventoryTools() {
  registerTool(
    'list_warehouses',
    {
      title: 'List Warehouses',
      description: 'List warehouses. Optional search and managed/serial flags.',
      inputSchema: {
        search: z.string().optional().describe('Search by warehouse name or number'),
        page: z.number().optional().describe('Page number (default: 1)'),
        per_page: z.number().optional().describe('Results per page (default: 25)'),
        is_warehouse_managed: z.boolean().optional().describe('Filter to inventory-managed warehouses'),
        is_serial_number_managed: z.boolean().optional().describe('Filter to serial-managed warehouses'),
      },
    },
    async ({ search, page = 1, per_page = 25, is_warehouse_managed, is_serial_number_managed } = {}) => {
      const { companyId, userId } = getWorxstreamContext();
      const data = {
        companyId,
        userId,
        page: page ?? 1,
        perPage: per_page ?? 25,
        limit: per_page ?? 25,
      };
      if (search?.trim()) data.search = search.trim();
      if (is_warehouse_managed !== undefined) data.isWarehouseManaged = is_warehouse_managed;
      if (is_serial_number_managed !== undefined) data.isSerialNumberManaged = is_serial_number_managed;
      return asText(await callWorxstreamAPI({ method: 'GET', endpoint: '/warehouses/list', data }));
    }
  );

  registerTool(
    'get_warehouse_details',
    {
      title: 'Get Warehouse Details',
      description: 'Get a warehouse by ID.',
      inputSchema: { id: z.number().describe('Warehouse ID') },
    },
    async ({ id }) => {
      const { companyId, userId } = getWorxstreamContext();
      return asText(await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/warehouses/show',
        data: { companyId, userId, id },
      }));
    }
  );

  registerTool(
    'get_warehouses_dropdown',
    {
      title: 'Get Warehouses Dropdown',
      description: 'Compact warehouse dropdown (id, label, isActive, isManaged). Use to resolve a warehouse by name.',
      inputSchema: {},
    },
    async () => {
      const { companyId, userId } = getWorxstreamContext();
      return asText(await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/warehouses/dropdown',
        data: { companyId, userId },
      }));
    }
  );

  registerTool(
    'list_warehouse_groups',
    {
      title: 'List Warehouse Groups',
      description: 'List warehouse groups.',
      inputSchema: {
        search: z.string().optional().describe('Search by group name'),
        page: z.number().optional().describe('Page number (default: 1)'),
        per_page: z.number().optional().describe('Results per page (default: 25)'),
        is_active: z.boolean().optional().describe('Filter by active flag'),
      },
    },
    async ({ search, page = 1, per_page = 25, is_active } = {}) => {
      const { companyId, userId } = getWorxstreamContext();
      const data = { companyId, userId, page: page ?? 1, perPage: per_page ?? 25 };
      if (search?.trim()) data.search = search.trim();
      if (is_active !== undefined) {
        data.is_active = is_active;
        data.isActive = is_active;
      }
      return asText(await callWorxstreamAPI({ method: 'GET', endpoint: '/warehouse-groups/list', data }));
    }
  );

  registerTool(
    'get_inventory_stock_qty',
    {
      title: 'Get Inventory Stock Qty',
      description: 'Get on-hand stock quantity for a product/SKU, optionally in one warehouse.',
      inputSchema: {
        product_id: z.number().optional().describe('Product/service ID'),
        sku: z.string().optional().describe('Product SKU'),
        warehouse_id: z.number().optional().describe('Warehouse ID'),
      },
    },
    async ({ product_id, sku, warehouse_id } = {}) => {
      const { companyId, userId } = getWorxstreamContext();
      const data = { company_id: companyId, user_id: userId };
      if (product_id !== undefined) data.product_id = product_id;
      if (sku?.trim()) data.sku = sku.trim();
      if (warehouse_id !== undefined) data.warehouse_id = warehouse_id;
      return asText(await callWorxstreamAPI({ method: 'POST', endpoint: '/inventory/stock/qty', data }));
    }
  );

  registerTool(
    'list_inventory_stock',
    {
      title: 'List Inventory Stock',
      description: 'Paginated stock list for a warehouse (lots, SKUs, available qty).',
      inputSchema: {
        warehouse_id: z.number().optional().describe('Warehouse ID'),
        search: z.string().optional().describe('Search SKU or product title'),
        page: z.number().optional().describe('Page number (default: 1)'),
        limit: z.number().optional().describe('Results per page (default: 15)'),
        only_available: z.boolean().optional().describe('Only rows with available qty (default: true)'),
        stock_type: z.string().optional().describe('serial or non_serial'),
        category_id: z.number().optional().describe('Product category ID'),
      },
    },
    async ({ warehouse_id, search, page = 1, limit = 15, only_available = true, stock_type, category_id } = {}) => {
      const { companyId, userId } = getWorxstreamContext();
      const filter = { with_lot_info: false, only_available: only_available ?? true };
      if (stock_type) filter.stock_type = stock_type;
      if (category_id !== undefined) filter.category_id = category_id;
      const trimmed = search?.trim();
      if (trimmed) filter.search = trimmed;
      const data = {
        company_id: companyId,
        user_id: userId,
        page: page ?? 1,
        limit: limit ?? 15,
        filter,
      };
      if (warehouse_id !== undefined) data.warehouse_id = warehouse_id;
      if (trimmed) data.search = trimmed;
      return asText(await callWorxstreamAPI({ method: 'POST', endpoint: '/inventory/stock/list', data }));
    }
  );

  registerTool(
    'list_inventory_adjustments',
    {
      title: 'List Inventory Adjustments',
      description: 'List stock adjustments (SET TO / INCREASE / DECREASE / TRANSFER).',
      inputSchema: {
        warehouse_id: z.number().optional().describe('Warehouse ID'),
        search: z.string().optional().describe('Search text'),
        status: z.string().optional().describe('Adjustment status'),
        page: z.number().optional().describe('Page number (default: 1)'),
        limit: z.number().optional().describe('Results per page (default: 25)'),
      },
    },
    async ({ warehouse_id, search, status, page = 1, limit = 25 } = {}) => {
      const { companyId, userId } = getWorxstreamContext();
      const data = { company_id: companyId, user_id: userId, page: page ?? 1, limit: limit ?? 25 };
      if (warehouse_id !== undefined) data.warehouse_id = warehouse_id;
      if (status?.trim()) data.status = status.trim();
      const trimmed = search?.trim();
      if (trimmed) data.filter = { search: trimmed };
      return asText(await callWorxstreamAPI({ method: 'POST', endpoint: '/inventory/adjustment/list', data }));
    }
  );

  registerTool(
    'get_inventory_adjustment_details',
    {
      title: 'Get Inventory Adjustment Details',
      description: 'Get a stock adjustment by ID.',
      inputSchema: { id: z.number().describe('Adjustment ID') },
    },
    async ({ id }) => {
      const { companyId, userId } = getWorxstreamContext();
      return asText(await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/inventory/adjustment/show',
        data: { company_id: companyId, user_id: userId, id },
      }));
    }
  );

  registerTool(
    'list_inventory_internal_transfers',
    {
      title: 'List Inventory Internal Transfers',
      description: 'List warehouse-to-warehouse stock transfers.',
      inputSchema: {
        source_warehouse_id: z.number().optional().describe('Source warehouse ID'),
        dest_warehouse_id: z.number().optional().describe('Destination warehouse ID'),
        product_id: z.number().optional().describe('Product ID'),
        search: z.string().optional().describe('Search text'),
        status: z.string().optional().describe('Transfer status'),
        page: z.number().optional().describe('Page number (default: 1)'),
        limit: z.number().optional().describe('Results per page (default: 25)'),
      },
    },
    async ({ source_warehouse_id, dest_warehouse_id, product_id, search, status, page = 1, limit = 25 } = {}) => {
      const { companyId, userId } = getWorxstreamContext();
      const data = { company_id: companyId, user_id: userId, page: page ?? 1, limit: limit ?? 25 };
      if (source_warehouse_id !== undefined) data.source_warehouse_id = source_warehouse_id;
      if (dest_warehouse_id !== undefined) data.dest_warehouse_id = dest_warehouse_id;
      if (product_id !== undefined) data.product_id = product_id;
      if (status?.trim()) data.status = status.trim();
      const trimmed = search?.trim();
      if (trimmed) data.filter = { search: trimmed };
      return asText(await callWorxstreamAPI({ method: 'POST', endpoint: '/inventory/internal-transfer/list', data }));
    }
  );

  registerTool(
    'list_inventory_batches',
    {
      title: 'List Inventory Batches',
      description: 'List inventory lots/batches.',
      inputSchema: {
        warehouse_id: z.number().optional().describe('Warehouse ID'),
        search: z.string().optional().describe('Search lot/reference'),
        from_date: z.string().optional().describe('From date YYYY-MM-DD'),
        to_date: z.string().optional().describe('To date YYYY-MM-DD'),
        page: z.number().optional().describe('Page number (default: 1)'),
        limit: z.number().optional().describe('Results per page (default: 25)'),
      },
    },
    async ({ warehouse_id, search, from_date, to_date, page = 1, limit = 25 } = {}) => {
      const { companyId, userId } = getWorxstreamContext();
      const data = { companyId, userId, page: page ?? 1, limit: limit ?? 25 };
      if (warehouse_id !== undefined) data.warehouse_id = warehouse_id;
      if (search?.trim()) data.search = search.trim();
      if (from_date) data.from_date = from_date;
      if (to_date) data.to_date = to_date;
      return asText(await callWorxstreamAPI({ method: 'POST', endpoint: '/inventory/batch/list', data }));
    }
  );

  registerTool(
    'list_inventory_serial_numbers',
    {
      title: 'List Inventory Serial Numbers',
      description: 'List serial numbers, optionally filtered by product, warehouse, or status.',
      inputSchema: {
        product_id: z.number().optional().describe('Product ID'),
        warehouse_id: z.number().optional().describe('Warehouse ID'),
        status: z.string().optional().describe('Serial status'),
        search: z.string().optional().describe('Search serial number'),
        page: z.number().optional().describe('Page number (default: 1)'),
        limit: z.number().optional().describe('Results per page (default: 25)'),
      },
    },
    async ({ product_id, warehouse_id, status, search, page = 1, limit = 25 } = {}) => {
      const { companyId, userId } = getWorxstreamContext();
      const data = { company_id: companyId, user_id: userId, page: page ?? 1, limit: limit ?? 25 };
      if (product_id !== undefined) data.product_id = product_id;
      if (warehouse_id !== undefined) data.warehouse_id = warehouse_id;
      if (status?.trim()) data.status = status.trim();
      if (search?.trim()) data.search = search.trim();
      return asText(await callWorxstreamAPI({ method: 'POST', endpoint: '/inventory/serial-number/list', data }));
    }
  );

  registerTool(
    'list_inventory_sku_ledger',
    {
      title: 'List Inventory SKU Ledger',
      description: 'SKU movement ledger for a warehouse.',
      inputSchema: {
        warehouse_id: z.number().describe('Warehouse ID'),
        search: z.string().optional().describe('Search SKU or product'),
        from_date: z.string().optional().describe('From date YYYY-MM-DD'),
        to_date: z.string().optional().describe('To date YYYY-MM-DD'),
        page: z.number().optional().describe('Page number (default: 1)'),
        limit: z.number().optional().describe('Results per page (default: 25)'),
      },
    },
    async ({ warehouse_id, search, from_date, to_date, page = 1, limit = 25 }) => {
      const { companyId, userId } = getWorxstreamContext();
      const data = {
        company_id: companyId,
        user_id: userId,
        warehouse_id,
        page: page ?? 1,
        limit: limit ?? 25,
      };
      if (search?.trim()) data.search = search.trim();
      if (from_date?.trim()) data.from_date = from_date.trim();
      if (to_date?.trim()) data.to_date = to_date.trim();
      return asText(await callWorxstreamAPI({ method: 'POST', endpoint: '/inventory/sku-ledger/list', data }));
    }
  );

  registerTool(
    'list_inventory_suppliers',
    {
      title: 'List Inventory Suppliers',
      description: 'List inventory suppliers (warehouse supplier records).',
      inputSchema: {
        search: z.string().optional().describe('Search supplier name'),
        is_active: z.boolean().optional().describe('Filter by active flag'),
        page: z.number().optional().describe('Page number (default: 1)'),
        limit: z.number().optional().describe('Results per page (default: 25)'),
      },
    },
    async ({ search, is_active, page = 1, limit = 25 } = {}) => {
      const { companyId, userId } = getWorxstreamContext();
      const data = { company_id: companyId, user_id: userId, page: page ?? 1, limit: limit ?? 25 };
      if (search?.trim()) data.search = search.trim();
      if (is_active !== undefined) data.is_active = is_active;
      return asText(await callWorxstreamAPI({ method: 'POST', endpoint: '/inventory/supplier/list', data }));
    }
  );

  registerTool(
    'get_packing_list',
    {
      title: 'Get Packing List',
      description: 'Get the packing list for a master object (sales order, invoice, etc.) by object ID.',
      inputSchema: { id: z.number().describe('Master object ID') },
    },
    async ({ id }) => {
      const { companyId, userId } = getWorxstreamContext();
      return asText(await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/master-objects/packing-list',
        data: { company_id: companyId, user_id: userId, id },
      }));
    }
  );
}
