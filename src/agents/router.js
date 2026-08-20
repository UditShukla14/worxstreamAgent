/**
 * Agent Router — decides which agent(s) handle a user query.
 *
 * Two modes:
 *  1. resolveAgentKeys(message) — LLM resolves the right agent key(s) without running them
 *  2. callAgent(key, message)   — Caller specifies one agent directly
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/index.js';
import { BaseAgent } from './BaseAgent.js';
import { AGENT_DEFINITIONS, getAgentKeys, getAgentDescriptionsForRouter } from './agentDefinitions.js';
import { buildOrchestratorMessages, logContextUsage } from '../utils/conversationHistory.js';

// ── Singleton agent instances ────────────────────────────────────────
const agentInstances = new Map();

export function initializeAgentInstances() {
  for (const [key, def] of Object.entries(AGENT_DEFINITIONS)) {
    agentInstances.set(key, new BaseAgent(key, def));
  }
  console.log(`🤖 Initialized ${agentInstances.size} specialist agents`);
}

export function getAgentInstance(key) {
  return agentInstances.get(key);
}

export function getAllAgentInstances() {
  return agentInstances;
}

// ── Router prompt ────────────────────────────────────────────────────
function buildRouterPrompt() {
  return `You are a routing agent. Given a user message, decide which specialist agent(s) should handle it.

Available agents:
${getAgentDescriptionsForRouter()}

Rules:
- For simple greetings, "thanks", or general questions, return: ["none"]
- For single-domain queries, return one agent key: e.g. ["estimate"]
- For cross-domain queries that need data from multiple domains, return multiple: e.g. ["customer", "estimate"]
- When the user says "customer", route to "customer" (NOT "contact").
- When the user says "contact" or "lead", route to "contact" (NOT "customer").
- Always return the MINIMUM set of agents needed.

Examples:
- "hi" or "hello" or "thanks" → ["none"]
- "list all estimates" → ["estimate"]
- "show me invoices for customer Acme" → ["invoice"]
- "list credit memos" / "create credit memo" → ["creditMemo"]
- "show purchase orders" / "create a PO" → ["purchaseOrder"]
- "list bills" / "create a bill" → ["bill"]
- "create a job" → ["job"]
- "show departments" → ["hr"]
- "find product ABC" → ["product"]
- "compare prices in these files" → ["priceComparison"]
- "create an estimate for customer X" → ["customer", "estimate"]
- "convert estimate to invoice" → ["workflow"]
- "what HVAC systems are available" → ["systemFinder"]
- "show company details" → ["company"]
- "list addresses" → ["address"]
- "show tax configs" → ["finance"]
- "show me app menus" → ["config"]
- "list sales orders" / "create a sales order" → ["salesOrder"]
- "warehouse stock" / "how many units of SKU X" → ["inventory"]
- "list deals" / "move deal to closed won" → ["deal"]
- "search everything for Acme" / "notes on this deal" → ["crm"]
- "received payments" / "payment methods" → ["payments"]
- "unread notifications" / "email this invoice" → ["communications"]

Respond with ONLY a JSON array of agent keys. Nothing else.`;
}

// ── Route-only (resolve agent keys without running them) ─────────────

const routerClient = new Anthropic({ apiKey: config.anthropic.apiKey });

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
 * @returns {Promise<{ type: string, agentKeys: string[], routerUsage: object }>}
 */
export async function resolveAgentKeys(message, conversationContext = '', priorMessages = []) {
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

  const routeResponse = await routerClient.messages.create({
    model: config.anthropic.model,
    max_tokens: config.anthropic.maxTokens?.router ?? 100,
    system,
    messages,
  });

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
