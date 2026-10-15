/**
 * Communications Tools — in-app notifications and master-object email
 */

import { z } from 'zod';
import { registerTool } from '../server.js';
import { callWorxstreamAPI } from '../../services/httpClient.js';
import { config, getWorxstreamContext } from '../../config/index.js';

function asText(result) {
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}

/**
 * Company public email code for free-form sends
 * (POST /api/public/company/email/{code}/send — no object_id).
 */
function resolvePublicEmailCode() {
  return String(
    process.env.WORXSTREAM_PUBLIC_EMAIL_CODE
    || process.env.PUBLIC_EMAIL_CODE
    || process.env.PUBLIC_LIVEKIT_CODE
    || '',
  ).trim();
}

async function sendPublicCompanyEmail({ mailTo, mailCc, subject, body }) {
  const code = resolvePublicEmailCode();
  if (!code) {
    return {
      success: false,
      error:
        'Free-form email needs WORXSTREAM_PUBLIC_EMAIL_CODE (or PUBLIC_EMAIL_CODE). '
        + 'This is the company public code used by POST /api/public/company/email/{code}/send.',
    };
  }
  const base = String(config.worxstream.baseUrl || '').replace(/\/+$/, '');
  if (!base) {
    return { success: false, error: 'WORXSTREAM_BASE_URL is not configured' };
  }
  const apiBase = base.endsWith('/api') ? base : `${base}/api`;
  const url = `${apiBase}/public/company/email/${encodeURIComponent(code)}/send`;
  const payload = {
    mail_to: mailTo,
    subject,
    body,
  };
  if (Array.isArray(mailCc) && mailCc.length > 0) payload.mail_cc = mailCc;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let parsed = {};
  if (text.trim()) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { message: text.slice(0, 500) };
    }
  }
  if (!response.ok || parsed?.success === false) {
    return {
      success: false,
      error: parsed?.message || parsed?.error || `HTTP ${response.status}`,
      data: parsed?.data,
    };
  }
  return {
    success: true,
    message: parsed?.message || 'Email queued successfully',
    data: parsed?.data ?? parsed,
  };
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
    'send_email',
    {
      title: 'Send Email',
      description:
        'Send a free-form HTML/text email (summaries, alerts, schedules) with no master-object PDF. '
        + 'Uses POST /api/public/company/email/{code}/send (same company public mail path as Worxstream). '
        + 'Requires WORXSTREAM_PUBLIC_EMAIL_CODE (or PUBLIC_EMAIL_CODE). Does not need object_id. '
        + 'For estimate/invoice PDF emails use send_object_email instead. '
        + 'Confirm recipients/subject in chat; Scribe scheduled messages also call this tool.',
      inputSchema: {
        mail_to: z.array(z.string()).min(1).describe('To email addresses'),
        mail_cc: z.array(z.string()).optional().describe('CC email addresses'),
        subject: z.string().describe('Email subject'),
        body: z.string().describe('Email body (HTML or text)'),
      },
      capabilities: { domain: 'communications', action: 'create', safety: 'write' },
    },
    async (input) => asText(await sendPublicCompanyEmail({
      mailTo: input.mail_to,
      mailCc: input.mail_cc || [],
      subject: input.subject,
      body: input.body,
    })),
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
