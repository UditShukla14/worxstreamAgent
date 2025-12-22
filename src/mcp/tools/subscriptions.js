/**
 * Subscription Tools - MCP Tool Definitions
 */

import { z } from 'zod';
import { registerTool } from '../server.js';
import { callWorxstreamAPI } from '../../services/httpClient.js';

export function registerSubscriptionTools() {
  // List all subscriptions
  registerTool(
    'list_subscriptions',
    {
      title: 'List Subscriptions',
      description: 'Get all master subscription plans with pagination.',
      inputSchema: {
        page: z.number().optional().describe('Page number (default: 1)'),
        per_page: z.number().optional().describe('Items per page (default: 15)'),
      },
    },
    async ({ page = 1, per_page = 15 }) => {
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/v1/master-subscriptions',
        params: { page, per_page },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Get active subscriptions
  registerTool(
    'get_active_subscriptions',
    {
      title: 'Get Active Subscriptions',
      description: 'Get only active subscription plans.',
      inputSchema: {},
    },
    async () => {
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/v1/master-subscriptions/active/list',
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
