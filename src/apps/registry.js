/**
 * The AI apps a company can subscribe to. Each app is billed on its own wallet, so a company can use either or both
 * and pays for each separately.
 *
 *  - nova  : the chat coworker (Scribe schedules run on it). Its wallet is the original Nova wallet (analytics/novaWallet.js).
 *  - raven : the mail agent (mail-agent-backend) that summarises and files incoming mail. Its wallet is an app wallet
 *            (apps/appWallet.js), debited from usage that the mail service reports to the internal usage endpoint.
 *
 * Usage rows stay in one ledger (llm_usage_events / llm_usage_daily); the app of a row is derived from its agent_key,
 * so no existing data needs migrating.
 */

export const APPS = Object.freeze({
  nova: { key: 'nova', name: 'Nova', description: 'AI coworker: chat, reports, scheduled tasks', agentKeys: [] },
  raven: { key: 'raven', name: 'Raven', description: 'Mail agent: summaries, categories, priority and sentiment', agentKeys: ['raven'] },
});

export const APP_KEYS = Object.freeze(Object.keys(APPS));
export const SUBSCRIPTION_STATUSES = Object.freeze(['active', 'paused', 'off']);

const RAVEN_AGENT_KEYS = new Set(APPS.raven.agentKeys);

/** Which app a ledger row belongs to. Everything that is not a dedicated app agent is Nova. */
export function appForAgentKey(agentKey) {
  return RAVEN_AGENT_KEYS.has(String(agentKey || '').trim()) ? 'raven' : 'nova';
}

export const isAppKey = (value) => APP_KEYS.includes(String(value || ''));
