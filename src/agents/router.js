/**
 * Agent Router — decides which agent(s) handle a user query.
 *
 * Three modes:
 *  1. routeToAgents(message)            — LLM picks the right agent(s)
 *  2. callAgent(key, message)           — Caller specifies one agent directly
 *  3. callAgentsParallel(keys, message) — Caller specifies multiple agents
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/index.js';
import { BaseAgent } from './BaseAgent.js';
import { AGENT_DEFINITIONS, getAgentKeys, getAgentDescriptionsForRouter } from './agentDefinitions.js';

// ── Singleton agent instances ────────────────────────────────────────
const agentInstances = new Map();

export function initializeAgentInstances() {
  for (const [key, def] of Object.entries(AGENT_DEFINITIONS)) {
    agentInstances.set(key, new BaseAgent(def));
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

Respond with ONLY a JSON array of agent keys. Nothing else.`;
}

// ── LLM-based routing ────────────────────────────────────────────────

const routerClient = new Anthropic({ apiKey: config.anthropic.apiKey });

/**
 * Use the LLM to determine which agent(s) should handle a message,
 * then run them.
 *
 * @param {string} message - The user's message
 * @returns {Promise<RouterResult>}
 */
export async function routeToAgents(message) {
  console.log(`\n🔀 Router analyzing: "${message.substring(0, 100)}${message.length > 100 ? '...' : ''}"`);

  const routeResponse = await routerClient.messages.create({
    model: config.anthropic.model,
    max_tokens: 100,
    system: buildRouterPrompt(),
    messages: [{ role: 'user', content: message }],
  });

  const routeText = routeResponse.content[0]?.text?.trim();
  let agentKeys;
  try {
    agentKeys = JSON.parse(routeText);
    if (!Array.isArray(agentKeys)) agentKeys = ['none'];
  } catch {
    console.warn(`⚠️  Router returned invalid JSON: "${routeText}", defaulting to none`);
    agentKeys = ['none'];
  }

  console.log(`🔀 Router selected: [${agentKeys.join(', ')}]`);

  // Conversational — no agent needed
  if (agentKeys.length === 1 && agentKeys[0] === 'none') {
    return {
      type: 'conversation',
      agentKeys: [],
      results: [],
      routerUsage: routeResponse.usage,
    };
  }

  // Validate agent keys
  const validKeys = agentKeys.filter(k => agentInstances.has(k));
  if (validKeys.length === 0) {
    console.warn(`⚠️  No valid agents found for keys: [${agentKeys.join(', ')}]`);
    return { type: 'conversation', agentKeys: [], results: [], routerUsage: routeResponse.usage };
  }

  // Single agent — direct call
  if (validKeys.length === 1) {
    const result = await callAgent(validKeys[0], message);
    return {
      type: 'single',
      agentKeys: validKeys,
      results: [result],
      routerUsage: routeResponse.usage,
    };
  }

  // Multiple agents — run sequentially (so later agents have context from earlier ones)
  const results = [];
  let enrichedMessage = message;

  for (const key of validKeys) {
    const result = await callAgent(key, enrichedMessage);
    results.push(result);
    enrichedMessage = `${message}\n\n[Context from ${result.agent}]: ${result.response}`;
  }

  return {
    type: 'multi',
    agentKeys: validKeys,
    results,
    routerUsage: routeResponse.usage,
  };
}

// ── Route-only (resolve agent keys without running them) ─────────────

/**
 * Use the LLM router to determine which agent(s) should handle a message,
 * but DO NOT run them. Returns the resolved agent keys so the caller can
 * invoke agents however it wants (e.g. streaming).
 *
 * @param {string} message
 * @param {string} [conversationContext] - Optional context string from ConversationContext
 * @returns {Promise<{ type: string, agentKeys: string[], routerUsage: object }>}
 */
export async function resolveAgentKeys(message, conversationContext = '') {
  console.log(`\n🔀 Router analyzing: "${message.substring(0, 100)}${message.length > 100 ? '...' : ''}"`);

  const userContent = conversationContext
    ? `${conversationContext}\n\nUser message: ${message}`
    : message;

  const routeResponse = await routerClient.messages.create({
    model: config.anthropic.model,
    max_tokens: 100,
    system: buildRouterPrompt(),
    messages: [{ role: 'user', content: userContent }],
  });

  const routeText = routeResponse.content[0]?.text?.trim();
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

/**
 * Call multiple agents in parallel (for independent tasks).
 *
 * @param {string[]} agentKeys
 * @param {string} message
 * @returns {Promise<AgentResult[]>}
 */
export async function callAgentsParallel(agentKeys, message) {
  const promises = agentKeys.map(key => {
    const agent = agentInstances.get(key);
    if (!agent) {
      return Promise.resolve({
        agent: key,
        response: `Error: unknown agent "${key}"`,
        toolsUsed: [],
        usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      });
    }
    return agent.run(message);
  });
  return Promise.all(promises);
}

/**
 * Call multiple agents sequentially, chaining context from each result
 * into the next agent's message.
 *
 * @param {string[]} agentKeys
 * @param {string} message
 * @returns {Promise<AgentResult[]>}
 */
export async function callAgentsSequential(agentKeys, message) {
  const results = [];
  let enrichedMessage = message;

  for (const key of agentKeys) {
    const result = await callAgent(key, enrichedMessage);
    results.push(result);
    enrichedMessage = `${message}\n\n[Context from ${result.agent}]: ${result.response}`;
  }

  return results;
}
