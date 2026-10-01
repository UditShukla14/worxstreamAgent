const AFFIRMATIVE_RE = /^(yes|yep|yeah|ok|okay|sure|please do|go ahead|do it|pull it|run it|continue|proceed)[.!\s]*$/i;

const KNOWLEDGE_PREFIX_RE = /^(what is|what are|what does|how do i|how does|how to|explain|describe|why|can you explain|where can i)\b/i;
const LIVE_DATA_RE = /\b(my|our|current|latest|recent|today|yesterday|this (?:week|month|quarter|year)|last (?:week|month|quarter|year)|status|balance|total|count|how many|show|list|find|search|look up|lookup|details?|history|report|analytics|forecast|outlook)\b/i;
const ACTION_RE = /\b(create|add|update|edit|change|delete|remove|send|email|text|draft|generate|export|download|mark|assign|approve|cancel|archive|restore|place|submit|run|execute)\b/i;

const DOMAIN_RULES = [
  ['reports', /\b(report|analytics|dashboard|trend|forecast(?:ing)?|predict(?:ive|ion|ed)?|outlook|demand planning|kpi|breakdown)\b/i],
  ['priceComparison', /\b(price comparison|compare prices?|pricing comparison)\b/i],
  ['creditMemo', /\bcredit memo(?:s)?\b/i],
  ['purchaseOrder', /\bpurchase orders?\b|\bP\.??O\.??s?\b/i],
  ['salesOrder', /\bsales orders?\b/i],
  ['shopify', /\bshopify\b/i],
  ['invoice', /\binvoices?\b/i],
  ['estimate', /\bestimates?\b|\bquotes?\b/i],
  ['inventory', /\binventory\b|\bstock(?: levels?| on hand| quantity| adjustment)?\b|\bwarehouses?\b/i],
  ['product', /\bproducts?\b|\bSKUs?\b|\bservices?\b/i],
  ['customer', /\bcustomers?\b|\bclients?\b|\bcustomer accounts?\b/i],
  ['contact', /\bcontacts?\b|\bleads?\b/i],
  ['vendor', /\bvendors?\b|\bsuppliers?\b/i],
  ['job', /\bjobs?\b/i],
  ['task', /\btasks?\b|\bto-?dos?\b/i],
  ['project', /\bprojects?\b/i],
  ['hr', /\bHR\b|\bemployees?\b|\bpayroll\b|\btime off\b/i],
  ['payments', /\bpayments?\b|\bpayment methods?\b/i],
  ['finance', /\bfinance\b|\baccounting\b|\bchart of accounts\b|\bbank accounts?\b/i],
  ['workflow', /\bworkflows?\b|\bdocument flow\b/i],
  ['deal', /\bdeals?\b|\bopportunit(?:y|ies)\b|\bpipelines?\b/i],
  ['calls', /\bcall sessions?\b|\bvoice agents?\b|\bphone calls?\b/i],
  ['communications', /\bSMS\b|\btext messages?\b|\bemails?\b|\bnotifications?\b|\boutbox\b/i],
  ['address', /\baddresses?\b/i],
  ['company', /\bcompan(?:y|ies)\b|\bbranches?\b|\blocations?\b/i],
  ['config', /\bsettings?\b|\bconfiguration\b/i],
  ['systemFinder', /\bsystem finder\b|\bfind (?:a )?(?:field|module|screen)\b/i],
];

export function isAffirmativeFollowUp(message) {
  return AFFIRMATIVE_RE.test(String(message || '').trim());
}

export function isKnowledgeOnlyRequest(message) {
  const text = String(message || '').trim();
  return KNOWLEDGE_PREFIX_RE.test(text)
    && !LIVE_DATA_RE.test(text);
}

export function hasOperationalIntent(message) {
  const text = String(message || '').trim();
  return ACTION_RE.test(text) || LIVE_DATA_RE.test(text);
}

/** High-confidence lexical route used before/fallback to the LLM router. */
export function detectDomainAgentKeys(message) {
  const text = String(message || '');
  const keys = [];
  for (const [key, pattern] of DOMAIN_RULES) {
    if (pattern.test(text)) keys.push(key);
  }
  return [...new Set(keys)].slice(0, 4);
}

export function shouldRequireToolUse(agentKey, hintText, explicitRequirement = null) {
  if (typeof explicitRequirement === 'boolean') return explicitRequirement;
  const hint = String(hintText || '').trim();
  const currentMarker = hint.lastIndexOf('[Current user]');
  const current = currentMarker >= 0
    ? hint.slice(currentMarker + '[Current user]'.length).split(/\n\[Execution plan\]|\n\[Plan\]/i)[0].trim()
    : hint;
  if (!hint || isKnowledgeOnlyRequest(current)) return false;
  if (agentKey !== 'nova') return true;
  if (/\[Execution plan\]/i.test(hint)) return true;
  return hasOperationalIntent(hint) && detectDomainAgentKeys(hint).length > 0;
}
