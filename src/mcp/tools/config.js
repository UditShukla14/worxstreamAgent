/**
 * Configuration & Framework Tools - MCP Tool Definitions
 */

import { z } from 'zod';
import { registerTool } from '../server.js';
import { callWorxstreamAPI } from '../../services/httpClient.js';
import { config } from '../../config/index.js';

export function registerConfigTools() {
  const companyId = config.worxstream.defaultCompanyId;
  const userId = config.worxstream.defaultUserId;

  // ============================================
  // DROPDOWN & COLUMN CONFIGS
  // ============================================

  registerTool(
    'get_dropdown_configs',
    {
      title: 'Get Dropdown Configs',
      description: 'Get dropdown configurations for an app. Note: Most dropdown values are available in get_app_filters - use that tool first. This tool is for advanced dropdown configuration management.',
      inputSchema: {
        app_code: z.string().describe('App code (e.g., contact, product)'),
      },
    },
    async ({ app_code }) => {
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/master/config/dropdown-configs',
        data: { company_id: companyId, user_id: userId, app_code },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'get_dropdown_values',
    {
      title: 'Get Dropdown Values',
      description: 'Get values for a specific dropdown.',
      inputSchema: {
        dropdown_id: z.number().describe('Dropdown ID'),
      },
    },
    async ({ dropdown_id }) => {
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/master/config/dropdown-values',
        data: { company_id: companyId, user_id: userId, dropdown_id },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'get_column_configs',
    {
      title: 'Get Column Configs',
      description: 'Get column configurations for an app.',
      inputSchema: {
        app_code: z.string().describe('App code'),
      },
    },
    async ({ app_code }) => {
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/master/config/column-configs',
        data: { company_id: companyId, user_id: userId, app_code },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'get_all_apps',
    {
      title: 'Get All Apps',
      description: 'Get all available apps/modules. Use this to find app IDs before calling get_app_filters to get dropdown values for a specific app.',
      inputSchema: {},
    },
    async () => {
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/master/config/all-apps',
        data: { company_id: companyId, user_id: userId },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // ============================================
  // FRAMEWORK
  // ============================================

  registerTool(
    'get_menus',
    {
      title: 'Get Menus',
      description: 'Get application menu structure.',
      inputSchema: {},
    },
    async () => {
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/framework/menus',
        data: { company_id: companyId },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'get_forms',
    {
      title: 'Get Forms',
      description: 'Get form configurations.',
      inputSchema: {},
    },
    async () => {
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/framework/forms',
        data: { company_id: companyId },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'get_country_codes',
    {
      title: 'Get Country Codes',
      description: 'Get list of country phone codes.',
      inputSchema: {},
    },
    async () => {
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/helper/country-codes',
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
