/**
 * System Finder Tools - MCP Tool Definitions
 * System Finder helps find HVAC system configurations and matching products
 */

import { z } from 'zod';
import { registerTool } from '../server.js';
import { callWorxstreamAPI } from '../../services/httpClient.js';
import { getWorxstreamContext } from '../../config/index.js';

export function registerSystemFinderTools() {

  // Get system finder options
  registerTool(
    'get_system_finder_options',
    {
      title: 'Get System Finder Options',
      description: 'Get available system finder options including system types, configurations, and tonnages.',
      inputSchema: {},
    },
    async () => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/systemfinder/get-options',
        data: { company_id: companyId, user_id: userId },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Get matchup products
  registerTool(
    'get_system_finder_matchup_products',
    {
      title: 'Get System Finder Matchup Products',
      description: 'Get matching products for a specific system configuration (system type, config, and tonnage).',
      inputSchema: {
        system_type: z.string().describe('System type (e.g., "Split System (SEER2) - Gas Heating 15.3 SEER")'),
        config: z.string().describe('Configuration (e.g., "Horizontal Flow", "Up Flow", "Modular & Single Piece")'),
        tonnage: z.string().describe('Tonnage (e.g., "1.5", "2", "2.5", "3", "3.5", "4", "5")'),
      },
    },
    async ({ system_type, config: configValue, tonnage }) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/systemfinder/get-matchup-products',
        data: {
          company_id: companyId,
          user_id: userId,
          system_type,
          config: configValue,
          tonnage,
        },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}

