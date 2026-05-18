/**
 * Tool capability metadata
 *
 * Goal: reduce hardcoding by attaching small, structured capability hints to tools.
 * Most tools can be inferred from their names (list_*, get_*, create_*, update_*, delete_*).
 */
 
const ACTIONS = /** @type {const} */ ({
  list: 'list',
  get: 'get',
  create: 'create',
  update: 'update',
  delete: 'delete',
  clone: 'clone',
  bulk: 'bulk',
  workflow: 'workflow',
  compare: 'compare',
  other: 'other',
});
 
/**
 * @typedef {'read'|'write'|'mixed'} ToolSafety
 * @typedef {'list'|'get'|'create'|'update'|'delete'|'clone'|'bulk'|'workflow'|'compare'|'other'} ToolAction
 *
 * @typedef {object} ToolCapabilities
 * @property {string} [domain]         - High-level domain bucket (e.g., 'invoice', 'customer', 'finance')
 * @property {string} [entity]         - Primary entity type (often same as domain)
 * @property {ToolAction} [action]
 * @property {ToolSafety} [safety]
 * @property {boolean} [paginates]     - True if the tool returns paginated results
 * @property {string[]} [idFields]     - Preferred identifier fields (e.g. ['customer_id','id'])
 */
 
function isNonEmptyString(x) {
  return typeof x === 'string' && x.trim().length > 0;
}
 
/**
 * Infer capabilities from a tool name using conventions.
 * Falls back to { action:'other', safety:'mixed' } for unknown patterns.
 *
 * @param {string} toolName
 * @returns {ToolCapabilities}
 */
export function inferCapabilitiesFromToolName(toolName) {
  const name = String(toolName || '').trim();
  const lc = name.toLowerCase();
 
  /** @type {ToolCapabilities} */
  const caps = {};
 
  const verb = lc.split('_')[0] || '';
  const rest = lc.replace(/^(list|get|create|update|delete|clone|bulk_action|quick_update|compare|link|cancel|verify|initialize|restore|soft|permanently)\_?/, '');
 
  // Domain/entity heuristics
  // Handle special cases first (tools that end with _report should go to reports domain)
  if (lc.includes('_report') || lc.includes('goal') || lc.startsWith('get_report') || lc.startsWith('export_') && lc.includes('report')) {
    caps.domain = 'reports';
    caps.entity = 'reports';
  } else {
    // Prefer explicit domain based on stable substrings.
    const domainCandidates = [
      'invoice',
      'estimate',
      'credit_memo',
      'purchase_order',
      'bill',
      'customer',
      'contact',
      'product',
      'vendor',
      'job',
      'task',
      'project',
      'workflow',
      'company',
      'address',
      'finance',
      'config',
      'hr',
      'system_finder',
      'price_comparison',
    ];

    for (const d of domainCandidates) {
      if (lc.includes(d)) {
        caps.domain = d;
        caps.entity = d;
        break;
      }
    }
  }
 
  // Normalize a few common “tool prefix” domains
  if (!caps.domain) {
    if (lc.includes('system_finder')) {
      caps.domain = 'system_finder';
      caps.entity = 'system_finder';
    } else if (lc.includes('compare_stock_prices')) {
      caps.domain = 'price_comparison';
      caps.entity = 'price_comparison';
    } else if (isNonEmptyString(rest)) {
      // Rough guess: first token after verb
      caps.domain = rest.split('_')[0];
      caps.entity = caps.domain;
    }
  }
 
  // Action + safety
  if (lc.startsWith('list_')) {
    caps.action = ACTIONS.list;
    caps.safety = 'read';
    caps.paginates = true;
  } else if (lc.startsWith('get_')) {
    caps.action = ACTIONS.get;
    caps.safety = 'read';
  } else if (lc.startsWith('create_')) {
    caps.action = ACTIONS.create;
    caps.safety = 'write';
  } else if (lc.startsWith('update_') || lc.startsWith('quick_update_')) {
    caps.action = ACTIONS.update;
    caps.safety = 'write';
  } else if (lc.startsWith('delete_') || lc.includes('permanently_delete') || lc.includes('soft_delete')) {
    caps.action = ACTIONS.delete;
    caps.safety = 'write';
  } else if (lc.startsWith('clone_')) {
    caps.action = ACTIONS.clone;
    caps.safety = 'write';
  } else if (lc.startsWith('bulk_action_')) {
    caps.action = ACTIONS.bulk;
    caps.safety = 'write';
  } else if (lc.includes('workflow')) {
    caps.action = ACTIONS.workflow;
    caps.safety = 'mixed';
  } else if (lc.startsWith('compare_') || lc.includes('compare')) {
    caps.action = ACTIONS.compare;
    caps.safety = 'read';
  } else {
    caps.action = ACTIONS.other;
    caps.safety = 'mixed';
  }
 
  // ID field hints
  // Prefer domain-specific *_id when obvious.
  const idFields = [];
  if (caps.domain === 'customer') idFields.push('customer_id', 'id');
  if (caps.domain === 'contact') idFields.push('contact_id', 'id');
  if (caps.domain === 'invoice') idFields.push('invoice_id', 'id');
  if (caps.domain === 'estimate') idFields.push('estimate_id', 'id');
  if (caps.domain === 'credit_memo') idFields.push('credit_memo_id', 'id');
  if (caps.domain === 'purchase_order') idFields.push('purchase_order_id', 'id');
  if (caps.domain === 'bill') idFields.push('bill_id', 'id');
  if (idFields.length > 0) caps.idFields = idFields;
 
  return caps;
}
 
/**
 * Merge explicit capabilities (if provided) with inferred defaults.
 * Explicit values win.
 *
 * @param {string} toolName
 * @param {ToolCapabilities|null|undefined} explicit
 * @returns {ToolCapabilities}
 */
export function normalizeToolCapabilities(toolName, explicit) {
  const inferred = inferCapabilitiesFromToolName(toolName);
  if (!explicit || typeof explicit !== 'object') return inferred;
  return { ...inferred, ...explicit };
}
 
