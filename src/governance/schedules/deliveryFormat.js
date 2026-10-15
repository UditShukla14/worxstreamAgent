/**
 * Thin delivery helpers for Nova schedule runs.
 * Nova drafts the email HTML or SMS text. Scribe only unwraps and sends.
 */

/**
 * Instructions so Nova drafts the final message for the channel.
 * Scribe does not rewrite or redesign this content.
 */
export function buildChannelOutputInstructions(channel) {
  if (channel === 'sms') {
    return [
      'YOUR JOB: Draft the final SMS body (plain text only).',
      '- Reply with ONLY the SMS text to send — nothing else.',
      '- No HTML, markdown tables, code fences, tool narration, or reasoning.',
      '- Keep it concise (ideally under 600 characters; hard cap ~1200).',
      '- Do not include STOP/opt-out text — the system appends that after you.',
    ].join('\n');
  }

  return [
    'YOUR JOB: Draft the final email body (HTML) for company mail / send_email.',
    '- Reply with ONLY the email HTML to send — nothing else.',
    '- Presentable like a polished chat answer: headings, tables, short prose.',
    '- Use email-safe HTML with inline styles: <div>, <h2>, <p>, <strong>, <ul><li>, <table>, <tr>, <th>, <td>.',
    '- Optional first line: Subject: Your subject here',
    '- No tool narration, chain-of-thought, code fences, <chart>, or <workflow>.',
    '- Prefer report tools with date ranges for accurate totals (not partial list pages).',
  ].join('\n');
}

export function buildScheduledAgentMessage({ name, prompt, channel }) {
  const channelLabel = channel === 'sms' ? 'SMS' : 'email';
  return [
    `[Scheduled run: ${name}]`,
    `Use tools as needed, then draft the final ${channelLabel} message.`,
    'The scheduler will send your draft as-is — do not ask it to format for you.',
    'Do not ask clarifying questions.',
    'Do not call send_email, SMS, or other delivery tools — the scheduler delivers after your reply.',
    'Prefer read-only tools. Avoid creates/updates/deletes unless the request explicitly requires a write.',
    '',
    buildChannelOutputInstructions(channel),
    '',
    'USER REQUEST:',
    prompt,
  ].join('\n');
}

/**
 * Unwrap Nova's draft for delivery. Does not rewrite content into a new template.
 * @returns {{ subject: string|null, body: string }}
 */
export function unwrapNovaDeliveryDraft(text, channel = 'email') {
  let raw = String(text || '').trim();
  if (!raw) return { subject: null, body: '' };

  // Optional fenced draft: ```html / ```email / ```sms
  const fenceRe = channel === 'sms'
    ? /```(?:sms|text|plain)?\s*([\s\S]*?)```/i
    : /```(?:html|email|htm)?\s*([\s\S]*?)```/i;
  const fenced = raw.match(fenceRe);
  if (fenced?.[1]?.trim()) raw = fenced[1].trim();

  let subject = null;
  if (channel !== 'sms') {
    const subjectLine = raw.match(/^Subject:\s*(.+)\s*\n+/i);
    if (subjectLine) {
      subject = subjectLine[1].trim();
      raw = raw.slice(subjectLine[0].length).trim();
    }
  }

  if (channel === 'sms') {
    let body = raw
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/(h[1-6]|div|li|td|th|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
    if (body.length > 1400) body = `${body.slice(0, 1397)}...`;
    return { subject: null, body };
  }

  // Email: pass Nova HTML/text through. Only light wrap if there are no tags at all.
  let body = raw
    .replace(/<chart\b[\s\S]*?<\/chart>/gi, '')
    .replace(/<workflow\b[\s\S]*?<\/workflow>/gi, '')
    .replace(/<milestones\b[\s\S]*?<\/milestones>/gi, '')
    .replace(/<!--AGENT_BLK_\d+-->/g, '')
    .trim();

  if (body && !/<[a-z][\s\S]*>/i.test(body)) {
    body = `<div style="font-family:system-ui,-apple-system,sans-serif;color:#222;line-height:1.5;">${
      body.split(/\n+/).map((line) => `<p style="margin:0 0 10px;">${escapeHtml(line)}</p>`).join('')
    }</div>`;
  }

  return { subject, body };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** @deprecated use unwrapNovaDeliveryDraft — kept for older imports/tests */
export function formatNovaResponseForDelivery(text, channel = 'email') {
  return unwrapNovaDeliveryDraft(text, channel).body;
}
