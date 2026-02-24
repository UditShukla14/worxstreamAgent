/**
 * Projects Tools - MCP Tool Definitions
 * Projects are transaction entities used for project management
 */

import { z } from 'zod';
import { registerTool } from '../server.js';
import { callWorxstreamAPI } from '../../services/httpClient.js';
import { getWorxstreamContext } from '../../config/index.js';

export function registerProjectTools() {

  // List projects
  registerTool(
    'list_projects',
    {
      title: 'List Projects',
      description: 'Get all projects.',
      inputSchema: {},
    },
    async () => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/transaction/project/get-projects',
        data: {
          company_id: companyId,
          user_id: userId,
        },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Get project details
  registerTool(
    'get_project_details',
    {
      title: 'Get Project Details',
      description: 'Get project details by ID.',
      inputSchema: {
        id: z.number().describe('Project ID'),
      },
    },
    async ({ id }) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/transaction/project/get-project-details',
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

  // Create project
  registerTool(
    'create_project',
    {
      title: 'Create Project',
      description: 'Create a new project.',
      inputSchema: {
        name: z.string().describe('Project name'),
        contact_id: z.number().describe('Contact ID'),
        start_date: z.string().describe('Start date (YYYY-MM-DD)'),
        end_date: z.string().describe('End date (YYYY-MM-DD)'),
        description: z.string().optional().describe('Project description'),
        project_type: z.string().optional().describe('Project type ID'),
        address_id: z.number().nullable().optional().describe('Address ID'),
        project_manager: z.number().nullable().optional().describe('Project manager user ID'),
        tags: z.array(z.string()).optional().describe('Tags (array of strings)'),
        is_active: z.boolean().optional().describe('Is active (default: true)'),
      },
    },
    async (input) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/transaction/project/create-projects',
        data: {
          company_id: companyId,
          user_id: userId,
          name: input.name,
          description: input.description || null,
          project_type: input.project_type || null,
          contact_id: input.contact_id,
          address_id: input.address_id || null,
          project_manager: input.project_manager || null,
          start_date: input.start_date,
          end_date: input.end_date,
          tags: Array.isArray(input.tags) ? input.tags : [],
          is_active: input.is_active !== undefined ? input.is_active : true,
        },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Update project
  registerTool(
    'update_project',
    {
      title: 'Update Project',
      description: 'Update a project with multiple fields.',
      inputSchema: {
        id: z.number().describe('Project ID'),
        name: z.string().optional().describe('Project name'),
        description: z.string().optional().describe('Project description'),
        project_type: z.string().optional().describe('Project type ID'),
        contact_id: z.number().optional().describe('Contact ID'),
        address_id: z.number().nullable().optional().describe('Address ID'),
        project_manager: z.number().nullable().optional().describe('Project manager user ID'),
        start_date: z.string().optional().describe('Start date (YYYY-MM-DD)'),
        end_date: z.string().optional().describe('End date (YYYY-MM-DD)'),
        tags: z.array(z.string()).optional().describe('Tags (array of strings)'),
        is_active: z.boolean().optional().describe('Is active'),
      },
    },
    async (input) => {
      const { id, ...updateData } = input;
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'PUT',
        endpoint: '/transaction/project/update-projects',
        data: {
          company_id: companyId,
          user_id: userId,
          id,
          ...updateData,
          tags: input.tags !== undefined ? (Array.isArray(input.tags) ? input.tags : []) : undefined,
        },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Delete project
  registerTool(
    'delete_project',
    {
      title: 'Delete Project',
      description: 'Delete a project.',
      inputSchema: {
        id: z.number().describe('Project ID'),
      },
    },
    async ({ id }) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'DELETE',
        endpoint: '/transaction/project/delete-projects',
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

  // Clone project
  registerTool(
    'clone_project',
    {
      title: 'Clone Project',
      description: 'Clone/duplicate a project.',
      inputSchema: {
        id: z.number().describe('Project ID to clone'),
      },
    },
    async ({ id }) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/transaction/project/clone-projects',
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
}

