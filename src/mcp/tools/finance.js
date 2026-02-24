/**
 * Finance Tools - MCP Tool Definitions (Tax, Chart of Accounts)
 */

import { z } from 'zod';
import { registerTool } from '../server.js';
import { callWorxstreamAPI } from '../../services/httpClient.js';
import { getWorxstreamContext } from '../../config/index.js';

export function registerFinanceTools() {

  // ============================================
  // TAX
  // ============================================

  registerTool(
    'list_taxes',
    {
      title: 'List Taxes',
      description: 'Get all tax configurations.',
      inputSchema: {},
    },
    async () => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/master/tax/tax-list',
        data: { company_id: companyId, user_id: userId },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'get_tax_dropdown',
    {
      title: 'Get Tax Dropdown',
      description: 'Get taxes for dropdown selection.',
      inputSchema: {},
    },
    async () => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/master/tax/tax-dropdown',
        data: { company_id: companyId, user_id: userId },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'create_tax',
    {
      title: 'Create Tax',
      description: 'Create a tax configuration.',
      inputSchema: {
        tax_name: z.string().describe('Tax name'),
        tax_rate: z.number().describe('Tax rate percentage'),
        is_active: z.boolean().optional().describe('Is active'),
      },
    },
    async (input) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/master/tax/create-tax',
        data: { 
          company_id: companyId, 
          user_id: userId, 
          ...input,
          is_active: input.is_active !== undefined ? input.is_active : true,
        },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'update_tax',
    {
      title: 'Update Tax',
      description: 'Update a tax configuration.',
      inputSchema: {
        id: z.number().describe('Tax ID'),
        tax_name: z.string().optional().describe('Tax name'),
        agency_name: z.string().optional().describe('Agency name'),
        tax_rate: z.number().optional().describe('Tax rate percentage'),
        county_name: z.string().optional().describe('County name'),
        state_name: z.string().optional().describe('State name'),
        valid_from: z.string().optional().describe('Valid from date'),
        valid_to: z.string().optional().describe('Valid to date'),
        is_active: z.boolean().optional().describe('Is active'),
      },
    },
    async (input) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'PUT',
        endpoint: '/master/tax/update-tax',
        data: { company_id: companyId, user_id: userId, ...input },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // ============================================
  // CHART OF ACCOUNTS
  // ============================================

  registerTool(
    'list_chart_of_accounts',
    {
      title: 'List Chart of Accounts',
      description: 'Get all chart of accounts.',
      inputSchema: {},
    },
    async () => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/master/config/all-account-charts',
        data: { company_id: companyId, user_id: userId },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'get_chart_of_accounts_dropdown',
    {
      title: 'Get Chart of Accounts Dropdown',
      description: 'Get chart of accounts for dropdown.',
      inputSchema: {},
    },
    async () => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/master/config/account-charts-dropdown',
        data: { company_id: companyId, user_id: userId },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'create_chart_of_account',
    {
      title: 'Create Chart of Account',
      description: 'Create a chart of account entry.',
      inputSchema: {
        name: z.string().describe('Account name'),
        code: z.string().describe('Account code'),
        account_type: z.string().describe('Account type'),
        description: z.string().optional().describe('Description'),
      },
    },
    async (input) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/master/config/create-account-chart',
        data: { company_id: companyId, user_id: userId, ...input },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'update_chart_of_account',
    {
      title: 'Update Chart of Account',
      description: 'Update a chart of account entry.',
      inputSchema: {
        id: z.number().describe('Account chart ID'),
        account_name: z.string().optional().describe('Account name'),
        account_number: z.string().optional().describe('Account number'),
        account_type: z.string().optional().describe('Account type: "income" or "expense"'),
        account_details: z.string().optional().describe('Account details'),
      },
    },
    async (input) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'PUT',
        endpoint: '/master/config/update-account-chart',
        data: { company_id: companyId, user_id: userId, ...input },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'delete_chart_of_account',
    {
      title: 'Delete Chart of Account',
      description: 'Delete a chart of account entry.',
      inputSchema: {
        id: z.number().describe('Account chart ID'),
      },
    },
    async ({ id }) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'DELETE',
        endpoint: '/master/config/delete-account-chart',
        data: { company_id: companyId, user_id: userId, id },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // ============================================
  // DROPDOWNS
  // ============================================

  registerTool(
    'create_dropdown_value',
    {
      title: 'Create Dropdown Value',
      description: 'Create a dropdown value.',
      inputSchema: {
        config_dropdown_id: z.number().describe('Config dropdown ID'),
        value: z.string().describe('Value'),
        label: z.string().optional().describe('Label'),
        order: z.number().optional().describe('Order'),
        icon: z.string().optional().describe('Icon'),
        color: z.string().optional().describe('Color'),
        css: z.string().optional().describe('CSS'),
        is_active: z.boolean().optional().describe('Is active'),
        is_default: z.boolean().optional().describe('Is default'),
      },
    },
    async (input) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/master/config/create-dropdown-values',
        data: { 
          company_id: companyId, 
          user_id: userId, 
          ...input,
          is_active: input.is_active !== undefined ? input.is_active : true,
        },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'update_dropdown_value',
    {
      title: 'Update Dropdown Value',
      description: 'Update a dropdown value.',
      inputSchema: {
        id: z.number().describe('Dropdown value ID'),
        config_dropdown_id: z.number().optional().describe('Config dropdown ID'),
        value: z.string().optional().describe('Value'),
        label: z.string().optional().describe('Label'),
        order: z.number().optional().describe('Order'),
        icon: z.string().optional().describe('Icon'),
        color: z.string().optional().describe('Color'),
        css: z.string().optional().describe('CSS'),
        is_active: z.boolean().optional().describe('Is active'),
        is_default: z.boolean().optional().describe('Is default'),
      },
    },
    async (input) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'PUT',
        endpoint: '/master/config/update-dropdown-values',
        data: { company_id: companyId, user_id: userId, ...input },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'generate_default_dropdowns',
    {
      title: 'Generate Default Dropdowns',
      description: 'Generate default dropdown values.',
      inputSchema: {},
    },
    async () => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/master/config/generate-default-dropdowns',
        data: { company_id: companyId, user_id: userId },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // ============================================
  // VIEW CONFIGURATION
  // ============================================

  registerTool(
    'save_column_config',
    {
      title: 'Save Column Config',
      description: 'Save column configuration for a view.',
      inputSchema: {
        app_id: z.number().describe('App ID'),
        field_id: z.number().describe('Field ID'),
        is_visible: z.boolean().describe('Is visible'),
        color: z.string().optional().describe('Color'),
        sort_order: z.number().optional().describe('Sort order'),
        config_fields_group_id: z.number().optional().describe('Fields group ID'),
      },
    },
    async (input) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/master/config/save-column-configs',
        data: { company_id: companyId, user_id: userId, ...input },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'generate_default_column_configs',
    {
      title: 'Generate Default Column Configs',
      description: 'Generate default column configurations.',
      inputSchema: {},
    },
    async () => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/master/config/generate-default-column-configs',
        data: { company_id: companyId, user_id: userId },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'save_fields_group',
    {
      title: 'Save Fields Group',
      description: 'Save a fields group.',
      inputSchema: {
        app_id: z.number().describe('App ID'),
        group_name: z.string().describe('Group name'),
        label: z.string().describe('Label'),
        sort_order: z.number().optional().describe('Sort order'),
        is_visible: z.boolean().optional().describe('Is visible'),
        is_active: z.boolean().optional().describe('Is active'),
      },
    },
    async (input) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/master/config/save-fields-group',
        data: { company_id: companyId, user_id: userId, ...input },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'get_fields_groups',
    {
      title: 'Get Fields Groups',
      description: 'Get fields groups for an app.',
      inputSchema: {
        app_id: z.number().describe('App ID'),
      },
    },
    async ({ app_id }) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/master/config/get-fields-groups',
        data: { company_id: companyId, user_id: userId, app_id },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'get_all_fields',
    {
      title: 'Get All Fields',
      description: 'Get all fields for an app.',
      inputSchema: {
        app_id: z.number().describe('App ID'),
      },
    },
    async ({ app_id }) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/master/config/get-all-fields',
        data: { company_id: companyId, user_id: userId, app_id },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'delete_fields_group',
    {
      title: 'Delete Fields Group',
      description: 'Delete a fields group.',
      inputSchema: {
        id: z.number().describe('Fields group ID'),
      },
    },
    async ({ id }) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'DELETE',
        endpoint: '/master/config/delete-fields-group',
        data: { company_id: companyId, user_id: userId, id },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'get_app_filters',
    {
      title: 'Get App Filters',
      description: 'Get filters and dropdown values for an app. This tool returns most dropdown values (like team members, lifecycle stages, statuses, etc.) needed for creating/updating records. Use this instead of separate dropdown tools. Use get_all_apps to find app IDs.',
      inputSchema: {
        app_id: z.number().describe('App ID (use get_all_apps to find app IDs, e.g., contact app, customer app)'),
      },
    },
    async ({ app_id }) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/master/config/app-filters-for-list',
        data: { company_id: companyId, user_id: userId, app_id },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

}
