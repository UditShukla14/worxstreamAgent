/**
 * Reports Tools - MCP Tool Definitions for Reports API
 */

import { z } from 'zod';
import { registerTool } from '../server.js';
import { callWorxstreamAPI } from '../../services/httpClient.js';
import { getWorxstreamContext } from '../../config/index.js';

export function registerReportTools() {


  // Get report filters
  registerTool(
    'get_report_filters',
    {
      title: 'Get Report Filters',
      description: 'Retrieves all available filter options for report generation including employees, statuses, payment methods, customer classes, pipelines, and warehouse locations.',
      inputSchema: {}
    },
    async () => {
      const { companyId, userId } = getWorxstreamContext();
      
      return await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/report/filters',
        data: { 
          company_id: companyId, 
          user_id: userId 
        }
      });
    }
  );

  // Generate estimate report
  registerTool(
    'generate_estimate_report',
    {
      title: 'Generate Estimate Report',
      description: 'Generates a comprehensive estimate report with optional filtering and pagination. Includes totals, line items, status details, and performance metrics.',
      inputSchema: {
        from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Start date in YYYY-MM-DD format'),
        to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('End date in YYYY-MM-DD format'),
        line_items: z.boolean().optional().describe('Include line items in response (default: true)'),
        page: z.number().optional().describe('Page number for pagination (default: 1)'),
        per_page: z.number().optional().describe('Items per page (default: 50)'),
        assign_employee: z.number().optional().describe('Filter by assigned employee ID'),
        created_by: z.number().optional().describe('Filter by creator user ID'),
        status_id: z.string().optional().describe('Filter by status code'),
        customer_id: z.number().optional().describe('Filter by customer ID'),
        pipeline_id: z.number().optional().describe('Filter by pipeline ID'),
        stage_id: z.number().optional().describe('Filter by pipeline stage ID'),
        warehouse_location_id: z.number().optional().describe('Filter by warehouse location ID'),
        payment_method: z.string().optional().describe('Filter by payment method'),
        is_verified: z.number().optional().describe('Filter by verification status (0/1)'),
        is_qb_synced: z.number().optional().describe('Filter by QuickBooks sync status (0/1)'),
        search: z.string().optional().describe('Free text search across multiple fields')
      }
    },
    async (params) => {
      const { companyId, userId } = getWorxstreamContext();
      
      // Ensure proper data types and correct field names for estimate API
      const processedParams = {
        from_date: params.from_date,
        to_date: params.to_date,
        lineItems: params.line_items !== undefined ? Boolean(params.line_items) : true,
        page: params.page ? Number(params.page) : 1,
        per_page: params.per_page ? Number(params.per_page) : 50,
        assign_employee: params.assign_employee ? Number(params.assign_employee) : undefined,
        created_by: params.created_by ? Number(params.created_by) : undefined,
        status_id: params.status_id,
        customer_id: params.customer_id ? Number(params.customer_id) : undefined,
        pipeline_id: params.pipeline_id ? Number(params.pipeline_id) : undefined,
        stage_id: params.stage_id ? Number(params.stage_id) : undefined,
        warehouse_location_id: params.warehouse_location_id ? Number(params.warehouse_location_id) : undefined,
        payment_method: params.payment_method,
        is_verified: params.is_verified !== undefined ? Number(params.is_verified) : undefined,
        is_qb_synced: params.is_qb_synced !== undefined ? Number(params.is_qb_synced) : undefined,
        search: params.search
      };

      // Filter out undefined values
      const cleanParams = Object.fromEntries(
        Object.entries(processedParams).filter(([_, value]) => value !== undefined)
      );
      
      // Set context
      const requestData = {
        company_id: companyId,
        user_id: userId,
        ...cleanParams
      };
      
      return await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/report/estimate/generate',
        data: requestData
      });
    }
  );

  // Generate invoice report
  registerTool(
    'generate_invoice_report',
    {
      title: 'Generate Invoice Report',
      description: 'Generates a comprehensive invoice report with optional filtering and pagination. Includes totals, line items, payment information, and performance metrics.',
      inputSchema: {
        from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Start date in YYYY-MM-DD format'),
        to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('End date in YYYY-MM-DD format'),
        line_items: z.boolean().optional().describe('Include line items in response (default: true)'),
        page: z.number().optional().describe('Page number for pagination (default: 1)'),
        per_page: z.number().optional().describe('Items per page (default: 50)'),
        assign_employee: z.number().optional().describe('Filter by assigned employee ID'),
        created_by: z.number().optional().describe('Filter by creator user ID'),
        status_id: z.string().optional().describe('Filter by status code'),
        customer_id: z.number().optional().describe('Filter by customer ID'),
        pipeline_id: z.number().optional().describe('Filter by pipeline ID'),
        stage_id: z.number().optional().describe('Filter by pipeline stage ID'),
        warehouse_location_id: z.number().optional().describe('Filter by warehouse location ID'),
        payment_method: z.string().optional().describe('Filter by payment method'),
        is_verified: z.number().optional().describe('Filter by verification status (0/1)'),
        is_qb_synced: z.number().optional().describe('Filter by QuickBooks sync status (0/1)'),
        search: z.string().optional().describe('Free text search across multiple fields')
      }
    },
    async (params) => {
      const { companyId, userId } = getWorxstreamContext();
      
      // Ensure proper data types and correct field names for invoice API
      const processedParams = {
        from_date: params.from_date,
        to_date: params.to_date,
        lineItems: params.line_items !== undefined ? Boolean(params.line_items) : true,
        page: params.page ? Number(params.page) : 1,
        per_page: params.per_page ? Number(params.per_page) : 50,
        assign_employee: params.assign_employee ? Number(params.assign_employee) : undefined,
        created_by: params.created_by ? Number(params.created_by) : undefined,
        status_id: params.status_id,
        customer_id: params.customer_id ? Number(params.customer_id) : undefined,
        pipeline_id: params.pipeline_id ? Number(params.pipeline_id) : undefined,
        stage_id: params.stage_id ? Number(params.stage_id) : undefined,
        warehouse_location_id: params.warehouse_location_id ? Number(params.warehouse_location_id) : undefined,
        payment_method: params.payment_method,
        is_verified: params.is_verified !== undefined ? Number(params.is_verified) : undefined,
        is_qb_synced: params.is_qb_synced !== undefined ? Number(params.is_qb_synced) : undefined,
        search: params.search
      };

      // Filter out undefined values
      const cleanParams = Object.fromEntries(
        Object.entries(processedParams).filter(([_, value]) => value !== undefined)
      );
      
      // Set context
      const requestData = {
        company_id: companyId,
        user_id: userId,
        ...cleanParams
      };
      
      return await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/report/invoice/generate',
        data: requestData
      });
    }
  );

  // Export invoice report CSV
  registerTool(
    'export_invoice_report_csv',
    {
      title: 'Export Invoice Report CSV',
      description: 'Exports invoice report data as CSV for a date range (same as Reports → Invoice Report export).',
      inputSchema: {
        from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Start date YYYY-MM-DD'),
        to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('End date YYYY-MM-DD'),
      },
    },
    async ({ from_date, to_date }) => {
      const { companyId, userId } = getWorxstreamContext();
      return await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/report/invoice/export-csv',
        data: {
          company_id: companyId,
          user_id: userId,
          from_date,
          to_date,
        },
        responseType: 'blob',
      });
    },
  );

  registerTool(
    'export_estimate_report_csv',
    {
      title: 'Export Estimate Report CSV',
      description: 'Exports estimate report data as CSV for a date range (Reports → Estimate Report).',
      inputSchema: {
        from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Start date YYYY-MM-DD'),
        to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('End date YYYY-MM-DD'),
      },
    },
    async ({ from_date, to_date }) => {
      const { companyId, userId } = getWorxstreamContext();
      return await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/report/estimate/export-csv',
        data: {
          company_id: companyId,
          user_id: userId,
          from_date,
          to_date,
        },
        responseType: 'blob',
      });
    },
  );

  // Get estimate line items report
  registerTool(
    'get_estimate_line_items',
    {
      title: 'Get Estimate Line Items Report',
      description: 'Retrieves detailed line items for a specific estimate including product details, quantities, pricing, and costs.',
      inputSchema: {
        object_name: z.literal('estimate').describe('Object type (must be "estimate")'),
        object_id: z.number().describe('Estimate ID')
      }
    },
    async ({ object_name, object_id }) => {
      const { companyId, userId } = getWorxstreamContext();
      
      return await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/report/estimate/line-items',
        data: {
          company_id: companyId,
          user_id: userId,
          object_name,
          object_id
        }
      });
    }
  );

  // Get invoice line items report
  registerTool(
    'get_invoice_line_items',
    {
      title: 'Get Invoice Line Items Report',
      description: 'Retrieves detailed line items for a specific invoice including product details, quantities, pricing, and costs.',
      inputSchema: {
        object_name: z.literal('invoice').describe('Object type (must be "invoice")'),
        object_id: z.number().describe('Invoice ID')
      }
    },
    async ({ object_name, object_id }) => {
      const { companyId, userId } = getWorxstreamContext();
      
      return await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/report/invoice/line-items',
        data: {
          company_id: companyId,
          user_id: userId,
          object_name,
          object_id
        }
      });
    }
  );

  // Get product selling history
  registerTool(
    'get_product_selling_history',
    {
      title: 'Get Product Selling History',
      description: 'Retrieves historical selling data for a specific product including sales prices, costs, and customer information.',
      inputSchema: {
        product_id: z.number().describe('Product ID')
      }
    },
    async ({ product_id }) => {
      const { companyId, userId } = getWorxstreamContext();
      
      return await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/report/product/selling-history',
        data: {
          company_id: companyId,
          user_id: userId,
          product_id
        }
      });
    }
  );

  // Product Report (Reports hub)
  registerTool(
    'generate_product_report',
    {
      title: 'Generate Product Report',
      description:
        'Generates the Product Report grid (Reports → Products): units sold, revenue, and cost by product for a date range. Same API as /reports/products.',
      inputSchema: {
        from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Start date YYYY-MM-DD'),
        to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('End date YYYY-MM-DD'),
        product_name: z.string().optional().describe('Filter by product name'),
        customer_ids: z.array(z.number()).optional().describe('Filter by customer IDs'),
        warehouse_id: z.number().optional().describe('Filter by warehouse ID'),
        page: z.number().optional().describe('Page (default 1)'),
        per_page: z.number().optional().describe('Rows per page (default 50)'),
      },
    },
    async (params) => {
      const { companyId, userId } = getWorxstreamContext();
      const data = {
        company_id: companyId,
        user_id: userId,
        from_date: params.from_date,
        to_date: params.to_date,
        page: params.page ? Number(params.page) : 1,
        per_page: params.per_page ? Number(params.per_page) : 50,
      };
      if (params.product_name?.trim()) data.product_name = params.product_name.trim();
      if (params.customer_ids?.length) data.customer_ids = params.customer_ids.map(Number);
      if (params.warehouse_id != null && params.warehouse_id > 0) {
        data.warehouse_id = Number(params.warehouse_id);
      }
      return await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/report/product/generate',
        data,
      });
    },
  );

  registerTool(
    'export_product_report_csv',
    {
      title: 'Export Product Report CSV',
      description: 'Exports product report CSV for a date range (Reports → Products).',
      inputSchema: {
        from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Start date YYYY-MM-DD'),
        to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('End date YYYY-MM-DD'),
      },
    },
    async ({ from_date, to_date }) => {
      const { companyId, userId } = getWorxstreamContext();
      return await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/report/product/export-csv',
        data: {
          company_id: companyId,
          user_id: userId,
          from_date,
          to_date,
        },
        responseType: 'blob',
      });
    },
  );

  // Customer Buying Report (Reports hub — 4 views)
  const customerBuyingBaseSchema = {
    from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Start date YYYY-MM-DD'),
    to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('End date YYYY-MM-DD'),
    customer_ids: z.array(z.number()).min(1).describe('One or more customer IDs'),
    warehouse_id: z.number().optional().describe('Optional warehouse filter'),
  };

  function buildCustomerBuyingData(params) {
    const { companyId, userId } = getWorxstreamContext();
    const data = {
      company_id: companyId,
      user_id: userId,
      from_date: params.from_date,
      to_date: params.to_date,
      customer_ids: params.customer_ids.map(Number),
    };
    if (params.warehouse_id != null && params.warehouse_id > 0) {
      data.warehouse_id = Number(params.warehouse_id);
    }
    return data;
  }

  registerTool(
    'generate_customer_buying_unique_products_report',
    {
      title: 'Customer Buying — Unique Products',
      description:
        'Customer Buying Report unique-products view (Reports → Customer Buying). Qty by product across selected customers.',
      inputSchema: customerBuyingBaseSchema,
    },
    async (params) =>
      callWorxstreamAPI({
        method: 'POST',
        endpoint: '/report/customer-buying/unique-products',
        data: buildCustomerBuyingData(params),
      }),
  );

  registerTool(
    'generate_customer_buying_monthly_products_report',
    {
      title: 'Customer Buying — Monthly Products',
      description:
        'Customer Buying Report monthly-products view (Reports → Customer Buying). Qty by product by month.',
      inputSchema: customerBuyingBaseSchema,
    },
    async (params) =>
      callWorxstreamAPI({
        method: 'POST',
        endpoint: '/report/customer-buying/monthly-products',
        data: buildCustomerBuyingData(params),
      }),
  );

  registerTool(
    'generate_customer_buying_price_lookup_report',
    {
      title: 'Customer Buying — Price Lookup',
      description:
        'Customer Buying price-lookup view: invoice line pricing for selected customers (optional SKU filter).',
      inputSchema: {
        ...customerBuyingBaseSchema,
        skus: z.array(z.string()).optional().describe('Optional SKUs to filter; omit for all'),
      },
    },
    async (params) => {
      const data = buildCustomerBuyingData(params);
      const skus = (params.skus || []).map((s) => String(s).trim()).filter(Boolean);
      if (skus.length) data.skus = skus;
      return callWorxstreamAPI({
        method: 'POST',
        endpoint: '/report/customer-buying/price-lookup',
        data,
      });
    },
  );

  registerTool(
    'generate_customer_buying_product_details_report',
    {
      title: 'Customer Buying — Product Details',
      description:
        'Customer Buying product-details view for one product across the date range.',
      inputSchema: {
        from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Start date YYYY-MM-DD'),
        to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('End date YYYY-MM-DD'),
        product_id: z.number().describe('Product ID'),
      },
    },
    async ({ from_date, to_date, product_id }) => {
      const { companyId, userId } = getWorxstreamContext();
      return callWorxstreamAPI({
        method: 'POST',
        endpoint: '/report/customer-buying/product-details',
        data: {
          company_id: companyId,
          user_id: userId,
          from_date,
          to_date,
          product_id: Number(product_id),
        },
      });
    },
  );

  // Reconcile Report
  registerTool(
    'generate_reconcile_report',
    {
      title: 'Generate Reconcile Report',
      description:
        'Reconcile Report data (Reports → Reconcile): vendor/Motili cost reconciliation for estimates/invoices. Read-only; use UI for mark-verified/credits.',
      inputSchema: {
        from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Start date YYYY-MM-DD'),
        to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('End date YYYY-MM-DD'),
        search: z.string().optional().describe('Free-text search'),
      },
    },
    async (params) => {
      const { companyId, userId } = getWorxstreamContext();
      const data = { company_id: companyId, user_id: userId };
      if (params.from_date?.trim()) data.from_date = params.from_date.trim();
      if (params.to_date?.trim()) data.to_date = params.to_date.trim();
      if (params.search?.trim()) data.search = params.search.trim();
      return callWorxstreamAPI({
        method: 'POST',
        endpoint: '/report/reconsile/data',
        data,
      });
    },
  );

  // Customer Address Report
  registerTool(
    'generate_customer_address_report',
    {
      title: 'Generate Customer Address Report',
      description:
        'Customer Address Report (Reports → Customer Address): customers filtered by taxable flag and tax rate via customer-list address filter.',
      inputSchema: {
        is_customer_taxable: z.boolean().describe('true = taxable customers, false = non-taxable'),
        customer_tax_rate: z.string().optional().describe('Tax rate string filter (e.g. "7.75"); empty = any'),
      },
    },
    async ({ is_customer_taxable, customer_tax_rate }) => {
      const { companyId, userId } = getWorxstreamContext();
      return callWorxstreamAPI({
        method: 'POST',
        endpoint: '/master/customer/customer-list',
        data: {
          company_id: companyId,
          user_id: userId,
          filter: {
            address: {
              is_customer_taxable: Boolean(is_customer_taxable),
              customer_tax_rate: customer_tax_rate != null ? String(customer_tax_rate) : '',
            },
          },
        },
      });
    },
  );

  // Warehouse Stock Report
  registerTool(
    'get_warehouse_stock_report_initial_data',
    {
      title: 'Warehouse Stock Report Filters',
      description:
        'Initial data for Warehouse Stock Report (managed warehouses, categories, stock types/statuses). Call before generate_warehouse_stock_report when filters are unknown.',
      inputSchema: {},
    },
    async () => {
      const { companyId, userId } = getWorxstreamContext();
      return callWorxstreamAPI({
        method: 'POST',
        endpoint: '/inventory/stock/report/managed-warehouses/initial-data',
        data: { company_id: companyId, user_id: userId },
      });
    },
  );

  registerTool(
    'generate_warehouse_stock_report',
    {
      title: 'Generate Warehouse Stock Report',
      description:
        'Warehouse Stock Report (Reports → Warehouse Stock): qty by SKU across managed warehouses. Same API as /reports/warehouse-stock.',
      inputSchema: {
        page: z.number().optional().describe('Page (default 1)'),
        limit: z.number().optional().describe('Rows per page (default 50)'),
        search: z.string().optional().describe('SKU/name search'),
        category_id: z.number().optional().describe('Product category ID'),
        sub_category_id: z.number().optional().describe('Product subcategory ID'),
        stock_type: z.string().optional().describe('Stock type filter'),
        stock_status: z.string().optional().describe('Stock status filter'),
        warehouse_id: z.number().optional().describe('Optional single warehouse focus'),
      },
    },
    async (params) => {
      const { companyId, userId } = getWorxstreamContext();
      const data = {
        company_id: companyId,
        user_id: userId,
        page: params.page ? Number(params.page) : 1,
        limit: params.limit ? Number(params.limit) : 50,
      };
      const filter = {};
      if (params.search?.trim()) {
        data.search = params.search.trim();
        filter.search = params.search.trim();
      }
      if (params.category_id != null) data.category_id = Number(params.category_id);
      if (params.sub_category_id != null) data.sub_category_id = Number(params.sub_category_id);
      if (params.warehouse_id != null) data.warehouse_id = Number(params.warehouse_id);
      if (params.stock_type?.trim()) {
        data.stock_type = params.stock_type.trim();
        filter.stock_type = params.stock_type.trim();
      }
      if (params.stock_status?.trim()) {
        data.stock_status = params.stock_status.trim();
        filter.stock_status = params.stock_status.trim();
      }
      if (Object.keys(filter).length) data.filter = filter;
      return callWorxstreamAPI({
        method: 'POST',
        endpoint: '/inventory/stock/report/managed-warehouses',
        data,
      });
    },
  );

  // Duplicate Serials Report
  registerTool(
    'generate_duplicate_serials_report',
    {
      title: 'Generate Duplicate Serials Report',
      description:
        'Warehouse Inventory duplicate-serials scan (Reports → Duplicate Serials). Finds serial numbers appearing more than once.',
      inputSchema: {
        warehouse_id: z.number().describe('Warehouse ID to scan'),
        page: z.number().optional().describe('Page (default 1)'),
        limit: z.number().optional().describe('Rows per page (default 50)'),
      },
    },
    async ({ warehouse_id, page, limit }) => {
      const { companyId, userId } = getWorxstreamContext();
      return callWorxstreamAPI({
        method: 'POST',
        endpoint: '/inventory/serial-number/duplicate-scan',
        data: {
          company_id: companyId,
          user_id: userId,
          warehouse_id: Number(warehouse_id),
          page: page ? Number(page) : 1,
          limit: limit ? Number(limit) : 50,
        },
      });
    },
  );

  // Motili Report
  registerTool(
    'generate_motili_report',
    {
      title: 'Generate Motili Report',
      description:
        'Motili Orders Report (Reports → Motili): lists Motili vendor orders. Same API as /reports/motili.',
      inputSchema: {
        page: z.number().optional().describe('Page (default 1)'),
        limit: z.number().optional().describe('Rows per page (default 15)'),
        sort: z.string().optional().describe('Optional sort string'),
      },
    },
    async ({ page, limit, sort } = {}) => {
      const { companyId, userId } = getWorxstreamContext();
      const data = {
        company_id: companyId,
        user_id: userId,
        page: page ? Number(page) : 1,
        limit: limit ? Number(limit) : 15,
      };
      if (sort?.trim()) data.sort = sort.trim();
      return callWorxstreamAPI({
        method: 'POST',
        endpoint: '/motili/orders/list',
        data,
      });
    },
  );

  // Goal Reports
  registerTool(
    'get_goal_list',
    {
      title: 'Get Goal List',
      description: 'Retrieves list of sales goals with employee assignments and performance targets.',
      inputSchema: {}
    },
    async () => {
      const { companyId, userId } = getWorxstreamContext();
      
      return await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/report/goal/list',
        data: {
          company_id: companyId,
          user_id: userId
        }
      });
    }
  );

  registerTool(
    'save_goal',
    {
      title: 'Save Goal',
      description: 'Creates or updates a sales goal with targets and employee assignments.',
      inputSchema: {
        id: z.number().optional().describe('Goal ID for updates (omit for new goals)'),
        name: z.string().describe('Goal name'),
        description: z.string().describe('Goal description'),
        employeeId: z.number().describe('Employee ID assigned to goal'),
        salesGoalAmount: z.number().describe('Target sales amount'),
        customerGoalCount: z.number().describe('Target customer count'),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Start date in YYYY-MM-DD format'),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('End date in YYYY-MM-DD format')
      }
    },
    async (params) => {
      const { companyId, userId } = getWorxstreamContext();
      
      return await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/report/goal/save',
        data: {
          company_id: companyId,
          user_id: userId,
          ...params
        }
      });
    }
  );

  registerTool(
    'get_monthly_sales_goal',
    {
      title: 'Get Monthly Sales Goal Report',
      description: 'Retrieves monthly sales performance data for a specific goal and year.',
      inputSchema: {
        goal_id: z.number().describe('Goal ID'),
        year: z.number().describe('Year (e.g., 2024)')
      }
    },
    async ({ goal_id, year }) => {
      const { companyId, userId } = getWorxstreamContext();
      
      return await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/report/goal/monthly-sales-goal',
        data: {
          company_id: companyId,
          user_id: userId,
          goal_id,
          year
        }
      });
    }
  );

  registerTool(
    'get_monthly_customer_acquisition',
    {
      title: 'Get Monthly Customer Acquisition Report',
      description: 'Retrieves monthly customer acquisition data for a specific goal and year.',
      inputSchema: {
        goal_id: z.number().describe('Goal ID'),
        year: z.number().describe('Year (e.g., 2024)')
      }
    },
    async ({ goal_id, year }) => {
      const { companyId, userId } = getWorxstreamContext();
      
      return await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/report/goal/monthly-customer-acquisition',
        data: {
          company_id: companyId,
          user_id: userId,
          goal_id,
          year
        }
      });
    }
  );

  registerTool(
    'get_pipeline_goal_report',
    {
      title: 'Get Pipeline Goal Report',
      description: 'Retrieves pipeline performance data for a specific goal.',
      inputSchema: {
        goal_id: z.number().describe('Goal ID')
      }
    },
    async ({ goal_id }) => {
      const { companyId, userId } = getWorxstreamContext();
      
      return await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/report/goal/pipeline-report',
        data: {
          company_id: companyId,
          user_id: userId,
          goal_id
        }
      });
    }
  );

  registerTool(
    'get_goal_progress',
    {
      title: 'Get Goal Progress',
      description: 'Retrieves goal progress data with performance metrics and completion status.',
      inputSchema: {
        goal_id: z.number().describe('Goal ID')
      }
    },
    async ({ goal_id }) => {
      const { companyId, userId } = getWorxstreamContext();
      
      return await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/report/goal/progress',
        data: {
          company_id: companyId,
          user_id: userId,
          goal_id
        }
      });
    }
  );

  console.log('✓ Report tools registered');
}