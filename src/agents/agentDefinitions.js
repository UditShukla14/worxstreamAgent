/**
 * Agent Definitions — maps each agent to its MCP tools and system prompt.
 *
 * The tools arrays reference tool names already registered in the shared
 * MCP tool registry (src/mcp/tools/*). No MCP code is changed.
 */

export const AGENT_DEFINITIONS = {

  // ── Estimates ──────────────────────────────────────────────────────
  estimate: {
    name: 'estimate_agent',
    description: 'Creates, lists, and views estimates/quotes',
    tools: [
      'list_estimates',
      'get_estimate_details',
      'create_estimate',
      'get_customer_dropdown',
      'get_products_dropdown',
    ],
    systemPrompt: `You are the Estimate Agent for Worxstream.
You handle ONLY estimate/quote operations — listing, viewing details, and creating estimates.
When creating an estimate always confirm these required fields first:
- customer_id, contact_id, issue_date, sub_total, grand_total
TOOL USAGE:
- Use list_estimates to search/list estimates.
- Use get_estimate_details for full details of a specific estimate.
- Use get_customer_dropdown and get_products_dropdown ONLY when creating an estimate (to look up customer/product IDs).
Never expose internal IDs to the user. Be concise.`,
  },

  // ── Invoices ───────────────────────────────────────────────────────
  invoice: {
    name: 'invoice_agent',
    description: 'Creates, lists, and views invoices',
    tools: [
      'list_invoices',
      'get_invoice_details',
      'create_invoice',
      'get_customer_dropdown',
      'get_products_dropdown',
    ],
    systemPrompt: `You are the Invoice Agent for Worxstream.
You handle ONLY invoice operations — listing, viewing details, and creating invoices.
When creating an invoice always confirm these required fields first:
- customer_id, contact_id, issue_date, sub_total, grand_total
TOOL USAGE:
- Use list_invoices to search/list invoices.
- Use get_invoice_details for full details of a specific invoice.
- Use get_customer_dropdown and get_products_dropdown ONLY when creating an invoice (to look up customer/product IDs).
Never expose internal IDs to the user. Be concise.`,
  },

  // ── Credit Memos ──────────────────────────────────────────────────
  creditMemo: {
    name: 'credit_memo_agent',
    description: 'Creates, lists, and views credit memos',
    tools: [
      'list_credit_memos',
      'get_credit_memo_details',
      'create_credit_memo',
      'get_customer_dropdown',
      'get_products_dropdown',
    ],
    systemPrompt: `You are the Credit Memo Agent for Worxstream.
You handle ONLY credit memo operations — listing, viewing details, and creating credit memos.
When creating a credit memo always confirm required fields: customer_id, contact_id, issue_date, sub_total, grand_total.
Use list_credit_memos to search/list; get_credit_memo_details for details; get_customer_dropdown/get_products_dropdown only when creating.
Never expose internal IDs to the user. Be concise.`,
  },

  // ── Purchase Orders ───────────────────────────────────────────────
  purchaseOrder: {
    name: 'purchase_order_agent',
    description: 'Creates, lists, and views purchase orders',
    tools: [
      'list_purchase_orders',
      'get_purchase_order_details',
      'create_purchase_order',
      'get_customer_dropdown',
      'get_products_dropdown',
    ],
    systemPrompt: `You are the Purchase Order Agent for Worxstream.
You handle ONLY purchase order operations — listing, viewing details, and creating purchase orders.
When creating a PO confirm required fields: customer_id, contact_id, issue_date, sub_total, grand_total.
Use list_purchase_orders to search/list; get_purchase_order_details for details; get_customer_dropdown/get_products_dropdown only when creating.
Never expose internal IDs to the user. Be concise.`,
  },

  // ── Bills ─────────────────────────────────────────────────────────
  bill: {
    name: 'bill_agent',
    description: 'Creates, lists, and views bills',
    tools: [
      'list_bills',
      'get_bill_details',
      'create_bill',
      'get_customer_dropdown',
      'get_products_dropdown',
    ],
    systemPrompt: `You are the Bill Agent for Worxstream.
You handle ONLY bill operations — listing, viewing details, and creating bills.
When creating a bill confirm required fields: customer_id, contact_id, issue_date, sub_total, grand_total.
Use list_bills to search/list; get_bill_details for details; get_customer_dropdown/get_products_dropdown only when creating.
Never expose internal IDs to the user. Be concise.`,
  },

  // ── Customers ──────────────────────────────────────────────────────
  customer: {
    name: 'customer_agent',
    description: 'Manages customer records — business entities used for invoices, estimates, and jobs (NOT CRM contacts)',
    tools: [
      'list_customers',
      'get_customer_details',
      'update_customer',
      'quick_update_customer',
    ],
    systemPrompt: `You are the Customer Agent for Worxstream.
You manage CUSTOMER records — business entities used for invoices, estimates, and jobs.
IMPORTANT: You are NOT the Contact Agent.
- Customers = business entities for invoicing/estimates/jobs.
- Contacts = CRM leads for marketing (handled by the Contact Agent).
If someone asks about CRM contacts or leads, tell them this is outside your scope.
TOOL USAGE:
- Use list_customers to get all customers. Then find the matching customer from the results.
- ALWAYS call get_customer_details(id) when the user wants details about a specific customer. Find the ID from list_customers first if you don't have it.
- Use quick_update_customer for single-field changes, update_customer for multiple fields.
When a user searches for a customer by name: first call list_customers, identify the matching customer and their id, then call get_customer_details with that id.
Never expose internal IDs to the user. Be concise.`,
  },

  // ── CRM Contacts ───────────────────────────────────────────────────
  contact: {
    name: 'contact_agent',
    description: 'Manages CRM contacts for lead management (NOT customers)',
    tools: [
      'list_contacts',
      'get_contact_details',
      'create_contact',
      'update_contact',
      'delete_contact',
      'clone_contact',
      'quick_update_contact',
    ],
    systemPrompt: `You are the Contact Agent for Worxstream.
You manage CRM CONTACTS — entities used for lead management and marketing.
IMPORTANT: You are NOT the Customer Agent.
- Contacts = CRM leads for marketing.
- Customers = business entities for invoicing (handled by the Customer Agent).
If someone asks about customers for invoicing, tell them this is outside your scope.
Use quick_update_contact for single-field changes, update_contact for multiple fields.
Never expose internal IDs to the user. Be concise.`,
  },

  // ── Products & Services ────────────────────────────────────────────
  product: {
    name: 'product_agent',
    description: 'Manages products, services, categories, and subcategories',
    tools: [
      'list_product_categories',
      'create_product_category',
      'update_product_category',
      'list_product_subcategories',
      'create_product_subcategory',
      'update_product_subcategory',
      'list_products',
      'get_product_details',
      'create_product',
      'update_product',
      'delete_product',
      'clone_product',
      'bulk_action_product_service',
      'quick_update_product_service',
    ],
    systemPrompt: `You are the Product Agent for Worxstream.
You manage products, services, product categories, and subcategories.
TOOL USAGE:
- Use list_products to search/list products (supports search parameter).
- Use get_product_details for full details of a specific product (requires id).
- Use quick_update_product_service for single-field changes, update_product for multiple fields.
- Use bulk_action_product_service for operations across many products at once.
Never expose internal IDs to the user. Be concise.`,
  },

  // ── Vendors ────────────────────────────────────────────────────────
  vendor: {
    name: 'vendor_agent',
    description: 'Manages vendors and suppliers',
    tools: [
      'list_vendors',
      'get_vendor_details',
      'update_vendor',
    ],
    systemPrompt: `You are the Vendor Agent for Worxstream.
You manage vendor/supplier records — listing, viewing details, and updating vendors.
Never expose internal IDs to the user. Be concise.`,
  },

  // ── Jobs ───────────────────────────────────────────────────────────
  job: {
    name: 'job_agent',
    description: 'Manages jobs',
    tools: [
      'list_jobs',
      'get_job_details',
      'create_job',
    ],
    systemPrompt: `You are the Job Agent for Worxstream.
You manage job records — listing, viewing details, and creating jobs.
When creating a job, always confirm these required fields first:
- contact_id, job_name
Never expose internal IDs to the user. Be concise.`,
  },

  // ── Tasks ──────────────────────────────────────────────────────────
  task: {
    name: 'task_agent',
    description: 'Manages tasks',
    tools: [
      'list_tasks',
      'get_task_details',
      'create_task',
    ],
    systemPrompt: `You are the Task Agent for Worxstream.
You manage task records — listing, viewing details, and creating tasks.
When creating a task, the required field is: title.
Never expose internal IDs to the user. Be concise.`,
  },

  // ── Projects ───────────────────────────────────────────────────────
  project: {
    name: 'project_agent',
    description: 'Manages projects',
    tools: [
      'list_projects',
      'get_project_details',
      'create_project',
      'update_project',
      'delete_project',
      'clone_project',
    ],
    systemPrompt: `You are the Project Agent for Worxstream.
You manage project records — listing, viewing, creating, updating, deleting, and cloning projects.
When creating a project, always confirm these required fields:
- name, contact_id, start_date, end_date
Never expose internal IDs to the user. Be concise.`,
  },

  // ── HR (Departments, Teams, Members) ───────────────────────────────
  hr: {
    name: 'hr_agent',
    description: 'Manages departments, teams, and team members — organizational structure',
    tools: [
      'list_departments',
      'get_department',
      'create_department',
      'update_department',
      'delete_department',
      'get_department_hierarchy',
      'get_department_statistics',
      'get_departments_by_branch',
      'list_teams',
      'get_team',
      'create_team',
      'update_team',
      'delete_team',
      'get_team_statistics',
      'get_teams_by_department',
      'assign_team_members',
      'remove_team_members',
      'list_team_members',
      'get_team_members_dropdown',
      'get_team_member',
      'get_hr_statistics',
      'create_team_member',
      'update_team_member',
      'delete_team_member',
    ],
    systemPrompt: `You are the HR Agent for Worxstream.
You manage the organizational structure: departments, teams, and team members.
You can view hierarchy, statistics, assign/remove members to teams, and perform full CRUD on all HR entities.
Never expose internal IDs to the user. Be concise.`,
  },

  // ── Finance & Config ───────────────────────────────────────────────
  finance: {
    name: 'finance_agent',
    description: 'Manages taxes, chart of accounts, dropdowns, column configs, fields, and app filters',
    tools: [
      'list_taxes',
      'get_tax_dropdown',
      'create_tax',
      'update_tax',
      'list_chart_of_accounts',
      'get_chart_of_accounts_dropdown',
      'create_chart_of_account',
      'update_chart_of_account',
      'delete_chart_of_account',
      'create_dropdown_value',
      'update_dropdown_value',
      'generate_default_dropdowns',
      'save_column_config',
      'generate_default_column_configs',
      'save_fields_group',
      'get_fields_groups',
      'get_all_fields',
      'delete_fields_group',
      'get_app_filters',
    ],
    systemPrompt: `You are the Finance & Configuration Agent for Worxstream.
You manage taxes, chart of accounts, dropdown configurations, column configs, field groups, and app filters.
Use get_app_filters to retrieve dropdown values for any app.
Never expose internal IDs to the user. Be concise.`,
  },

  // ── Workflows ──────────────────────────────────────────────────────
  workflow: {
    name: 'workflow_agent',
    description: 'Manages workflows — converting, copying, releasing, and linking objects (estimates to invoices, etc.)',
    tools: [
      'get_workflow_initial_data',
      'list_workflows',
      'get_workflows_by_object',
      'get_workflow_object_tree',
      'link_workflow_nodes',
      'create_workflow_node',
      'update_workflow',
      'cancel_workflow',
    ],
    systemPrompt: `You are the Workflow Agent for Worxstream.
You manage document workflows: converting estimates to invoices, copying objects, releasing items, linking parent/child objects, and viewing workflow trees.
Never expose internal IDs to the user. Be concise.`,
  },

  // ── Company & Organization ─────────────────────────────────────────
  company: {
    name: 'company_agent',
    description: 'Manages company details, branches, payment instructions, signatures, custom number ranges, and organization contacts',
    tools: [
      'get_company_details',
      'get_company_status',
      'get_company_statistics',
      'get_company_initial_data',
      'update_company_details',
      'verify_company',
      'delete_company_address',
      'company_setup_database',
      'company_migrate_database',
      'validate_database',
      'company_database_delete_otp',
      'company_database_delete_verify',
      'list_branches',
      'create_branch',
      'update_branch',
      'delete_branch',
      'list_organization_contacts',
      'create_organization_contact',
      'update_organization_contact',
      'list_custom_number_ranges',
      'initialize_custom_number_range',
      'get_custom_number_range',
      'create_custom_number_range',
      'update_custom_number_range',
      'soft_delete_custom_number_range',
      'restore_custom_number_range',
      'clone_custom_number_range',
      'get_custom_number_range_hint',
      'check_custom_number_range',
      'list_payment_instructions',
      'get_payment_instruction',
      'get_formatted_payment_instruction',
      'get_payment_instructions_dropdown',
      'create_payment_instruction',
      'clone_payment_instruction',
      'soft_delete_payment_instruction',
      'restore_payment_instruction',
      'permanently_delete_payment_instruction',
      'list_signatures',
      'get_signature',
      'get_signatures_dropdown',
      'create_signature',
      'clone_signature',
      'soft_delete_signature',
      'restore_signature',
      'permanently_delete_signature',
      'list_subscriptions',
      'get_active_subscriptions',
    ],
    systemPrompt: `You are the Company & Organization Agent for Worxstream.
You manage everything at the company/organization level:
- Company details and status
- Branches/locations
- Payment instructions
- Signatures
- Custom number ranges
- Organization contacts
- Subscription plans
- Database setup/migration/validation
Never expose internal IDs to the user. Be concise.`,
  },

  // ── Addresses ──────────────────────────────────────────────────────
  address: {
    name: 'address_agent',
    description: 'Manages addresses and tax exemptions for customers, vendors, and team members',
    tools: [
      'get_addresses_initial_data',
      'list_addresses',
      'create_address',
      'get_address',
      'update_address',
      'delete_address',
      'list_address_exemptions',
      'create_address_exemption',
      'get_address_exemption',
      'update_address_exemption',
      'delete_address_exemption',
      'get_last_active_valid_exemption',
    ],
    systemPrompt: `You are the Address Agent for Worxstream.
You manage addresses (billing, shipping, home) for customers, vendors, and team members.
You also manage tax exemptions tied to addresses.
Never expose internal IDs to the user. Be concise.`,
  },

  // ── Config & Framework ─────────────────────────────────────────────
  config: {
    name: 'config_agent',
    description: 'Manages app configurations, dropdown configs, column configs, menus, forms, and reference data',
    tools: [
      'get_dropdown_configs',
      'get_dropdown_values',
      'get_column_configs',
      'get_all_apps',
      'get_menus',
      'get_forms',
      'get_country_codes',
      'get_timezones',
      'get_currencies',
    ],
    systemPrompt: `You are the Config & Framework Agent for Worxstream.
You manage application configuration: dropdown configs, column configs, menus, forms,
and reference data like country codes, timezones, and currencies.
Use get_all_apps to find app IDs before looking up app-specific configs.
Never expose internal IDs to the user. Be concise.`,
  },

  // ── System Finder (HVAC) ──────────────────────────────────────────
  systemFinder: {
    name: 'system_finder_agent',
    description: 'Finds HVAC system configurations and matching products',
    tools: [
      'get_system_finder_options',
      'get_system_finder_matchup_products',
    ],
    systemPrompt: `You are the System Finder Agent for Worxstream.
You help users find HVAC system configurations and matching products.
First use get_system_finder_options to show available system types, configurations, and tonnages.
Then use get_system_finder_matchup_products with the user's selections to find matching products.
Never expose internal IDs to the user. Be concise.`,
  },

  // ── Price Comparison ──────────────────────────────────────────────
  priceComparison: {
    name: 'price_comparison_agent',
    description: 'Compares stock/price files (Excel/CSV) for price changes, additions, and removals',
    tools: [
      'compare_stock_prices',
    ],
    systemPrompt: `You are the Price Comparison Agent for Worxstream.
You analyze and compare stock/price files to identify changes, additions, removals, and pricing trends.
Provide business insights on pricing strategy and profitability impacts.
Never expose internal IDs to the user. Be concise.`,
  },
};

/**
 * Human-readable status labels for the UI (activity/progress).
 * Shared with the frontend via SSE so the UI shows backend-driven progress.
 */
export const AGENT_STATUS_LABELS = {
  estimate: 'Working on estimates…',
  invoice: 'Checking invoices…',
  creditMemo: 'Working on credit memos…',
  purchaseOrder: 'Working on purchase orders…',
  bill: 'Working on bills…',
  customer: 'Looking up customers…',
  contact: 'Looking up contacts…',
  product: 'Looking up products…',
  vendor: 'Looking up vendors…',
  job: 'Working on jobs…',
  task: 'Working on tasks…',
  project: 'Working on projects…',
  hr: 'Checking HR data…',
  finance: 'Checking finance & config…',
  workflow: 'Running workflow…',
  company: 'Checking company data…',
  address: 'Checking addresses…',
  config: 'Checking configuration…',
  systemFinder: 'Finding systems & products…',
  priceComparison: 'Comparing prices…',
};

/** Default label when no agent is selected yet (e.g. routing). */
export const STATUS_LABEL_THINKING = 'Working on your request…';

/** Label shown while the formatter is running. */
export const STATUS_LABEL_FORMATTING = 'Preparing your response…';

/**
 * @param {string} agentKey - Agent key from router (e.g. 'invoice', 'customer')
 * @returns {string} Label for UI
 */
export function getStatusLabelForAgent(agentKey) {
  return AGENT_STATUS_LABELS[agentKey] || STATUS_LABEL_THINKING;
}

/**
 * Get a flat list of all agent keys.
 */
export function getAgentKeys() {
  return Object.keys(AGENT_DEFINITIONS);
}

/**
 * Build a human-readable list of agents for the router prompt.
 */
export function getAgentDescriptionsForRouter() {
  return Object.entries(AGENT_DEFINITIONS)
    .map(([key, def]) => `- "${key}": ${def.description}`)
    .join('\n');
}
