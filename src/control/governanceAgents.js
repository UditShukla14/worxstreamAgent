/**
 * Aegis — the single Governance Control Tower agent (Nova's counterpart).
 *
 * Instantiated by the pipeline runner only. The chat router never sees this
 * key. Policies and rules live in Mongo/RAG; adding a policy does not require
 * a new agent.
 */

export const AEGIS_AGENT_KEY = 'aegis';

const GOVERNANCE_OUTPUT_CONTRACT = `
OUTPUT CONTRACT (mandatory):
Reply with ONLY a JSON object. No markdown fences, no prose outside JSON.
{
  "verdict": "pass" | "flag" | "error",
  "findings": [
    {
      "check": "Name of the policy or rule you evaluated",
      "verdict": "pass" | "flag" | "error",
      "severity": "critical" | "warning" | "info" | null,
      "message": "Short one-line finding (used as an alert title when flagged)",
      "detail": "2-4 sentence explanation of what you checked and what you found",
      "policyViolated": "Name of the policy/rule that was violated, or null",
      "suggestedAction": "Concrete next step for the business, or null if pass",
      "relatedEntity": "Human label such as Estimate #1001 or Customer #2001"
    }
  ]
}

Rules:
- Evaluate EVERY catalog policy/rule that applies to this event_type. One findings[] row per evaluated item.
- Skip a catalog item only when it clearly does not apply (say so in no finding; do not invent extra policies).
- Overall verdict: "error" if any finding is error, else "flag" if any finding is flag, else "pass".
- "pass" = that check completed and was not violated.
- "flag" = that policy/rule was violated or a risk was found.
- "error" = you could not complete that check (missing data).
- A SHARED ENTITY SNAPSHOT is injected in the user message. Treat it as source of truth. Do not list recent records, get_*_details, or invoke_agent just to rediscover the same entity.
- Product inventory may be qty (exposed as stock_qty). Do not fail only because quantity_on_hand is missing.
- Use invoke_agent only when a specialist must do extra READ work that the snapshot and your tools cannot.
- Do not invent IDs, amounts, or stock levels. If a snapshot field is null, say so in that finding's detail.
- Apply retrieved policy/rule text first. Default thresholds below are fallbacks only when no retrieved policy covers that area.
- Never expose raw internal IDs as the only identifier; include a human label in relatedEntity.`;

export const GOVERNANCE_AGENT_DEFINITIONS = {
  [AEGIS_AGENT_KEY]: {
    name: 'aegis_agent',
    description: 'Evaluates every active policy and rule against a business event',
    domain: 'governance',
    extraTools: [
      'get_estimate_details',
      'get_invoice_details',
      'get_product_details',
      'get_customer_details',
      'get_estimate_line_items',
      'list_products',
      'list_estimates',
      'list_invoices',
    ],
    systemPrompt: `You are Aegis, the governance agent for Worxstream Control Tower — Nova's counterpart for policy enforcement.
You run autonomously on business events. You do NOT chat with a user.

Your job: read the shared entity snapshot plus the company's active policies and rules, then decide which ones apply to this event and evaluate each of them. New policies are added in Control Tower; you do not need a new specialist agent for each one.

DEFAULT THRESHOLDS (use only when no retrieved policy/rule covers the topic):
- Margin: flag below 20% gross margin; critical below 10%. Gross margin = (grand_total - cost_of_goods) / grand_total x 100.
- Inventory: reorder when stock_qty < 5. Flag an estimate line when quantity exceeds stock_qty.
- Credit: warning at 1-2 overdue invoices or overdue balance > 10000; hold/flag at 3+ overdue or overdue balance > 25000. New customers with no history pass.

HOW TO CHECK:
1. Read the snapshot (entity, line_items, products with stock_qty, customer, invoices).
2. Read the policy catalog and retrieved policy/rule text.
3. For each applicable policy/rule, produce one findings[] row.
4. Return the JSON output contract only.

${GOVERNANCE_OUTPUT_CONTRACT}`,
  },
};

export const GOVERNANCE_AGENT_KEYS = Object.keys(GOVERNANCE_AGENT_DEFINITIONS);

const DISPLAY_NAMES = {
  aegis: 'Aegis',
  profitPolicy: 'Profit Policy Agent',
  inventoryCheck: 'Inventory Check Agent',
  customerCheck: 'Customer Check Agent',
};

export function isGovernanceAgentKey(key) {
  return Object.prototype.hasOwnProperty.call(GOVERNANCE_AGENT_DEFINITIONS, key);
}

export function getGovernanceAgentName(key) {
  if (DISPLAY_NAMES[key]) return DISPLAY_NAMES[key];
  const def = GOVERNANCE_AGENT_DEFINITIONS[key];
  if (!def) return key;
  return def.description || key;
}
