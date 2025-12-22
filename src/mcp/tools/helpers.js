/**
 * Helper Tools - MCP Tool Definitions
 */

import { z } from 'zod';
import { registerTool } from '../server.js';
import { callWorxstreamAPI } from '../../services/httpClient.js';

export function registerHelperTools() {
  // Get timezones
  registerTool(
    'get_timezones',
    {
      title: 'Get Timezones',
      description: 'Get list of available timezones.',
      inputSchema: {},
    },
    async () => {
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/helper/timezones',
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Get currencies
  registerTool(
    'get_currencies',
    {
      title: 'Get Currencies',
      description: 'Get list of available currencies.',
      inputSchema: {},
    },
    async () => {
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/helper/currencies',
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}

