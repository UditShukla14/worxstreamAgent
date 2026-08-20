/**
 * Communications Tools — in-app notifications and master-object email
 */

import { z } from 'zod';
import { registerTool } from '../server.js';
import { callWorxstreamAPI } from '../../services/httpClient.js';
import { getWorxstreamContext } from '../../config/index.js';

function asText(result) {
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}

export function registerCommunicationsTools() {
  registerTool(
    'list_notifications',
    {
      title: 'List Notifications',
      description: 'List in-app notifications for the current user.',
      inputSchema: {
        unread_only: z.boolean().optional().describe('Only unread (default: false)'),
        page: z.number().optional().describe('Page number (default: 1)'),
        per_page: z.number().optional().describe('Results per page (default: 20)'),
      },
    },
    async ({ unread_only = false, page = 1, per_page = 20 } = {}) => {
      const { companyId, userId } = getWorxstreamContext();
      return asText(await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/notifications/list',
        data: {
          user_id: userId,
          company_id: companyId,
          unread_only: unread_only ?? false,
          per_page: per_page ?? 20,
          page: page ?? 1,
        },
      }));
    }
  );

  registerTool(
    'mark_notification_read',
    {
      title: 'Mark Notification Read',
      description: 'Mark one notification as read.',
      inputSchema: {
        id: z.union([z.string(), z.number()]).describe('Notification ID'),
      },
    },
    async ({ id }) => {
      const { companyId, userId } = getWorxstreamContext();
      return asText(await callWorxstreamAPI({
        method: 'PATCH',
        endpoint: '/notifications/read',
        data: { user_id: userId, company_id: companyId, id },
      }));
    }
  );

  registerTool(
    'send_object_email',
    {
      title: 'Send Object Email',
      description: 'Email a master object (estimate, invoice, sales order) to recipients. Confirm recipients and subject with the user before sending.',
      inputSchema: {
        object_id: z.number().describe('Master object ID'),
        mail_to: z.array(z.string()).min(1).describe('To email addresses'),
        mail_cc: z.array(z.string()).optional().describe('CC email addresses'),
        subject: z.string().describe('Email subject'),
        body: z.string().describe('Email body (HTML or text)'),
        include_pdf: z.boolean().optional().describe('Attach PDF (default: true)'),
        add_accept_reject_option: z.boolean().optional().describe('Include accept/reject links (default: false)'),
      },
    },
    async (input) => {
      const { companyId, userId } = getWorxstreamContext();
      return asText(await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/master-objects/email/send',
        data: {
          company_id: companyId,
          user_id: userId,
          object_id: input.object_id,
          mail_to: input.mail_to,
          mail_cc: input.mail_cc,
          subject: input.subject,
          body: input.body,
          include_pdf: input.include_pdf ?? true,
          add_accept_reject_option: input.add_accept_reject_option ?? false,
        },
      }));
    }
  );

  registerTool(
    'list_email_outbox',
    {
      title: 'List Email Outbox',
      description: 'List sent/queued master-object emails.',
      inputSchema: {
        status: z.string().optional().describe('queued, processing, sent, failed, skipped'),
        related_type: z.string().optional().describe('Related object type'),
        related_id: z.number().optional().describe('Related object ID'),
        search: z.string().optional().describe('Search subject or recipient'),
        date_from: z.string().optional().describe('From date YYYY-MM-DD'),
        date_to: z.string().optional().describe('To date YYYY-MM-DD'),
        page: z.number().optional().describe('Page number (default: 1)'),
        per_page: z.number().optional().describe('Results per page (default: 15)'),
      },
    },
    async ({ status, related_type, related_id, search, date_from, date_to, page = 1, per_page = 15 } = {}) => {
      const { companyId, userId } = getWorxstreamContext();
      const data = {
        company_id: companyId,
        user_id: userId,
        page: page ?? 1,
        per_page: per_page ?? 15,
      };
      if (status) data.status = status;
      if (related_type?.trim()) data.related_type = related_type.trim();
      if (related_id != null) data.related_id = related_id;
      if (search?.trim()) data.search = search.trim();
      if (date_from) data.date_from = date_from;
      if (date_to) data.date_to = date_to;
      return asText(await callWorxstreamAPI({ method: 'GET', endpoint: '/company/email-outbox/list', data }));
    }
  );
}
