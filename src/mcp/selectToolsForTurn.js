/**
 * Compact tool selector for the hosted OpenAI-compatible model.
 *
 * Pattern (compact schema selection before the native OpenAI tool loop):
 *  1) One small LLM call sees a compact catalog (name + short description only)
 *  2) Returns JSON array of tool names needed for this turn
 *  3) Caller loads full OpenAI function schemas only for those names
 *
 * Keyword fallback if the LLM call fails or returns nothing usable.
 */

import { config } from '../config/index.js';
import { createMessage, getResponseText } from '../llm/client.js';

// Keep the callable surface small enough for reliable selection across hosted
// models. Callers can override this, but the default follows the <20 guidance.
const DEFAULT_MAX = 16;
const HARD_MAX = 20;
const STOP_TOKENS = new Set([
  'a', 'an', 'and', 'for', 'from', 'give', 'in', 'last', 'me', 'my', 'need',
  'of', 'on', 'or', 'please', 'that', 'the', 'this', 'to', 'want', 'with',
]);

/**
 * @param {string} text
 * @returns {string}
 */
function stripJsonCodeFence(text) {
  const t = String(text || '').trim();
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return m ? m[1].trim() : t;
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length > 1 && !STOP_TOKENS.has(t));
}

function normalizeMaxTools(value) {
  const requested = Number.isFinite(value) ? value : DEFAULT_MAX;
  return Math.min(HARD_MAX, Math.max(4, requested));
}

/**
 * @param {string} query
 * @returns {{ wantsReport: boolean, wantsForecast: boolean, operationHints: string[], entityHints: string[] }}
 */
export function detectToolIntent(query) {
  const q = String(query || '').toLowerCase();
  const wantsForecast = /\bforecast(?:ing)?\b|\bpredict(?:ive|ion|ed)?\b|\boutlook\b|\bdemand planning\b|\bstock(?:ing)? plan\b|\breorder plan\b/.test(q);
  const wantsReport = wantsForecast
    || /\breports?\b|\banalytics\b|\bdashboard\b|\boverview\b|\btrends?\b|\bkpis?\b|\bbreakdown\b/.test(q);
  const operationHints = [];
  if (/\blist\b|\bshow\b|\bfind\b|\bsearch\b|\brecent\b|\blatest\b/.test(q)) operationHints.push('list');
  if (/\bcreate\b|\badd\b|\bnew\b/.test(q)) operationHints.push('create');
  if (/\bupdate\b|\bedit\b|\bchange\b|\bmark\b|\bassign\b/.test(q)) operationHints.push('update');
  if (/\bdelete\b|\bremove\b|\bcancel\b|\barchive\b/.test(q)) operationHints.push('delete');
  if (/\bsend\b|\bemail\b|\btext\b|\bdraft\b/.test(q)) operationHints.push('send');
  if (/\bdetails?\b|\bget\b|\bview\b|\bopen\b/.test(q)) operationHints.push('get');
  const entityHints = [];
  if (/\bcredit memos?\b/.test(q)) entityHints.push('credit_memo');
  if (/\bpurchase orders?\b|\bp\.??o\.??s?\b/.test(q)) entityHints.push('purchase_order');
  if (/\bsales orders?\b/.test(q)) entityHints.push('sales_order');
  if (/\bestimates?\b|\bquotes?\b/.test(q)) entityHints.push('estimate');
  if (/\binvoices?\b/.test(q)) entityHints.push('invoice');
  if (/\bbills?\b/.test(q)) entityHints.push('bill');
  if (/\bcustomers?\b|\bclients?\b/.test(q)) entityHints.push('customer');
  if (/\bcontacts?\b|\bleads?\b/.test(q)) entityHints.push('contact');
  if (/\bproducts?\b|\bskus?\b|\bservices?\b/.test(q)) entityHints.push('product');
  if (/\binventory\b|\bstock\b|\bwarehouses?\b/.test(q)) entityHints.push('inventory');
  if (/\bvendors?\b|\bsuppliers?\b/.test(q)) entityHints.push('vendor');
  if (/\bjobs?\b/.test(q)) entityHints.push('job');
  if (/\btasks?\b|\bto-?dos?\b/.test(q)) entityHints.push('task');
  if (/\bprojects?\b/.test(q)) entityHints.push('project');
  if (/\bemployees?\b|\bpayroll\b|\bhr\b/.test(q)) entityHints.push('employee');
  if (/\bpayments?\b/.test(q)) entityHints.push('payment');
  if (/\bworkflows?\b/.test(q)) entityHints.push('workflow');
  if (/\bcompan(?:y|ies)\b|\bbranches?\b/.test(q)) entityHints.push('company');
  if (/\baddresses?\b/.test(q)) entityHints.push('address');
  if (/\bsms\b|\btext\b|\bmessage\b/.test(q)) entityHints.push('sms');
  if (/\bshopify\b/.test(q)) entityHints.push('shopify');
  if (/\bcalls?\b|\bvoice\b/.test(q)) entityHints.push('call');
  if (/\bdeals?\b|\bpipeline\b/.test(q)) entityHints.push('deal');
  // A demand forecast is grounded in completed sales/invoice history unless
  // the user explicitly requests estimates as an additional signal.
  if (wantsForecast && !entityHints.includes('invoice')) entityHints.push('invoice');
  return { wantsReport, wantsForecast, operationHints, entityHints };
}

function requiredToolsForIntent(intent, byName) {
  const names = [];
  if (intent.wantsReport && byName.has('get_report_filters')) names.push('get_report_filters');
  if (intent.wantsReport && intent.entityHints.includes('estimate') && byName.has('generate_estimate_report')) {
    names.push('generate_estimate_report');
  }
  if (intent.wantsReport && intent.entityHints.includes('invoice') && byName.has('generate_invoice_report')) {
    names.push('generate_invoice_report');
  }
  if (intent.entityHints.includes('sms')) {
    for (const name of ['draft_sms', 'send_sms', 'get_sms_status']) {
      if (byName.has(name)) names.push(name);
    }
  }
  return names;
}

/**
 * Compact catalog for the picker LLM (no input schemas).
 * @param {Array<{ name: string, description?: string, title?: string }>} tools
 * @returns {string}
 */
export function buildToolCatalogText(tools) {
  return (tools || [])
    .map((t) => {
      const desc = String(t.description || t.title || '').replace(/\s+/g, ' ').trim().slice(0, 140);
      return desc ? `${t.name}: ${desc}` : t.name;
    })
    .join('\n');
}

/**
 * Keyword fallback when the picker LLM fails.
 * @param {Array<{ name: string, description?: string, title?: string }>} tools
 * @param {string} queryText
 * @param {{ maxTools?: number, allowUnscoredFallback?: boolean }} [opts]
 */
export function selectToolsForTurn(tools, queryText, opts = {}) {
  const list = Array.isArray(tools) ? tools : [];
  if (list.length === 0) return [];

  const maxTools = normalizeMaxTools(opts.maxTools);
  const intent = detectToolIntent(queryText);
  const queryTokens = tokenize(queryText);
  const byName = new Map(list.map((t) => [t.name, t]));

  const scoreTool = (tool) => {
    const nameLc = String(tool.name || '').toLowerCase();
    const desc = String(tool.description || tool.title || '').toLowerCase();
    let score = 0;
    for (const t of queryTokens) {
      if (nameLc === t || nameLc === `${t}s`) score += 8;
      else if (nameLc.includes(t)) score += 5;
      if (desc.includes(t)) score += 1;
    }
    if (intent.wantsReport) {
      if (/^generate_/.test(nameLc) && nameLc.includes('report')) score += 25;
      if (nameLc === 'get_report_filters') score += 12;
      if (/^list_(estimates|invoices)$/.test(nameLc)) score -= 20;
    }
    if (
      intent.wantsForecast
      && !intent.entityHints.includes('estimate')
      && nameLc.includes('estimate')
    ) {
      score -= 100;
    }
    for (const entity of intent.entityHints) {
      if (nameLc.includes(entity)) score += 6;
      if (intent.wantsReport && nameLc === `generate_${entity}_report`) score += 30;
    }
    for (const operation of intent.operationHints) {
      if (nameLc.startsWith(`${operation}_`) || nameLc.includes(`_${operation}_`)) score += 18;
      if (operation === 'list' && nameLc.startsWith('generate_') && nameLc.includes('_report')) score -= 15;
    }
    return score;
  };

  const scored = list
    .map((tool) => ({ tool, score: scoreTool(tool) }))
    .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name));

  const selected = new Set();
  for (const name of requiredToolsForIntent(intent, byName)) selected.add(name);
  for (const { tool, score } of scored) {
    if (selected.size >= maxTools) break;
    if (score <= 0) continue;
    selected.add(tool.name);
  }

  // Truly unclassified requests still need a small candidate set. Do not pad
  // a recognized intent with unrelated zero-score schemas.
  if (selected.size === 0 && opts.allowUnscoredFallback !== false) {
    for (const { tool } of scored.slice(0, Math.min(8, maxTools))) selected.add(tool.name);
  }

  const ordered = [];
  for (const { tool } of scored) {
    if (selected.has(tool.name)) ordered.push(tool);
  }
  return ordered.slice(0, maxTools);
}

/**
 * One LLM call to choose tools before loading full schemas.
 *
 * @param {Array<{ name: string, description?: string, title?: string }>} catalog
 * @param {string} queryText
 * @param {{ maxTools?: number, usageMeta?: object }} [opts]
 * @returns {Promise<{ tools: Array<object>, source: 'llm'|'fallback', usage?: object }>}
 */
export async function selectToolsViaLlm(catalog, queryText, opts = {}) {
  const list = Array.isArray(catalog) ? catalog : [];
  const maxTools = normalizeMaxTools(opts.maxTools);
  const validNames = new Set(list.map((t) => t.name));
  const byName = new Map(list.map((t) => [t.name, t]));

  const intent = detectToolIntent(queryText);
  const catalogText = buildToolCatalogText(list);

  const system = `You are Nova's tool picker for Worxstream.
Given the user request and the tool catalog, return ONLY a JSON array of tool names to load for this turn.

Rules:
- Pick the minimum set that can fulfill the request (typically 3–12 names, max ${maxTools}).
- Any request for live Worxstream data or an action must select the functions needed to read or perform it. Explanations and general knowledge do not need functions.
- Prefer generate_estimate_report / generate_invoice_report for report/analytics/overview/dashboard asks — NOT list_estimates / list_invoices.
- Forecast/predictive/outlook/demand-planning asks are reports. Ground them in generate_invoice_report with line_items=true; add generate_estimate_report only when estimates are explicitly requested.
- A product brand or manufacturer (for example Goodman) is not a customer lookup. Do not select resolve_entity unless the request explicitly identifies a customer/account/client.
- Prefer resolve_entity for name→ID lookups.
- Include get_report_filters when report filters/statuses are unclear.
- Only use names that appear in the catalog. No markdown fences. No commentary.

Catalog:
${catalogText}`;

  try {
    const response = await createMessage({
      model: config.llm.model,
      max_tokens: Math.max(256, config.llm.maxTokens?.router ?? 100, 320),
      temperature: 0,
      messages: [{ role: 'system', content: system }, {
        role: 'user',
        content: String(queryText || '').trim() || 'Select tools for a general Worxstream lookup.',
      }],
    }, {
      ...(opts.usageMeta || {}),
      phase: 'tool_search',
      agentKey: 'nova_tool_search',
    });

    const raw = stripJsonCodeFence(getResponseText(response));
    let names;
    try {
      names = JSON.parse(raw);
    } catch {
      const m = raw.match(/\[[\s\S]*\]/);
      names = m ? JSON.parse(m[0]) : null;
    }
    if (!Array.isArray(names)) {
      throw new Error(`tool picker returned non-array: ${raw.slice(0, 200)}`);
    }

    const selected = new Set();
    for (const name of requiredToolsForIntent(intent, byName)) selected.add(name);

    // Merge deterministic name/description matches before the model's picks.
    // This prevents provider-specific omissions while keeping the final surface
    // constrained to this turn's intent.
    const deterministic = selectToolsForTurn(list, queryText, {
      maxTools: Math.min(8, maxTools),
      allowUnscoredFallback: false,
    });
    for (const tool of deterministic) {
      if (selected.size >= maxTools) break;
      selected.add(tool.name);
    }

    for (const item of names) {
      if (selected.size >= maxTools) break;
      const name = String(item || '').trim();
      if (validNames.has(name)) selected.add(name);
    }

    if (intent.wantsForecast && !intent.entityHints.includes('customer')) {
      selected.delete('resolve_entity');
    }

    // If LLM picked list_* for a report ask, force the generate_* report tool in
    if (intent.wantsReport) {
      if (intent.entityHints.includes('estimate')) {
        selected.delete('list_estimates');
        if (validNames.has('generate_estimate_report')) selected.add('generate_estimate_report');
      }
      if (intent.entityHints.includes('invoice')) {
        selected.delete('list_invoices');
        if (validNames.has('generate_invoice_report')) selected.add('generate_invoice_report');
      }
    }

    const tools = [...selected]
      .map((n) => byName.get(n))
      .filter(Boolean)
      .slice(0, maxTools);

    if (tools.length === 0) {
      throw new Error('tool picker returned no valid names');
    }

    console.log(`🪛 Tool search (LLM): [${tools.map((t) => t.name).join(', ')}]`);
    return { tools, source: 'llm', usage: response.usage };
  } catch (err) {
    console.warn(`⚠️ Tool search LLM failed (${err.message}); using keyword fallback`);
    const tools = selectToolsForTurn(list, queryText, { maxTools });
    return { tools, source: 'fallback' };
  }
}
