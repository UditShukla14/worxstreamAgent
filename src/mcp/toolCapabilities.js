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
 
/**
 * Ordered domain rules: first matching substring wins, so the most specific
 * patterns MUST come first. Every rule maps to one of the agent domains in
 * src/agents/agentDefinitions.js (plus 'reports', handled separately).
 *
 * Ordering traps encoded here:
 * - 'organization_contact' (company.js) before 'contact' (CRM)
 * - 'department'/'team' (hr.js) before 'branch' (get_departments_by_branch)
 * - finance dropdown VALUES ('dropdown_value', 'default_dropdowns') vs
 *   config dropdown/column CONFIGS ('dropdown_config', 'column_config')
 *
 * @type {Array<[string, string]>}
 */
const DOMAIN_RULES = [
  // Governance-only tools (must precede any generic match; not in chat router)
  ['invoke_agent', 'governance'],
  ['relevant_policies', 'governance'],
  ['organization_contact', 'company'],
  ['credit_memo', 'credit_memo'],
  ['purchase_order', 'purchase_order'],
  ['sales_order', 'sales_order'],
  ['system_finder', 'system_finder'],
  ['price_comparison', 'price_comparison'],
  ['compare_stock_prices', 'price_comparison'],
  // Inventory (inventory.js): warehouses, stock, serials, transfers — before generic product
  ['packing_list', 'inventory'],
  ['sku_ledger', 'inventory'],
  ['serial_number', 'inventory'],
  ['internal_transfer', 'inventory'],
  ['warehouse', 'inventory'],
  ['inventory', 'inventory'],
  // CRM deals / pipelines (deals.js) — pipeline_stage before pipeline; reports *_report stays above
  ['pipeline_stage', 'deal'],
  ['pipeline', 'deal'],
  ['deal', 'deal'],
  // CRM modules (crm.js)
  ['global_search', 'crm'],
  ['calendar_event', 'crm'],
  ['event_board', 'crm'],
  ['diar', 'crm'],
  ['activit', 'crm'],
  ['list_calls', 'crm'],
  ['note', 'crm'],
  // Communications (communications.js)
  ['object_email', 'communications'],
  ['email_outbox', 'communications'],
  ['notification', 'communications'],
  // HR (hr.js): departments, teams, team members
  ['department', 'hr'],
  ['team', 'hr'],
  ['hr', 'hr'],
  // Finance (finance.js): taxes, chart of accounts, dropdown values, fields, app filters
  ['tax', 'finance'],
  ['chart_of_account', 'finance'],
  ['account_chart', 'finance'],
  ['dropdown_value', 'finance'],
  ['default_dropdowns', 'finance'],
  ['fields_group', 'finance'],
  ['all_fields', 'finance'],
  ['app_filters', 'finance'],
  // Config (config.js/helpers.js): UI configs, menus, forms, reference data
  ['dropdown_config', 'config'],
  ['column_config', 'config'],
  ['menus', 'config'],
  ['forms', 'config'],
  ['country_code', 'config'],
  ['timezone', 'config'],
  ['currencies', 'config'],
  ['all_apps', 'config'],
  ['config', 'config'],
  // Company (company.js/subscriptions.js): org-level settings and DB ops
  ['branch', 'company'],
  ['signature', 'company'],
  ['payment_instruction', 'company'],
  ['received_payment', 'payments'],
  ['payment_method', 'payments'],
  ['deposit', 'payments'],
  ['custom_number_range', 'company'],
  ['subscription', 'company'],
  ['database', 'company'],
  ['company', 'company'],
  // Address (addresses.js), incl. tax exemptions
  ['exemption', 'address'],
  ['address', 'address'],
  // Core CRM/ERP entities
  ['invoice', 'invoice'],
  ['estimate', 'estimate'],
  ['bill', 'bill'],
  ['customer', 'customer'],
  ['contact', 'contact'],
  ['product', 'product'],
  ['vendor', 'vendor'],
  ['job', 'job'],
  ['task', 'task'],
  ['project', 'project'],
  ['workflow', 'workflow'],
];
 
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
 
  // Domain/entity heuristics
  // Handle special cases first (tools that end with _report should go to reports domain)
  if (lc.includes('_report') || lc.includes('goal') || lc.startsWith('get_report') || lc.startsWith('export_') && lc.includes('report')) {
    caps.domain = 'reports';
    caps.entity = 'reports';
  } else {
    // Ordered rule list: first match wins. Unmatched tools stay domain-less
    // (indexed as 'unknown') so misses are loud instead of landing in junk buckets.
    for (const [pattern, domain] of DOMAIN_RULES) {
      if (lc.includes(pattern)) {
        caps.domain = domain;
        caps.entity = domain;
        break;
      }
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
  if (caps.domain === 'sales_order') idFields.push('sales_order_id', 'id');
  if (caps.domain === 'deal') idFields.push('deal_id', 'id');
  if (caps.domain === 'inventory') idFields.push('warehouse_id', 'product_id', 'id');
  if (caps.domain === 'payments') idFields.push('received_payment_id', 'id');
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
 
