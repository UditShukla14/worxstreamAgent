/**
 * Agent Router — decides which agent(s) handle a user query.
 *
 * Two modes:
 *  1. resolveAgentKeys(message) — LLM resolves the right agent key(s) without running them
 *  2. callAgent(key, message)   — Caller specifies one agent directly
 */

import { config } from '../../config/index.js';
import { createMessage } from '../../llm/anthropicClient.js';
import { BaseAgent } from './BaseAgent.js';
import { AGENT_DEFINITIONS, getAgentKeys, getAgentDescriptionsForRouter } from './agentDefinitions.js';
import { buildOrchestratorMessages, logContextUsage } from '../../utils/conversationHistory.js';

// ── Singleton agent instances ────────────────────────────────────────
const agentInstances = new Map();

export function initializeAgentInstances() {
  for (const [key, def] of Object.entries(AGENT_DEFINITIONS)) {
    agentInstances.set(key, new BaseAgent(key, def));
  }
  console.log(`🤖 Initialized ${agentInstances.size} coworker agents (Nova + specialists)`);
}

export function getAgentInstance(key) {
  return agentInstances.get(key);
}

export function getAllAgentInstances() {
  return agentInstances;
}

// ── Router prompt ────────────────────────────────────────────────────
function buildRouterPrompt() {
  return `You are a routing agent. Given a user message and recent conversation context, decide which specialist agent(s) should handle it.

Available agents:
${getAgentDescriptionsForRouter()}

Decide from meaning and context (not keyword lists):
- Greetings / thanks / chit-chat with no task → ["none"]
- Pick the minimum specialist set whose domains cover the ask. Prefer a single entity agent for simple reads/counts/filters on that entity.
- Use "reports" only when the user clearly wants analytics, charts, trends, overview, or a report — not for a simple count or list of one entity.
- customer vs contact: organizations/accounts → customer; people/leads → contact.
- Do not invent keys. Respond with ONLY a JSON array of agent keys.`;
}

// ── Route-only (resolve agent keys without running them) ─────────────

/** Recent turns to include when classifying — enough for follow-up references. */
const ROUTER_HISTORY_MESSAGES = 6;

/** Haiku often wraps JSON in markdown fences — strip them before parsing. */
function stripJsonCodeFence(text) {
  const t = String(text || '').trim();
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return m ? m[1].trim() : t;
}

/**
 * Use the LLM router to determine which agent(s) should handle a message,
 * but DO NOT run them. Returns the resolved agent keys so the caller can
 * invoke agents however it wants (e.g. streaming).
 *
 * @param {string} message
 * @param {string} [conversationContext] - Optional context string from ConversationContext
 * @param {Array<{ role: string, content: string }>} [priorMessages] - Prior turns from MongoDB
 * @param {object} [usageMeta] - Tenant + request attribution for billing
 * @returns {Promise<{ type: string, agentKeys: string[], routerUsage: object }>}
 */
export async function resolveAgentKeys(message, conversationContext = '', priorMessages = [], usageMeta = {}) {
  console.log(`\n🔀 Router analyzing: "${message.substring(0, 100)}${message.length > 100 ? '...' : ''}"`);

  const userContent = conversationContext
    ? `${conversationContext}\n\nUser message: ${message}`
    : message;

  const system = buildRouterPrompt();
  // Routing is a classification task: recent turns + the context prompt (summary,
  // canonical IDs) are enough — the full history window only adds latency/cost.
  const messages = buildOrchestratorMessages({
    priorMessages: priorMessages.slice(-ROUTER_HISTORY_MESSAGES),
    currentUserContent: userContent,
    systemPrompt: system,
  });
  logContextUsage('Router context', messages, system);

  const routeResponse = await createMessage({
    model: config.anthropic.model,
    max_tokens: config.anthropic.maxTokens?.router ?? 100,
    system,
    messages,
  }, { ...usageMeta, phase: 'router', agentKey: 'router' });

  const routeText = stripJsonCodeFence(routeResponse.content[0]?.text?.trim());
  let agentKeys;
  try {
    agentKeys = JSON.parse(routeText);
    if (!Array.isArray(agentKeys)) agentKeys = ['none'];
  } catch {
    console.warn(`⚠️  Router returned invalid JSON: "${routeText}", defaulting to none`);
    agentKeys = ['none'];
  }

  console.log(`🔀 Router selected: [${agentKeys.join(', ')}]`);

  if (agentKeys.length === 1 && agentKeys[0] === 'none') {
    return { type: 'conversation', agentKeys: [], routerUsage: routeResponse.usage };
  }

  const validKeys = agentKeys.filter(k => agentInstances.has(k));
  if (validKeys.length === 0) {
    return { type: 'conversation', agentKeys: [], routerUsage: routeResponse.usage };
  }

  return {
    type: validKeys.length === 1 ? 'single' : 'multi',
    agentKeys: validKeys,
    routerUsage: routeResponse.usage,
  };
}

// ── Direct agent calls ───────────────────────────────────────────────

/**
 * Call a specific agent directly by key.
 *
 * @param {string} agentKey - Agent key from AGENT_DEFINITIONS (e.g. "estimate")
 * @param {string} message  - The message to send
 * @param {object} [context] - Optional inter-agent context
 * @returns {Promise<AgentResult>}
 */
export async function callAgent(agentKey, message, context = {}) {
  const agent = agentInstances.get(agentKey);
  if (!agent) {
    throw new Error(`Unknown agent: "${agentKey}". Available: ${getAgentKeys().join(', ')}`);
  }
  return agent.run(message, context);
}
