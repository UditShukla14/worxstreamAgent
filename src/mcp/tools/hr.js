/**
 * HR Tools - MCP Tool Definitions (Departments, Teams, Members)
 */

import { z } from 'zod';
import { registerTool } from '../server.js';
import { callWorxstreamAPI } from '../../services/httpClient.js';
import { getWorxstreamContext } from '../../config/index.js';

export function registerHRTools() {

  // ============================================
  // DEPARTMENTS
  // ============================================

  registerTool(
    'list_departments',
    {
      title: 'List Departments',
      description: 'Get all departments.',
      inputSchema: {},
    },
    async () => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/hr/departments/list',
        data: { company_id: companyId },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'get_department',
    {
      title: 'Get Department',
      description: 'Get department details.',
      inputSchema: {
        id: z.number().describe('Department ID'),
      },
    },
    async ({ id }) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/hr/departments/show',
        data: { company_id: companyId, id },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'create_department',
    {
      title: 'Create Department',
      description: 'Create a department.',
      inputSchema: {
        name: z.string().describe('Department name'),
        description: z.string().optional().describe('Description'),
        parent_id: z.number().optional().describe('Parent department ID'),
        branch_id: z.number().optional().describe('Branch ID'),
        is_active: z.boolean().optional().describe('Is active'),
      },
    },
    async (input) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/hr/departments/store',
        data: { 
          company_id: companyId, 
          ...input,
          is_active: true,
        },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'get_department_hierarchy',
    {
      title: 'Get Department Hierarchy',
      description: 'Get department hierarchy tree.',
      inputSchema: {},
    },
    async () => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/hr/departments/hierarchy',
        data: { company_id: companyId },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'get_department_statistics',
    {
      title: 'Get Department Statistics',
      description: 'Get department statistics.',
      inputSchema: {},
    },
    async () => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/hr/departments/statistics',
        data: { company_id: companyId },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'update_department',
    {
      title: 'Update Department',
      description: 'Update a department.',
      inputSchema: {
        id: z.number().describe('Department ID'),
        name: z.string().optional().describe('Department name'),
        description: z.string().optional().describe('Description'),
        parent_id: z.number().optional().describe('Parent department ID'),
        branch_id: z.number().optional().describe('Branch ID'),
        is_active: z.boolean().optional().describe('Is active'),
      },
    },
    async (input) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'PUT',
        endpoint: '/hr/departments/update',
        data: { company_id: companyId, user_id: userId, ...input },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'delete_department',
    {
      title: 'Delete Department',
      description: 'Delete a department.',
      inputSchema: {
        id: z.number().describe('Department ID'),
      },
    },
    async ({ id }) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'DELETE',
        endpoint: '/hr/departments/delete',
        data: { company_id: companyId, user_id: userId, id },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'get_departments_by_branch',
    {
      title: 'Get Departments by Branch',
      description: 'Get departments for a branch.',
      inputSchema: {
        branch_id: z.number().describe('Branch ID'),
      },
    },
    async ({ branch_id }) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/hr/departments/by-branch',
        data: { company_id: companyId, user_id: userId, branch_id },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // ============================================
  // TEAMS
  // ============================================

  registerTool(
    'list_teams',
    {
      title: 'List Teams',
      description: 'Get all teams. Filter by department_id optional.',
      inputSchema: {
        department_id: z.number().optional().describe('Filter by department'),
      },
    },
    async ({ department_id }) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/hr/teams/list',
        data: { company_id: companyId, department_id },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'get_team',
    {
      title: 'Get Team',
      description: 'Get team details.',
      inputSchema: {
        id: z.number().describe('Team ID'),
      },
    },
    async ({ id }) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/hr/teams/show',
        data: { company_id: companyId, id },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'create_team',
    {
      title: 'Create Team',
      description: 'Create a team.',
      inputSchema: {
        name: z.string().describe('Team name'),
        description: z.string().optional().describe('Description'),
        department_id: z.number().optional().describe('Department ID'),
        is_active: z.boolean().optional().describe('Is active'),
      },
    },
    async (input) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/hr/teams/store',
        data: { 
          company_id: companyId, 
          ...input,
          is_active: true,
        },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'get_team_statistics',
    {
      title: 'Get Team Statistics',
      description: 'Get team statistics.',
      inputSchema: {},
    },
    async () => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/hr/teams/statistics',
        data: { company_id: companyId },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'get_teams_by_department',
    {
      title: 'Get Teams by Department',
      description: 'Get teams in a department.',
      inputSchema: {
        department_id: z.number().describe('Department ID'),
      },
    },
    async ({ department_id }) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/hr/teams/by-department',
        data: { company_id: companyId, department_id },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'update_team',
    {
      title: 'Update Team',
      description: 'Update a team.',
      inputSchema: {
        id: z.number().describe('Team ID'),
        name: z.string().optional().describe('Team name'),
        description: z.string().optional().describe('Description'),
        department_id: z.number().optional().describe('Department ID'),
        is_active: z.boolean().optional().describe('Is active'),
      },
    },
    async (input) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'PUT',
        endpoint: '/hr/teams/update',
        data: { company_id: companyId, user_id: userId, ...input },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'delete_team',
    {
      title: 'Delete Team',
      description: 'Delete a team.',
      inputSchema: {
        id: z.number().describe('Team ID'),
      },
    },
    async ({ id }) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'DELETE',
        endpoint: '/hr/teams/delete',
        data: { company_id: companyId, user_id: userId, id },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'assign_team_members',
    {
      title: 'Assign Team Members',
      description: 'Assign members to a team.',
      inputSchema: {
        team_id: z.number().describe('Team ID'),
        member_ids: z.array(z.number()).describe('Array of team member IDs'),
      },
    },
    async ({ team_id, member_ids }) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/hr/teams/assign-members',
        data: { company_id: companyId, user_id: userId, team_id, member_ids },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'remove_team_members',
    {
      title: 'Remove Team Members',
      description: 'Remove members from a team.',
      inputSchema: {
        team_id: z.number().describe('Team ID'),
        member_ids: z.array(z.number()).describe('Array of team member IDs'),
      },
    },
    async ({ team_id, member_ids }) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/hr/teams/remove-members',
        data: { company_id: companyId, user_id: userId, team_id, member_ids },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // ============================================
  // TEAM MEMBERS
  // ============================================

  registerTool(
    'list_team_members',
    {
      title: 'List Team Members',
      description: 'Get all team members. Note: For dropdown values (like owner/team member IDs), use get_app_filters instead as it contains most dropdown values.',
      inputSchema: {},
    },
    async () => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/hr/team-members/list',
        data: { company_id: companyId, user_id: userId },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'get_team_members_dropdown',
    {
      title: 'Get Team Members Dropdown',
      description: 'Get team members for dropdown.',
      inputSchema: {},
    },
    async () => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/hr/team-members/dropdown-list',
        data: { company_id: companyId },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'get_team_member',
    {
      title: 'Get Team Member',
      description: 'Get team member details.',
      inputSchema: {
        id: z.number().describe('Team member ID'),
      },
    },
    async ({ id }) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/hr/team-members/show',
        data: { company_id: companyId, id },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'get_hr_statistics',
    {
      title: 'Get HR Statistics',
      description: 'Get HR statistics.',
      inputSchema: {},
    },
    async () => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/hr/statistics',
        data: { company_id: companyId },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'create_team_member',
    {
      title: 'Create Team Member',
      description: 'Create a team member.',
      inputSchema: {
        user_id: z.number().describe('User ID'),
        team_id: z.number().optional().describe('Team ID'),
        department_id: z.number().optional().describe('Department ID'),
        role: z.string().optional().describe('Role'),
        is_active: z.boolean().optional().describe('Is active'),
      },
    },
    async (input) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/hr/team-members/store',
        data: { 
          company_id: companyId, 
          user_id: userId, 
          ...input,
          is_active: true,
        },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'update_team_member',
    {
      title: 'Update Team Member',
      description: 'Update a team member.',
      inputSchema: {
        id: z.number().describe('Team member ID'),
        team_id: z.number().optional().describe('Team ID'),
        department_id: z.number().optional().describe('Department ID'),
        role: z.string().optional().describe('Role'),
        is_active: z.boolean().optional().describe('Is active'),
      },
    },
    async (input) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'PUT',
        endpoint: '/hr/team-members/update',
        data: { company_id: companyId, user_id: userId, ...input },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'delete_team_member',
    {
      title: 'Delete Team Member',
      description: 'Delete a team member.',
      inputSchema: {
        id: z.number().describe('Team member ID'),
      },
    },
    async ({ id }) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'DELETE',
        endpoint: '/hr/team-members/delete',
        data: { company_id: companyId, user_id: userId, id },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
