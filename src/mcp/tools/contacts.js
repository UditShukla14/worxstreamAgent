/**
 * Contacts Tools - MCP Tool Definitions
 * Contacts are CRM entities used for lead management (separate from customers)
 */

import { z } from 'zod';
import { registerTool } from '../server.js';
import { callWorxstreamAPI } from '../../services/httpClient.js';
import { getWorxstreamContext } from '../../config/index.js';

export function registerContactTools() {
  // List contacts
  registerTool(
    'list_contacts',
    {
      title: 'List Contacts',
      description: 'Get all contacts (CRM contacts, not customers). Contacts are CRM entities used for lead management. Can filter by contact_type ("contact" or "company") and search. Use list_customers for customer records instead.',
      inputSchema: {
        contact_type: z.string().optional().describe('"contact" or "company"'),
        search: z.string().optional().describe('Search term'),
        take: z.number().optional().describe('Number of results'),
        page: z.number().optional().describe('Page number'),
      },
    },
    async ({ contact_type, search, take = 100, page = 1 }) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/master/contact/contact-list',
        data: {
          company_id: companyId,
          user_id: userId,
          contact_type: contact_type || 'contact',
          take,
          page,
          filter: { search: search || '' },
        },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Get contact details
  registerTool(
    'get_contact_details',
    {
      title: 'Get Contact Details',
      description: 'Get contact details (CRM contact, not customer). Contacts are CRM entities. Use get_customer_details for customer records instead.',
      inputSchema: {
        id: z.number().describe('Contact ID'),
      },
    },
    async ({ id }) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/master/contact/contact-details',
        data: { company_id: companyId, user_id: userId, id },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Create contact
  registerTool(
    'create_contact',
    {
      title: 'Create Contact',
      description: 'Create a new CRM contact. For dropdown values (owner/team member ID, lifecycle_stage_id, status), use get_app_filters with the contact app_id - it contains all dropdown values including team members, lifecycle stages, and statuses.',
      inputSchema: {
        contact_type: z.string().optional().describe('"contact" or "company" (default: "contact")'),
        first_name: z.string().describe('First name'),
        last_name: z.string().describe('Last name'),
        display_name: z.string().optional().describe('Display name'),
        company_name: z.string().optional().describe('Company name'),
        email: z.string().email().describe('Email'),
        phone_country_code: z.string().optional().describe('Country code (e.g., "+1", "+91")'),
        phone_number: z.string().optional().describe('Phone number'),
        tags: z.array(z.string()).optional().describe('Tags (array of strings)'),
        owner: z.number().nullable().describe('Owner/team member ID (required, use team member tools to get ID)'),
        job_name: z.string().optional().describe('Job title'),
        lifecycle_stage_id: z.string().optional().describe('Lifecycle stage ID'),
        status: z.string().nullable().optional().describe('Status'),
        time_zone: z.string().optional().describe('Time zone'),
      },
    },
    async (input) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/master/contact/create-contact',
        data: {
          company_id: companyId,
          user_id: userId,
          contact_type: input.contact_type || 'contact',
          first_name: input.first_name,
          last_name: input.last_name,
          display_name: input.display_name || `${input.first_name} ${input.last_name}`,
          company_name: input.company_name || '',
          email: input.email,
          phone_country_code: input.phone_country_code || '+1',
          phone_number: input.phone_number || '',
          tags: Array.isArray(input.tags) ? input.tags : [],
          owner: input.owner,
          job_name: input.job_name || '',
          lifecycle_stage_id: input.lifecycle_stage_id || null,
          status: input.status || null,
          is_active: true,
          time_zone: input.time_zone || '',
        },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Update contact
  registerTool(
    'update_contact',
    {
      title: 'Update Contact',
      description: 'Update a CRM contact with multiple fields. For updating a single field/attribute, use quick_update_contact instead.',
      inputSchema: {
        id: z.number().describe('Contact ID'),
        first_name: z.string().optional().describe('First name'),
        last_name: z.string().optional().describe('Last name'),
        display_name: z.string().optional().describe('Display name'),
        email: z.string().email().optional().describe('Email'),
        phone_number: z.string().optional().describe('Phone'),
        phone_country_code: z.string().optional().describe('Country code'),
        tags: z.array(z.string()).optional().describe('Tags'),
        owner: z.number().nullable().optional().describe('Owner/team member ID'),
        job_name: z.string().optional().describe('Job title'),
        lifecycle_stage_id: z.string().optional().describe('Lifecycle stage ID'),
        status: z.string().nullable().optional().describe('Status'),
        time_zone: z.string().optional().describe('Time zone'),
      },
    },
    async (input) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'PUT',
        endpoint: '/master/contact/update-contact',
        data: { 
          company_id: companyId, 
          user_id: userId, 
          ...input,
          tags: input.tags !== undefined ? (Array.isArray(input.tags) ? input.tags : []) : undefined,
        },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Delete contact
  registerTool(
    'delete_contact',
    {
      title: 'Delete Contact',
      description: 'Delete a CRM contact.',
      inputSchema: {
        id: z.number().describe('Contact ID'),
      },
    },
    async ({ id }) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'DELETE',
        endpoint: '/master/contact/delete-contact',
        data: { company_id: companyId, user_id: userId, id },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Clone contact
  registerTool(
    'clone_contact',
    {
      title: 'Clone Contact',
      description: 'Clone/duplicate a CRM contact.',
      inputSchema: {
        id: z.number().describe('Contact ID to clone'),
      },
    },
    async ({ id }) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/master/contact/clone-contact',
        data: { company_id: companyId, user_id: userId, id },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Quick update contact
  registerTool(
    'quick_update_contact',
    {
      title: 'Quick Update Contact',
      description: 'Quick update a SINGLE attribute/field of a contact. Use this when updating only one field (e.g., email, phone, status). For multiple field updates, use update_contact instead.',
      inputSchema: {
        id: z.number().describe('Contact ID'),
        db_attribute: z.string().describe('Database attribute name (e.g., "first_name", "email")'),
        value: z.union([z.string(), z.number(), z.boolean()]).describe('New value'),
      },
    },
    async (input) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/master/contact/quick-update-contact',
        data: { company_id: companyId, user_id: userId, ...input },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}

