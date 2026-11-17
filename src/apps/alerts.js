/**
 * Raven credit alerts. When a company has used 80% of the credit it was given, one email goes to staff
 * (RAVEN_ALERT_EMAIL). It is sent once per amount of credit: adding credit starts a fresh cycle, so the next 80% alerts again.
 */
import { sendPublicCompanyEmail } from '../services/publicEmail.js';

export const USAGE_ALERT_RATIO = 0.8;

/** Where alerts go. Several addresses can be separated with commas. */
export function alertRecipients() {
  return String(process.env.RAVEN_ALERT_EMAIL ?? 'udit@acunitsforless.com').split(',').map((e) => e.trim()).filter(Boolean);
}

const usd = (n) => `$${Number(n).toFixed(2)}`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Subject and body of the alert (pure, so it can be tested). */
export function buildUsageAlert({ app = 'Raven', companyId, grantedUsd, spentUsd, remainingUsd }) {
  const percent = grantedUsd > 0 ? Math.round((spentUsd / grantedUsd) * 100) : 100;
  return {
    subject: `${app} credit ${percent}% used: company ${companyId}`,
    body:
      `<p>Company <b>${esc(companyId)}</b> has used <b>${percent}%</b> of its ${esc(app)} credit.</p>`
      + '<table cellpadding="4" style="border-collapse:collapse">'
      + `<tr><td>Credit given</td><td><b>${usd(grantedUsd)}</b></td></tr>`
      + `<tr><td>Used</td><td><b>${usd(spentUsd)}</b></td></tr>`
      + `<tr><td>Left</td><td><b>${usd(remainingUsd)}</b></td></tr>`
      + '</table>'
      + `<p>When it reaches zero, ${esc(app)} stops analysing mail for this company until credit is added. Add credit in the AI Admin (company page, AI apps).</p>`,
  };
}

/** Send the alert. Never throws: a failed email must not affect billing. */
export async function sendUsageAlert(info, { send = sendPublicCompanyEmail } = {}) {
  const to = alertRecipients();
  if (!to.length) return { sent: false, reason: 'no recipient (RAVEN_ALERT_EMAIL is empty)' };
  try {
    const mail = buildUsageAlert(info);
    const res = await send({ mailTo: to, subject: mail.subject, body: mail.body });
    if (!res?.success) {
      console.error(`⚠️  Raven credit alert for company ${info.companyId} was not sent: ${res?.error}`);
      return { sent: false, reason: res?.error };
    }
    console.log(`📧 Raven credit alert sent for company ${info.companyId} (${Math.round((info.spentUsd / info.grantedUsd) * 100)}% used)`);
    return { sent: true };
  } catch (err) {
    console.error('⚠️  Raven credit alert failed:', err?.message || err);
    return { sent: false, reason: err?.message };
  }
}
