/**
 * Workflows Tools - MCP Tool Definitions
 */

import { z } from 'zod';
import { registerTool } from '../server.js';
import { callWorxstreamAPI } from '../../services/httpClient.js';
import { getWorxstreamContext } from '../../config/index.js';

export function registerWorkflowTools() {

  // Get initial workflow data
  registerTool(
    'get_workflow_initial_data',
    {
      title: 'Get Workflow Initial Data',
      description: 'Get initial data for workflows (dropdowns, options, etc.).',
      inputSchema: {},
    },
    async () => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/workflow/initial-data',
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

  // List workflows
  registerTool(
    'list_workflows',
    {
      title: 'List Workflows',
      description: 'Get all workflows. Can filter by workflow_type and status.',
      inputSchema: {
        workflow_type: z.string().optional().describe('Workflow type: "convert", "copy", "release"'),
        status: z.string().optional().describe('Status: "active", "completed", "cancelled"'),
        per_page: z.number().optional().describe('Results per page (default: 15)'),
      },
    },
    async ({ workflow_type, status, per_page = 15 }) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/workflow/list',
        data: {
          company_id: companyId,
          user_id: userId,
          workflow_type: workflow_type || null,
          status: status || null,
          per_page,
        },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Get workflows by object
  registerTool(
    'get_workflows_by_object',
    {
      title: 'Get Workflows by Object',
      description: 'Get workflows for a specific object (as parent or child).',
      inputSchema: {
        object_id: z.number().describe('Object ID'),
        role: z.string().describe('Role: "parent" or "child"'),
        workflow_type: z.string().optional().describe('Workflow type: "convert", "copy", "release"'),
        status: z.string().optional().describe('Status: "active", "completed", "cancelled"'),
        per_page: z.number().optional().describe('Results per page (default: 15)'),
      },
    },
    async ({ object_id, role, workflow_type, status, per_page = 15 }) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/workflow/by-object',
        data: {
          company_id: companyId,
          user_id: userId,
          object_id,
          role,
          workflow_type: workflow_type || null,
          status: status || null,
          per_page,
        },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Get object tree
  registerTool(
    'get_workflow_object_tree',
    {
      title: 'Get Workflow Object Tree',
      description: 'Get the workflow tree/hierarchy for an object.',
      inputSchema: {
        object_id: z.number().describe('Object ID'),
        app_name: z.string().describe('App name (e.g., "estimate", "invoice", "job")'),
      },
    },
    async ({ object_id, app_name }) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/workflow/object-tree',
        data: {
          company_id: companyId,
          user_id: userId,
          object_id,
          app_name,
        },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Link existing nodes
  registerTool(
    'link_workflow_nodes',
    {
      title: 'Link Workflow Nodes',
      description: 'Link an existing parent object to an existing child object in a workflow.',
      inputSchema: {
        parent_object_id: z.number().describe('Parent object ID'),
        parent_app_name: z.string().describe('Parent app name (e.g., "job", "estimate")'),
        child_object_id: z.number().describe('Child object ID'),
        child_app_name: z.string().describe('Child app name (e.g., "estimate", "invoice")'),
        workflow_type: z.string().optional().describe('Workflow type: "convert", "copy", "release"'),
        reason: z.string().optional().describe('Reason for linking'),
      },
    },
    async ({ parent_object_id, parent_app_name, child_object_id, child_app_name, workflow_type, reason }) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/workflow/link-existing-nodes',
        data: {
          company_id: companyId,
          user_id: userId,
          parent_object_id,
          parent_app_name,
          child_object_id,
          child_app_name,
          workflow_type: workflow_type || null,
          reason: reason || null,
        },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Create new workflow node (convert/copy/release)
  registerTool(
    'create_workflow_node',
    {
      title: 'Create Workflow Node',
      description: 'Create a new workflow by converting/copying/releasing from a parent object to a child object.',
      inputSchema: {
        parent_object_id: z.number().describe('Parent object ID'),
        parent_app_name: z.string().describe('Parent app name (e.g., "estimate", "invoice")'),
        workflow_type: z.string().describe('Workflow type: "convert", "copy", or "release"'),
        child_app_name: z.string().describe('Child app name (e.g., "invoice", "estimate")'),
        reason: z.string().optional().describe('Reason for creating workflow'),
        custom_number: z.string().optional().describe('Custom number for child object'),
        status_id: z.string().optional().describe('Status ID for child object'),
        issue_date: z.string().optional().describe('Issue date (YYYY-MM-DD)'),
        due_date: z.string().optional().describe('Due date (YYYY-MM-DD)'),
        copy_item_ids: z.array(z.number()).optional().describe('Item IDs to copy (for release workflow)'),
      },
    },
    async (input) => {
      const settings = {};
      if (input.copy_item_ids && input.copy_item_ids.length > 0) {
        settings.copy_item_ids = input.copy_item_ids;
      }
      if (input.custom_number) {
        settings.custom_number = input.custom_number;
      }
      if (input.status_id) {
        settings.status_id = input.status_id;
      }
      if (input.issue_date) {
        settings.issue_date = input.issue_date;
      }
      if (input.due_date) {
        settings.due_date = input.due_date;
      }

      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/workflow/create-new-node',
        data: {
          company_id: companyId,
          user_id: userId,
          parent_object_id: input.parent_object_id,
          parent_app_name: input.parent_app_name,
          workflow_type: input.workflow_type,
          child_app_name: input.child_app_name,
          reason: input.reason || null,
          settings: Object.keys(settings).length > 0 ? settings : null,
        },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Update workflow status
  registerTool(
    'update_workflow',
    {
      title: 'Update Workflow',
      description: 'Update workflow status (active, completed, cancelled).',
      inputSchema: {
        workflow_id: z.number().describe('Workflow ID'),
        status: z.string().describe('Status: "active", "completed", or "cancelled"'),
        notes: z.string().optional().describe('Notes'),
      },
    },
    async ({ workflow_id, status, notes }) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'PUT',
        endpoint: '/workflow/update',
        data: {
          company_id: companyId,
          user_id: userId,
          workflow_id,
          status,
          notes: notes || null,
        },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Cancel workflow
  registerTool(
    'cancel_workflow',
    {
      title: 'Cancel Workflow',
      description: 'Cancel a workflow.',
      inputSchema: {
        workflow_id: z.number().describe('Workflow ID'),
        notes: z.string().optional().describe('Cancellation notes'),
      },
    },
    async ({ workflow_id, notes }) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'PUT',
        endpoint: '/workflow/cancel',
        data: {
          company_id: companyId,
          user_id: userId,
          workflow_id,
          notes: notes || null,
        },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
