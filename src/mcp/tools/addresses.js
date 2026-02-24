/**
 * Address Tools - MCP Tool Definitions
 * Addresses are used across multiple entities (customers, vendors, team members, etc.)
 */

import { z } from 'zod';
import { registerTool } from '../server.js';
import { callWorxstreamAPI } from '../../services/httpClient.js';
import { getWorxstreamContext } from '../../config/index.js';

export function registerAddressTools() {
  // ============================================
  // ADDRESSES
  // ============================================

  // Get addresses initial data
  registerTool(
    'get_addresses_initial_data',
    {
      title: 'Get Addresses Initial Data',
      description: 'Get initial data for addresses.',
      inputSchema: {},
    },
    async () => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/addresses/initial-data',
        data: { company_id: companyId, user_id: userId },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // List addresses
  registerTool(
    'list_addresses',
    {
      title: 'List Addresses',
      description: 'List all addresses.',
      inputSchema: {},
    },
    async () => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/addresses/list',
        data: { company_id: companyId, user_id: userId },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Create address
  registerTool(
    'create_address',
    {
      title: 'Create Address',
      description: 'Create a new address.',
      inputSchema: {
        app_id: z.number().optional().describe('App ID'),
        entity_type: z.string().describe('Entity type (e.g., "customer", "team_member", "vendor")'),
        entity_id: z.number().describe('Entity ID'),
        address_type: z.string().describe('Address type (e.g., "home", "billing", "shipping")'),
        street_address: z.string().describe('Street address'),
        city: z.string().describe('City'),
        state: z.string().describe('State'),
        postal_code: z.string().describe('Postal code'),
        country: z.string().describe('Country'),
        is_primary: z.boolean().optional().describe('Is primary address'),
        status: z.string().optional().describe('Status'),
      },
    },
    async (input) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/addresses/store',
        data: { company_id: companyId, user_id: userId, ...input },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Get address
  registerTool(
    'get_address',
    {
      title: 'Get Address',
      description: 'Get address details.',
      inputSchema: {
        id: z.number().describe('Address ID'),
      },
    },
    async ({ id }) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/addresses/show',
        data: { company_id: companyId, user_id: userId, id },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Update address
  registerTool(
    'update_address',
    {
      title: 'Update Address',
      description: 'Update an address.',
      inputSchema: {
        id: z.number().describe('Address ID'),
        entity_type: z.string().optional().describe('Entity type'),
        entity_id: z.number().optional().describe('Entity ID'),
        address_type: z.string().optional().describe('Address type'),
        street_address: z.string().optional().describe('Street address'),
        city: z.string().optional().describe('City'),
        state: z.string().optional().describe('State'),
        postal_code: z.string().optional().describe('Postal code'),
        country: z.string().optional().describe('Country'),
        is_primary: z.boolean().optional().describe('Is primary address'),
        status: z.string().optional().describe('Status'),
      },
    },
    async (input) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'PUT',
        endpoint: '/addresses/update',
        data: { company_id: companyId, user_id: userId, ...input },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Delete address
  registerTool(
    'delete_address',
    {
      title: 'Delete Address',
      description: 'Delete an address.',
      inputSchema: {
        id: z.number().describe('Address ID'),
      },
    },
    async ({ id }) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'DELETE',
        endpoint: '/addresses/delete',
        data: { company_id: companyId, user_id: userId, id },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // ============================================
  // ADDRESS EXEMPTIONS
  // ============================================

  // List exemptions
  registerTool(
    'list_address_exemptions',
    {
      title: 'List Address Exemptions',
      description: 'List tax exemptions for an address.',
      inputSchema: {
        address_id: z.number().describe('Address ID'),
        status: z.string().optional().describe('Status filter (e.g., "active")'),
      },
    },
    async ({ address_id, status }) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/addresses/exemptions/list',
        data: { company_id: companyId, user_id: userId, address_id, status },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Create exemption
  registerTool(
    'create_address_exemption',
    {
      title: 'Create Address Exemption',
      description: 'Create a tax exemption for an address.',
      inputSchema: {
        address_id: z.number().describe('Address ID'),
        has_exemption: z.boolean().describe('Has exemption'),
        exemption_certificate_no: z.string().optional().describe('Exemption certificate number'),
        exemption_type: z.string().optional().describe('Exemption type (e.g., "TAX")'),
        exemption_percentage: z.number().optional().describe('Exemption percentage'),
        exemption_valid_from: z.string().optional().describe('Valid from date (YYYY-MM-DD)'),
        exemption_valid_to: z.string().optional().describe('Valid to date (YYYY-MM-DD)'),
        status: z.string().optional().describe('Status'),
      },
    },
    async (input) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/addresses/exemptions/store',
        data: { company_id: companyId, user_id: userId, ...input },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Get exemption
  registerTool(
    'get_address_exemption',
    {
      title: 'Get Address Exemption',
      description: 'Get exemption details.',
      inputSchema: {
        id: z.number().describe('Exemption ID'),
      },
    },
    async ({ id }) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/addresses/exemptions/show',
        data: { company_id: companyId, user_id: userId, id },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Update exemption
  registerTool(
    'update_address_exemption',
    {
      title: 'Update Address Exemption',
      description: 'Update an address exemption.',
      inputSchema: {
        id: z.number().describe('Exemption ID'),
        address_id: z.number().optional().describe('Address ID'),
        has_exemption: z.boolean().optional().describe('Has exemption'),
        exemption_certificate_no: z.string().optional().describe('Exemption certificate number'),
        exemption_type: z.string().optional().describe('Exemption type'),
        exemption_percentage: z.number().optional().describe('Exemption percentage'),
        exemption_valid_from: z.string().optional().describe('Valid from date'),
        exemption_valid_to: z.string().optional().describe('Valid to date'),
        status: z.string().optional().describe('Status'),
      },
    },
    async (input) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'PUT',
        endpoint: '/addresses/exemptions/update',
        data: { company_id: companyId, user_id: userId, ...input },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Delete exemption
  registerTool(
    'delete_address_exemption',
    {
      title: 'Delete Address Exemption',
      description: 'Delete an address exemption.',
      inputSchema: {
        id: z.number().describe('Exemption ID'),
      },
    },
    async ({ id }) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'DELETE',
        endpoint: '/addresses/exemptions/delete',
        data: { company_id: companyId, user_id: userId, id },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Get last active valid exemption
  registerTool(
    'get_last_active_valid_exemption',
    {
      title: 'Get Last Active Valid Exemption',
      description: 'Get the last active valid exemption for an address.',
      inputSchema: {
        address_id: z.number().describe('Address ID'),
      },
    },
    async ({ address_id }) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/addresses/exemptions/last-active-valid-exemption',
        data: { company_id: companyId, user_id: userId, address_id },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}

