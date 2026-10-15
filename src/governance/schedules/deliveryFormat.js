/**
 * Thin delivery helpers for Nova schedule runs.
 *
 * A schedule is the same Nova request as chat, run on a timer.
 * Nova answers normally; Scribe only unwraps and sends.
 */

/**
 * Light channel hint so Nova's reply is sendable. Not a separate product format.
 */
export function buildChannelOutputInstructions(channel) {
  if (channel === 'sms') {
    return [
      'This reply will be sent as SMS (not shown in chat).',
      '- Final answer: plain text only, concise.',
      '- No HTML, code fences, or tool narration.',
      '- Do not include STOP/opt-out — the system appends that.',
    ].join('\n');
  }

  return [
    'This reply will be sent as email (not shown in chat).',
    '- Final answer: email-safe HTML with inline styles (same quality as a polished chat answer).',
    '- First line: Subject: <clear subject including the date when relevant>',
    '- Use real numbers from tools. Prefer generate_*_report JSON (meta.totals / rows) over export_*_csv — exports are binary and useless here.',
    '- No tool narration, chain-of-thought, or code fences in the final reply.',
  ].join('\n');
}

export function buildScheduledAgentMessage({ name, prompt, channel, dateLabel, timeZone } = {}) {
  const when = dateLabel
    ? `Current date (${timeZone || 'UTC'}): ${dateLabel}.`
    : '';
  return [
    `[Scheduled run: ${name}]`,
    'Run the user request exactly as you would in an interactive Nova chat (same tools, same quality of answer).',
    'When finished, your final message is what gets delivered — the scheduler does not rewrite it.',
    'Do not ask clarifying questions. Do not call send_email or SMS tools — delivery is handled after your reply.',
    when,
    '',
    buildChannelOutputInstructions(channel),
    '',
    'USER REQUEST:',
    prompt,
  ].filter(Boolean).join('\n');
}

/**
 * Unwrap Nova's draft for delivery. Does not rewrite content into a new template.
 * @returns {{ subject: string|null, body: string }}
 */
export function unwrapNovaDeliveryDraft(text, channel = 'email') {
  let raw = String(text || '').trim();
  if (!raw) return { subject: null, body: '' };

  const fenceRe = channel === 'sms'
    ? /```(?:sms|text|plain)?\s*([\s\S]*?)```/i
    : /```(?:html|email|htm)?\s*([\s\S]*?)```/i;
  const fenced = raw.match(fenceRe);
  if (fenced?.[1]?.trim()) raw = fenced[1].trim();

  let subject = null;
  if (channel !== 'sms') {
    const subjectLine = raw.match(/^(?:Subject|SUBJECT)\s*:\s*(.+)\s*\n+/);
    if (subjectLine) {
      subject = subjectLine[1].trim().replace(/^["']|["']$/g, '');
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

/** @deprecated use unwrapNovaDeliveryDraft */
export function formatNovaResponseForDelivery(text, channel = 'email') {
  return unwrapNovaDeliveryDraft(text, channel).body;
}
