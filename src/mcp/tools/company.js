/**
 * Company/Organization Tools - MCP Tool Definitions
 */

import { z } from 'zod';
import { registerTool } from '../server.js';
import { callWorxstreamAPI } from '../../services/httpClient.js';
import { config } from '../../config/index.js';

export function registerCompanyTools() {
  const companyId = config.worxstream.defaultCompanyId;
  const userId = config.worxstream.defaultUserId;

  // Get company details
  registerTool(
    'get_company_details',
    {
      title: 'Get Company Details',
      description: 'Get company/organization details.',
      inputSchema: {},
    },
    async () => {
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/company/show',
        data: { company_id: companyId },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Get company status
  registerTool(
    'get_company_status',
    {
      title: 'Get Company Status',
      description: 'Get company status.',
      inputSchema: {},
    },
    async () => {
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/company/status',
        data: { company_id: companyId },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Get company statistics
  registerTool(
    'get_company_statistics',
    {
      title: 'Get Company Statistics',
      description: 'Get company statistics and metrics.',
      inputSchema: {},
    },
    async () => {
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/company/statistics',
        data: { company_id: companyId },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Get company initial data
  registerTool(
    'get_company_initial_data',
    {
      title: 'Get Company Initial Data',
      description: 'Get initial setup data for company.',
      inputSchema: {},
    },
    async () => {
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/company/initial-data',
        data: { company_id: companyId },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // List branches
  registerTool(
    'list_branches',
    {
      title: 'List Branches',
      description: 'Get all company branches/locations.',
      inputSchema: {},
    },
    async () => {
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/branches/list',
        data: { company_id: companyId },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Create branch
  registerTool(
    'create_branch',
    {
      title: 'Create Branch',
      description: 'Create a new branch.',
      inputSchema: {
        name: z.string().describe('Branch name'),
        address: z.string().optional().describe('Address'),
        city: z.string().optional().describe('City'),
        state: z.string().optional().describe('State'),
        country: z.string().optional().describe('Country'),
        phone: z.string().optional().describe('Phone'),
        is_active: z.boolean().optional().describe('Is active'),
      },
    },
    async (input) => {
      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/branches/store',
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

  // Update branch
  registerTool(
    'update_branch',
    {
      title: 'Update Branch',
      description: 'Update a branch.',
      inputSchema: {
        id: z.number().describe('Branch ID'),
        name: z.string().optional().describe('Branch name'),
        address: z.string().optional().describe('Address'),
      },
    },
    async (input) => {
      const result = await callWorxstreamAPI({
        method: 'PUT',
        endpoint: '/branches/update',
        data: { company_id: companyId, ...input },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Delete branch
  registerTool(
    'delete_branch',
    {
      title: 'Delete Branch',
      description: 'Delete a branch.',
      inputSchema: {
        id: z.number().describe('Branch ID'),
      },
    },
    async ({ id }) => {
      const result = await callWorxstreamAPI({
        method: 'DELETE',
        endpoint: '/branches/delete',
        data: { company_id: companyId, id },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // ============================================
  // COMPANY SETUP
  // ============================================

  // Setup database
  registerTool(
    'company_setup_database',
    {
      title: 'Company Setup Database',
      description: 'Setup database for company.',
      inputSchema: {},
    },
    async () => {
      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/company/setup-database',
        data: { company_id: companyId, user_id: userId },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Migrate database
  registerTool(
    'company_migrate_database',
    {
      title: 'Company Migrate Database',
      description: 'Migrate company database.',
      inputSchema: {},
    },
    async () => {
      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/company/migrate-database',
        data: { company_id: companyId, user_id: userId },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Validate database
  registerTool(
    'validate_database',
    {
      title: 'Validate Database',
      description: 'Validate company database structure. Takes ~35s to execute and verify all company tables with their columns.',
      inputSchema: {},
    },
    async () => {
      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/company/validate-database',
        data: { company_id: companyId, user_id: userId },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Delete database - send OTP
  registerTool(
    'company_database_delete_otp',
    {
      title: 'Company Database Delete OTP',
      description: 'Send OTP for database deletion.',
      inputSchema: {},
    },
    async () => {
      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/company/delete-database/otp',
        data: { company_id: companyId, user_id: userId },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Delete database - verify OTP
  registerTool(
    'company_database_delete_verify',
    {
      title: 'Company Database Delete Verify',
      description: 'Verify OTP and delete database.',
      inputSchema: {
        otp: z.string().describe('OTP code'),
      },
    },
    async ({ otp }) => {
      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/company/delete-database/verify',
        data: { company_id: companyId, user_id: userId, otp },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Update company details
  registerTool(
    'update_company_details',
    {
      title: 'Update Company Details',
      description: 'Update company details.',
      inputSchema: {
        name: z.string().optional().describe('Company name'),
        legal_name: z.string().optional().describe('Legal name'),
        registration_number: z.string().optional().describe('Registration number'),
        tax_id: z.string().optional().describe('Tax ID'),
        industry: z.string().optional().describe('Industry'),
        company_type: z.string().optional().describe('Company type'),
        website: z.string().url().optional().describe('Website'),
        status: z.string().optional().describe('Status'),
        currency: z.string().optional().describe('Currency'),
        time_zone: z.string().optional().describe('Time zone'),
      },
    },
    async (input) => {
      const result = await callWorxstreamAPI({
        method: 'PUT',
        endpoint: '/company/update',
        data: { company_id: companyId, user_id: userId, ...input },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Verify company
  registerTool(
    'verify_company',
    {
      title: 'Verify Company',
      description: 'Verify company.',
      inputSchema: {},
    },
    async () => {
      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/company/verify',
        data: { company_id: companyId, user_id: userId },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Delete company address
  registerTool(
    'delete_company_address',
    {
      title: 'Delete Company Address',
      description: 'Delete a company address.',
      inputSchema: {
        address_id: z.number().describe('Address ID'),
      },
    },
    async ({ address_id }) => {
      const result = await callWorxstreamAPI({
        method: 'DELETE',
        endpoint: '/company/delete-address',
        data: { company_id: companyId, user_id: userId, address_id },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // ============================================
  // CONTACT MANAGEMENT
  // ============================================

  // List contacts (organization contacts, not CRM)
  registerTool(
    'list_organization_contacts',
    {
      title: 'List Organization Contacts',
      description: 'List organization contacts (for branches, company, etc.).',
      inputSchema: {},
    },
    async () => {
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/contacts-management/list',
        data: { company_id: companyId, user_id: userId },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Create organization contact
  registerTool(
    'create_organization_contact',
    {
      title: 'Create Organization Contact',
      description: 'Create an organization contact.',
      inputSchema: {
        entity_type: z.string().describe('Entity type (e.g., "branch", "company")'),
        entity_id: z.number().describe('Entity ID'),
        contact_type: z.string().describe('Contact type (e.g., "email", "phone", "website")'),
        contact_value: z.string().describe('Contact value'),
        contact_label: z.string().optional().describe('Contact label'),
        is_primary: z.boolean().optional().describe('Is primary contact'),
      },
    },
    async (input) => {
      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/contacts-management/store',
        data: { company_id: companyId, user_id: userId, ...input },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Update organization contact
  registerTool(
    'update_organization_contact',
    {
      title: 'Update Organization Contact',
      description: 'Update an organization contact.',
      inputSchema: {
        id: z.number().describe('Contact ID'),
        entity_type: z.string().optional().describe('Entity type'),
        entity_id: z.number().optional().describe('Entity ID'),
        contact_type: z.string().optional().describe('Contact type'),
        contact_value: z.string().optional().describe('Contact value'),
        contact_label: z.string().optional().describe('Contact label'),
        is_primary: z.boolean().optional().describe('Is primary contact'),
      },
    },
    async (input) => {
      const result = await callWorxstreamAPI({
        method: 'PUT',
        endpoint: '/contacts-management/update',
        data: { company_id: companyId, user_id: userId, ...input },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );


  // ============================================
  // CUSTOM NUMBER RANGE
  // ============================================

  // List custom number ranges
  registerTool(
    'list_custom_number_ranges',
    {
      title: 'List Custom Number Ranges',
      description: 'List all custom number ranges.',
      inputSchema: {},
    },
    async () => {
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/custom-number-range/list',
        data: { company_id: companyId, user_id: userId },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Initialize custom number range
  registerTool(
    'initialize_custom_number_range',
    {
      title: 'Initialize Custom Number Range',
      description: 'Initialize a custom number range.',
      inputSchema: {
        app_name: z.string().describe('App name'),
        prefix: z.string().optional().describe('Prefix'),
        starting_number: z.number().optional().describe('Starting number'),
      },
    },
    async (input) => {
      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/custom-number-range/initialize',
        data: { company_id: companyId, user_id: userId, ...input },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Get custom number range
  registerTool(
    'get_custom_number_range',
    {
      title: 'Get Custom Number Range',
      description: 'Get custom number range details.',
      inputSchema: {
        id: z.number().describe('Custom number range ID'),
      },
    },
    async ({ id }) => {
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/custom-number-range/show',
        data: { company_id: companyId, user_id: userId, id },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Create custom number range
  registerTool(
    'create_custom_number_range',
    {
      title: 'Create Custom Number Range',
      description: 'Create a custom number range.',
      inputSchema: {
        app_name: z.string().describe('App name'),
        prefix: z.string().optional().describe('Prefix'),
        starting_number: z.number().optional().describe('Starting number'),
      },
    },
    async (input) => {
      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/custom-number-range/store',
        data: { company_id: companyId, user_id: userId, ...input },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Update custom number range
  registerTool(
    'update_custom_number_range',
    {
      title: 'Update Custom Number Range',
      description: 'Update a custom number range.',
      inputSchema: {
        id: z.number().describe('Custom number range ID'),
        prefix: z.string().optional().describe('Prefix'),
        starting_number: z.number().optional().describe('Starting number'),
      },
    },
    async (input) => {
      const result = await callWorxstreamAPI({
        method: 'PUT',
        endpoint: '/custom-number-range/update',
        data: { company_id: companyId, user_id: userId, ...input },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Soft delete custom number range
  registerTool(
    'soft_delete_custom_number_range',
    {
      title: 'Soft Delete Custom Number Range',
      description: 'Soft delete a custom number range.',
      inputSchema: {
        id: z.number().describe('Custom number range ID'),
      },
    },
    async ({ id }) => {
      const result = await callWorxstreamAPI({
        method: 'DELETE',
        endpoint: '/custom-number-range/soft-delete',
        data: { company_id: companyId, user_id: userId, id },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Restore custom number range
  registerTool(
    'restore_custom_number_range',
    {
      title: 'Restore Custom Number Range',
      description: 'Restore a soft-deleted custom number range.',
      inputSchema: {
        id: z.number().describe('Custom number range ID'),
      },
    },
    async ({ id }) => {
      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/custom-number-range/restore',
        data: { company_id: companyId, user_id: userId, id },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Clone custom number range
  registerTool(
    'clone_custom_number_range',
    {
      title: 'Clone Custom Number Range',
      description: 'Clone a custom number range.',
      inputSchema: {
        id: z.number().describe('Custom number range ID to clone'),
      },
    },
    async ({ id }) => {
      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/custom-number-range/clone',
        data: { company_id: companyId, user_id: userId, id },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Get custom number range hint
  registerTool(
    'get_custom_number_range_hint',
    {
      title: 'Get Custom Number Range Hint',
      description: 'Get hint for custom number range.',
      inputSchema: {
        app_name: z.string().describe('App name'),
      },
    },
    async ({ app_name }) => {
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/custom-number-range/hint',
        data: { company_id: companyId, user_id: userId, app_name },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Check custom number range
  registerTool(
    'check_custom_number_range',
    {
      title: 'Check Custom Number Range',
      description: 'Check custom number range availability.',
      inputSchema: {
        app_name: z.string().describe('App name'),
        prefix: z.string().optional().describe('Prefix'),
      },
    },
    async (input) => {
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/custom-number-range/check',
        data: { company_id: companyId, user_id: userId, ...input },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // ============================================
  // PAYMENT INSTRUCTIONS
  // ============================================

  // List payment instructions
  registerTool(
    'list_payment_instructions',
    {
      title: 'List Payment Instructions',
      description: 'List all payment instructions.',
      inputSchema: {},
    },
    async () => {
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/payment-instructions/list',
        data: { company_id: companyId, user_id: userId },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Get payment instruction
  registerTool(
    'get_payment_instruction',
    {
      title: 'Get Payment Instruction',
      description: 'Get payment instruction details.',
      inputSchema: {
        id: z.number().describe('Payment instruction ID'),
      },
    },
    async ({ id }) => {
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/payment-instructions/show',
        data: { company_id: companyId, user_id: userId, id },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Get formatted payment instruction
  registerTool(
    'get_formatted_payment_instruction',
    {
      title: 'Get Formatted Payment Instruction',
      description: 'Get formatted payment instruction.',
      inputSchema: {
        id: z.number().describe('Payment instruction ID'),
      },
    },
    async ({ id }) => {
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/payment-instructions/formatted',
        data: { company_id: companyId, user_id: userId, id },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Get payment instructions dropdown
  registerTool(
    'get_payment_instructions_dropdown',
    {
      title: 'Get Payment Instructions Dropdown',
      description: 'Get payment instructions for dropdown.',
      inputSchema: {},
    },
    async () => {
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/payment-instructions/dropdown',
        data: { company_id: companyId, user_id: userId },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Create payment instruction
  registerTool(
    'create_payment_instruction',
    {
      title: 'Create Payment Instruction',
      description: 'Create a payment instruction.',
      inputSchema: {
        title: z.string().describe('Title'),
        instructions: z.string().describe('Instructions'),
        is_active: z.boolean().optional().describe('Is active'),
      },
    },
    async (input) => {
      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/payment-instructions/store',
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

  // Clone payment instruction
  registerTool(
    'clone_payment_instruction',
    {
      title: 'Clone Payment Instruction',
      description: 'Clone a payment instruction.',
      inputSchema: {
        id: z.number().describe('Payment instruction ID to clone'),
      },
    },
    async ({ id }) => {
      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/payment-instructions/clone',
        data: { company_id: companyId, user_id: userId, id },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Soft delete payment instruction
  registerTool(
    'soft_delete_payment_instruction',
    {
      title: 'Soft Delete Payment Instruction',
      description: 'Soft delete a payment instruction.',
      inputSchema: {
        id: z.number().describe('Payment instruction ID'),
      },
    },
    async ({ id }) => {
      const result = await callWorxstreamAPI({
        method: 'DELETE',
        endpoint: '/payment-instructions/soft-delete',
        data: { company_id: companyId, user_id: userId, id },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Restore payment instruction
  registerTool(
    'restore_payment_instruction',
    {
      title: 'Restore Payment Instruction',
      description: 'Restore a soft-deleted payment instruction.',
      inputSchema: {
        id: z.number().describe('Payment instruction ID'),
      },
    },
    async ({ id }) => {
      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/payment-instructions/restore',
        data: { company_id: companyId, user_id: userId, id },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Permanently delete payment instruction
  registerTool(
    'permanently_delete_payment_instruction',
    {
      title: 'Permanently Delete Payment Instruction',
      description: 'Permanently delete a payment instruction.',
      inputSchema: {
        id: z.number().describe('Payment instruction ID'),
      },
    },
    async ({ id }) => {
      const result = await callWorxstreamAPI({
        method: 'DELETE',
        endpoint: '/payment-instructions/permanent-delete',
        data: { company_id: companyId, user_id: userId, id },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // ============================================
  // SIGNATURES
  // ============================================

  // List signatures
  registerTool(
    'list_signatures',
    {
      title: 'List Signatures',
      description: 'List all signatures.',
      inputSchema: {},
    },
    async () => {
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/signatures/list',
        data: { company_id: companyId, user_id: userId },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Get signature
  registerTool(
    'get_signature',
    {
      title: 'Get Signature',
      description: 'Get signature details.',
      inputSchema: {
        id: z.number().describe('Signature ID'),
      },
    },
    async ({ id }) => {
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/signatures/show',
        data: { company_id: companyId, user_id: userId, id },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Get signatures dropdown
  registerTool(
    'get_signatures_dropdown',
    {
      title: 'Get Signatures Dropdown',
      description: 'Get signatures for dropdown.',
      inputSchema: {},
    },
    async () => {
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/signatures/dropdown',
        data: { company_id: companyId, user_id: userId },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Create signature
  registerTool(
    'create_signature',
    {
      title: 'Create Signature',
      description: 'Create a signature.',
      inputSchema: {
        title: z.string().describe('Title'),
        signature_data: z.string().describe('Signature data (base64 or URL)'),
        is_active: z.boolean().optional().describe('Is active'),
      },
    },
    async (input) => {
      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/signatures/store',
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

  // Clone signature
  registerTool(
    'clone_signature',
    {
      title: 'Clone Signature',
      description: 'Clone a signature.',
      inputSchema: {
        id: z.number().describe('Signature ID to clone'),
      },
    },
    async ({ id }) => {
      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/signatures/clone',
        data: { company_id: companyId, user_id: userId, id },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Soft delete signature
  registerTool(
    'soft_delete_signature',
    {
      title: 'Soft Delete Signature',
      description: 'Soft delete a signature.',
      inputSchema: {
        id: z.number().describe('Signature ID'),
      },
    },
    async ({ id }) => {
      const result = await callWorxstreamAPI({
        method: 'DELETE',
        endpoint: '/signatures/soft-delete',
        data: { company_id: companyId, user_id: userId, id },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Restore signature
  registerTool(
    'restore_signature',
    {
      title: 'Restore Signature',
      description: 'Restore a soft-deleted signature.',
      inputSchema: {
        id: z.number().describe('Signature ID'),
      },
    },
    async ({ id }) => {
      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/signatures/restore',
        data: { company_id: companyId, user_id: userId, id },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Permanently delete signature
  registerTool(
    'permanently_delete_signature',
    {
      title: 'Permanently Delete Signature',
      description: 'Permanently delete a signature.',
      inputSchema: {
        id: z.number().describe('Signature ID'),
      },
    },
    async ({ id }) => {
      const result = await callWorxstreamAPI({
        method: 'DELETE',
        endpoint: '/signatures/permanent-delete',
        data: { company_id: companyId, user_id: userId, id },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
