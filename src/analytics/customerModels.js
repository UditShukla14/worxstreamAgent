/**
 * The model screen for companies: which AI model to use for which kind of task, with a recommendation.
 * Companies see friendly descriptions and the price THEY are charged per million tokens (Anthropic's price plus the
 * margin), never Anthropic's own price.
 */

import { MODEL_CATALOG } from './modelPricing.js';
import { DEFAULT_TASK_MODELS } from './taskModels.js';
import { config } from '../config/index.js';
import { getWallet, setWalletAllowance, computeRemainingUsd } from './novaWallet.js';
import CompanyNovaWallet from './models/CompanyNovaWallet.js';
import LlmUsageDaily from './models/LlmUsageDaily.js';
import { UNATTRIBUTED } from './recordUsage.js';

/** The tasks a company can choose a model for. The model is chosen per task, not per employee. */
export const MODEL_TASKS = Object.freeze([
  {
    key: 'daily',
    label: 'Everyday tasks',
    description: 'Understanding your request, planning the steps and summarising results. Runs on almost every message.',
  },
  {
    key: 'medium',
    label: 'Business work',
    description: 'Reports, Shopify, estimates, invoices and other tasks that read and combine your company data.',
  },
]);

/**
 * The models we offer, in order of capability, each with a plain description. The first two are the platform's
 * configured models (the recommendation for everyday and business tasks), so the recommended choice is always one of the
 * cards; the others are the more capable options. Only models that exist in the pricing catalogue are shown.
 */
function offeredModels() {
  const list = [
    { id: config.anthropic.fastModel, label: 'Fast', summary: 'Quick answers at the lowest cost.', best_for: 'Simple questions, summaries, quick lookups' },
    { id: config.anthropic.model, label: 'Balanced', summary: 'Strong answers for most business work at a fair price.', best_for: 'Reports, estimates, invoices, Shopify' },
    { id: 'claude-opus-5-5', label: 'Advanced', summary: 'Deeper reasoning for complex, multi-step requests.', best_for: 'Analysis across many records, careful comparisons' },
    { id: 'claude-fable-5-2', label: 'Most capable', summary: 'Our most capable model, at the highest price.', best_for: 'The hardest requests, when quality matters most' },
  ];
  const seen = new Set();
  return list.filter((o) => o.id && !seen.has(o.id) && seen.add(o.id));
}

const round2 = (n) => Math.round(n * 100) / 100;
const byId = (id) => MODEL_CATALOG.find((m) => m.id === id);

/** What the company is charged per million tokens for a model: Anthropic's price x (1 + markup). */
function chargedPrices(entry, markup) {
  return {
    charged_input_per_million: round2(entry.inputPerMillion * (1 + markup)),
    charged_output_per_million: round2(entry.outputPerMillion * (1 + markup)),
  };
}

/** The models shown for a task: the offered list plus the recommended and the currently chosen model if they are not in it. */
export function optionsFor(taskKey, extraIds, markup) {
  const recommended = DEFAULT_TASK_MODELS[taskKey];
  const offered = offeredModels();
  const ids = [...offered.map((o) => o.id)];
  for (const id of [recommended, ...extraIds]) if (id && !ids.includes(id)) ids.push(id);
  return ids
    .map((id) => {
      const entry = byId(id);
      if (!entry) return null;
      const card = offered.find((o) => o.id === id);
      return {
        id,
        name: entry.name,
        label: card?.label || 'Other',
        summary: card?.summary || '',
        best_for: card?.best_for || '',
        recommended: id === recommended,
        ...chargedPrices(entry, markup),
      };
    })
    .filter(Boolean);
}

/** @param {string} companyId */
export async function getCompanyModelChoices(companyId) {
  const markup = config.billing?.markupRate ?? 0;
  const wallet = await getWallet(companyId);
  const chosen = wallet?.model_tiers || {};
  return {
    tasks: MODEL_TASKS.map((task) => {
      const recommended = DEFAULT_TASK_MODELS[task.key];
      const own = chosen[task.key] ? String(chosen[task.key]) : '';
      return {
        key: task.key,
        label: task.label,
        description: task.description,
        recommended_model_id: recommended,
        selected_model_id: own || recommended,
        is_custom: Boolean(own) && own !== recommended,
        options: optionsFor(task.key, own ? [own] : [], markup),
      };
    }),
  };
}

/**
 * Save the company's model per task. An empty string (or the recommended model) goes back to the recommendation.
 * @param {string} companyId
 * @param {{ daily?: string, medium?: string }} choices
 */
export async function setCompanyModelChoices(companyId, choices = {}) {
  const wallet = await getWallet(companyId);
  const next = { ...(wallet?.model_tiers || {}) };
  for (const task of MODEL_TASKS) {
    if (choices[task.key] === undefined) continue;
    const id = String(choices[task.key] || '').trim();
    if (!id || id === DEFAULT_TASK_MODELS[task.key]) {
      delete next[task.key];
      continue;
    }
    const allowed = optionsFor(task.key, [], 0).some((o) => o.id === id);
    if (!allowed) throw new Error(`model "${id}" is not available for ${task.label.toLowerCase()}`);
    next[task.key] = id;
  }
  await setWalletAllowance(companyId, { model_tiers: next });
  return getCompanyModelChoices(companyId);
}

/**
 * Staff view: every company with its plan, credit and the model it uses for each kind of task. A company that never chose
 * a model uses the platform's recommendation (`source: "recommended"`). Includes companies that have used Nova but have no
 * wallet yet.
 */
export async function listCompanyModelAssignments() {
  const [wallets, usageCompanies] = await Promise.all([
    CompanyNovaWallet.find({}).lean(),
    LlmUsageDaily.distinct('company_id', { company_id: { $ne: UNATTRIBUTED } }),
  ]);
  const byId = new Map(wallets.map((w) => [String(w.company_id), w]));
  for (const id of usageCompanies) if (id && !byId.has(String(id))) byId.set(String(id), null);

  const nameOf = (id) => MODEL_CATALOG.find((m) => m.id === id)?.name || id;

  const rows = [...byId.entries()].map(([companyId, wallet]) => {
    const chosen = wallet?.model_tiers || {};
    const tasks = {};
    for (const task of MODEL_TASKS) {
      const own = chosen[task.key] ? String(chosen[task.key]) : '';
      const id = own || DEFAULT_TASK_MODELS[task.key];
      tasks[task.key] = { model_id: id, model_name: nameOf(id), source: own && own !== DEFAULT_TASK_MODELS[task.key] ? 'company' : 'recommended' };
    }
    return {
      company_id: companyId,
      display_name: wallet?.display_name || '',
      plan_name: wallet?.plan_name || '',
      enforced: Boolean(wallet?.limits_enabled),
      remaining_usd: wallet ? computeRemainingUsd(wallet) : null,
      tasks,
    };
  });
  rows.sort((a, b) => (a.display_name || a.company_id).localeCompare(b.display_name || b.company_id, undefined, { numeric: true }));
  return { tasks: MODEL_TASKS.map(({ key, label }) => ({ key, label })), companies: rows };
}
