/**
 * Lightweight execution plan before Nova's tool loop (orchestrator mode).
 *
 * Produces a short goal + steps so Nova executes with intent, not ad-hoc tool spam.
 * Clarification stays: mode=clarify returns an ask and skips tools.
 */

import { config } from '../../config/index.js';
import { createMessage } from '../../llm/anthropicClient.js';
import { buildOrchestratorMessages, logContextUsage } from '../../utils/conversationHistory.js';

const DIRECT_RE = /^(hi|hello|hey|thanks|thank you|thx|ok|okay|yo|good morning|good afternoon|good evening)[\s!.?]*$/i;

const PLAN_SYSTEM = `You are Nova's planner for Worxstream (business ops coworker).
Return ONLY strict JSON (no markdown fences):
{
  "mode": "execute" | "direct" | "clarify",
  "goal": string,
  "steps": string[],
  "ask": string|null,
  "risk": "read" | "write" | "send"
}

Rules:
- mode=direct: greetings, thanks, chitchat, or acknowledgements with no Worxstream work.
- mode=clarify: critical info is missing AND cannot be resolved with lookup/list tools (true ambiguity of intent). Prefer execute when resolve_entity / list_* can find names→IDs. ask = one clear question.
- mode=execute: any data lookup or action — steps are 1–8 short, ordered, tool-oriented actions (e.g. "Resolve customer Acme", "List their invoices page 1").
- Never invent IDs, amounts, or tool results.
- Prefer the fewest steps that fulfill the request.
- risk=send for SMS/email; write for create/update/delete; otherwise read.`;

/**
 * @param {string} message
 * @returns {boolean}
 */
export function isDirectChatMessage(message) {
  const t = String(message || '').trim();
  if (!t) return true;
  if (t.length <= 2) return true;
  return DIRECT_RE.test(t);
}

/**
 * @param {unknown} raw
 * @returns {{ mode: string, goal: string, steps: string[], ask: string|null, risk: string }}
 */
export function normalizeExecutionPlan(raw) {
  const modeRaw = String(raw?.mode || 'execute').toLowerCase();
  const mode = modeRaw === 'direct' || modeRaw === 'clarify' || modeRaw === 'execute'
    ? modeRaw
    : 'execute';
  const steps = Array.isArray(raw?.steps)
    ? raw.steps.map((s) => String(s || '').trim()).filter(Boolean).slice(0, 8)
    : [];
  const riskRaw = String(raw?.risk || 'read').toLowerCase();
  const risk = riskRaw === 'write' || riskRaw === 'send' ? riskRaw : 'read';
  return {
    mode,
    goal: String(raw?.goal || '').trim().slice(0, 300),
    steps,
    ask: raw?.ask == null || raw?.ask === '' ? null : String(raw.ask).trim().slice(0, 500),
    risk,
  };
}

/**
 * @param {object} plan
 * @returns {string}
 */
export function formatExecutionPlanForPrompt(plan) {
  if (!plan || typeof plan !== 'object') return '';
  if (plan.mode === 'direct') return '';
  const lines = ['[Execution plan]'];
  if (plan.goal) lines.push(`Goal: ${plan.goal}`);
  if (plan.risk) lines.push(`Risk: ${plan.risk}`);
  if (Array.isArray(plan.steps) && plan.steps.length > 0) {
    lines.push('Steps:');
    plan.steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
  }
  lines.push(
    'Follow this plan with tools. Revise steps only if tool results prove them wrong. '
    + 'If a step is ambiguous, ASK the user before acting — do not guess.',
  );
  return lines.join('\n');
}

/**
 * Build task_state snapshot for working memory / continue (changes.md).
 * @param {object} plan
 * @returns {object|null}
 */
export function planToTaskState(plan) {
  if (!plan || plan.mode !== 'execute') return null;
  return {
    status: 'in_progress',
    goal: plan.goal || '',
    completed: [],
    next: Array.isArray(plan.steps) ? [...plan.steps] : [],
    risk: plan.risk || 'read',
    updatedAt: Date.now(),
  };
}

/**
 * @param {object} params
 * @param {string} params.message
 * @param {string} [params.conversationContext]
 * @param {Array} [params.priorMessages]
 * @param {object} [params.usageMeta]
 * @returns {Promise<object>}
 */
export async function getExecutionPlan({
  message,
  conversationContext = '',
  priorMessages = [],
  usageMeta = {},
}) {
  if (isDirectChatMessage(message)) {
    return normalizeExecutionPlan({
      mode: 'direct',
      goal: '',
      steps: [],
      ask: null,
      risk: 'read',
    });
  }

  const userParts = [];
  if (conversationContext) userParts.push(`Session context:\n${conversationContext}`);
  userParts.push(`User message:\n${message}`);
  userParts.push('', 'Return ONLY the JSON object.');

  const systemPrompt = PLAN_SYSTEM;
  const messages = buildOrchestratorMessages({
    priorMessages: (priorMessages || []).slice(-6),
    currentUserContent: userParts.join('\n'),
    systemPrompt,
  });
  logContextUsage('Execution plan context', messages, systemPrompt);

  const maxTokens = config.anthropic.maxTokens?.nova ?? 256;
  const response = await createMessage({
    model: config.anthropic.model,
    max_tokens: Math.max(maxTokens, 320),
    system: systemPrompt,
    messages,
  }, { ...usageMeta, phase: 'execution_plan', agentKey: 'execution_plan' });

  const text = response.content?.find((b) => b.type === 'text')?.text?.trim() || '';
  const stripped = stripJsonCodeFence(text);
  try {
    return normalizeExecutionPlan(JSON.parse(stripped));
  } catch {
    // Fail open: execute without a structured plan (do not block the user).
    console.warn('⚠️ Execution plan parse failed; continuing without structured plan');
    return normalizeExecutionPlan({
      mode: 'execute',
      goal: String(message || '').slice(0, 200),
      steps: ['Understand the request', 'Call the minimum tools needed', 'Answer from tool results'],
      ask: null,
      risk: 'read',
    });
  }
}

function stripJsonCodeFence(text) {
  const t = String(text || '').trim();
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return m ? m[1].trim() : t;
}
