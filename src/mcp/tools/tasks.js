/**
 * Tasks Tools - MCP Tool Definitions
 */

import { z } from 'zod';
import { registerTool } from '../server.js';
import { callWorxstreamAPI } from '../../services/httpClient.js';
import { config } from '../../config/index.js';

export function registerTaskTools() {
  const companyId = config.worxstream.defaultCompanyId;
  const userId = config.worxstream.defaultUserId;

  // List tasks
  registerTool(
    'list_tasks',
    {
      title: 'List Tasks',
      description: 'Get all tasks. Can filter by object_name, object_id, and app_id.',
      inputSchema: {
        object_name: z.string().optional().describe('Object name (optional)'),
        object_id: z.number().optional().describe('Object ID (optional)'),
        app_id: z.number().optional().describe('App ID (optional)'),
      },
    },
    async ({ object_name, object_id, app_id }) => {
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/transaction/task/get-tasks',
        data: {
          company_id: companyId,
          user_id: userId,
          object_name: object_name || null,
          object_id: object_id || null,
          app_id: app_id || null,
        },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Get task details
  registerTool(
    'get_task_details',
    {
      title: 'Get Task Details',
      description: 'Get task details by ID.',
      inputSchema: {
        id: z.number().describe('Task ID'),
      },
    },
    async ({ id }) => {
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/transaction/task/get-task-details',
        data: {
          company_id: companyId,
          user_id: userId,
          id,
        },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Create task
  registerTool(
    'create_task',
    {
      title: 'Create Task',
      description: 'Create a new task.',
      inputSchema: {
        title: z.string().describe('Task title'),
        description: z.string().optional().describe('Task description'),
        issue_type: z.string().optional().describe('Issue type ID'),
        priority: z.string().optional().describe('Priority ID'),
        status: z.string().optional().describe('Status ID'),
        assign_to: z.number().optional().describe('Assign to user ID'),
        start_date: z.string().optional().describe('Start date (YYYY-MM-DD)'),
        end_date: z.string().optional().describe('End date (YYYY-MM-DD)'),
        tags: z.array(z.string()).optional().describe('Tags'),
        object_name: z.string().optional().describe('Object name'),
        object_id: z.number().optional().describe('Object ID'),
        app_id: z.number().optional().describe('App ID'),
      },
    },
    async (input) => {
      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/transaction/task/create-tasks',
        data: {
          company_id: companyId,
          user_id: userId,
          object_name: input.object_name || null,
          object_id: input.object_id || null,
          app_id: input.app_id || null,
          title: input.title,
          description: input.description || '',
          issue_type: input.issue_type || null,
          priority: input.priority || null,
          status: input.status || '1',
          assign_to: input.assign_to || null,
          start_date: input.start_date || null,
          end_date: input.end_date || null,
          tags: Array.isArray(input.tags) ? input.tags : [],
          is_active: true,
        },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
