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
      description: 'Exports invoice report data as CSV file for download.',
      inputSchema: {}
    },
    async () => {
      const { companyId, userId } = getWorxstreamContext();
      
      return await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/report/invoice/export-csv',
        data: { 
          company_id: companyId, 
          user_id: userId 
        },
        responseType: 'blob' // For binary file download
      });
    }
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