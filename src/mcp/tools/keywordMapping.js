/**
 * Keyword-to-Tool Mapping System
 * 
 * Maps keywords (e.g., @customer, @product) to specific tool names
 * to enable filtered tool selection for better performance.
 */

const KEYWORD_TO_TOOLS = {
  '@customer': [
    'list_customers',
    'get_customer_details',
    'update_customer',
    'get_customer_dropdown',
  ],
  
  '@contact': [
    'list_contacts',
    'get_contact_details',
    'create_contact',
    'update_contact',
    'delete_contact',
    'clone_contact',
    'quick_update_contact',
  ],
  
  '@product': [
    'list_product_categories',
    'create_product_category',
    'update_product_category',
    'list_product_subcategories',
    'create_product_subcategory',
    'list_products',
    'get_product_details',
    'create_product',
    'update_product',
    'delete_product',
    'clone_product',
    'get_products_dropdown',
    'get_system_finder_options',
    'get_system_finder_matchup_products',
  ],
  
  '@systemfinder': [
    'get_system_finder_options',
    'get_system_finder_matchup_products',
  ],
  
  '@vendor': [
    'list_vendors',
    'get_vendor_details',
    'update_vendor',
  ],
  
  '@invoice': [
    'list_invoices',
    'get_invoice_details',
    'create_invoice',
  ],
  
  '@estimate': [
    'list_estimates',
    'get_estimate_details',
    'create_estimate',
  ],
  
  '@job': [
    'list_jobs',
    'get_job_details',
    'create_job',
  ],
  
  '@task': [
    'list_tasks',
    'get_task_details',
    'create_task',
  ],
  
  '@project': [
    'list_projects',
    'get_project_details',
    'create_project',
    'update_project',
    'delete_project',
    'clone_project',
  ],
  
  '@workflow': [
    'get_workflow_initial_data',
    'list_workflows',
    'get_workflows_by_object',
    'get_workflow_object_tree',
    'link_workflow_nodes',
    'create_workflow_node',
    'update_workflow',
    'cancel_workflow',
  ],
  
  '@company': [
    'get_company_details',
    'get_company_status',
    'get_company_statistics',
    'get_company_initial_data',
    'list_branches',
    'create_branch',
    'update_branch',
    'delete_branch',
  ],
  
  '@hr': [
    'list_departments',
    'get_department',
    'create_department',
    'get_department_hierarchy',
    'get_department_statistics',
    'list_teams',
    'get_team',
    'create_team',
    'get_team_statistics',
    'get_teams_by_department',
    'list_team_members',
    'get_team_members_dropdown',
    'get_team_member',
    'get_hr_statistics',
  ],
  
  '@finance': [
    'list_taxes',
    'get_tax_dropdown',
    'create_tax',
    'list_chart_of_accounts',
    'get_chart_of_accounts_dropdown',
    'create_chart_of_account',
    'list_payment_instructions',
    'get_payment_instructions_dropdown',
    'list_signatures',
    'get_signatures_dropdown',
  ],
  
  '@config': [
    'list_addresses',
    'get_address',
    'create_address',
    'get_dropdown_configs',
    'get_dropdown_values',
    'get_column_configs',
    'get_all_apps',
    'get_menus',
    'get_forms',
    'get_country_codes',
  ],
  
  '@subscription': [
    'list_subscriptions',
    'get_active_subscriptions',
  ],
  
  '@price': [
    'compare_stock_prices',
  ],
  
  '@compare': [
    'compare_stock_prices',
  ],
};

// Reverse mapping: tool name to keywords (for debugging/logging)
const TOOL_TO_KEYWORDS = {};
Object.entries(KEYWORD_TO_TOOLS).forEach(([keyword, tools]) => {
  tools.forEach(tool => {
    if (!TOOL_TO_KEYWORDS[tool]) {
      TOOL_TO_KEYWORDS[tool] = [];
    }
    TOOL_TO_KEYWORDS[tool].push(keyword);
  });
});

/**
 * Extract keywords from user message
 * @param {string} message - User message
 * @returns {string[]} Array of detected keywords (without @)
 */
export function extractKeywords(message) {
  if (!message || typeof message !== 'string') {
    return [];
  }
  
  const keywords = [];
  const keywordPattern = /@(\w+)/g;
  let match;
  
  while ((match = keywordPattern.exec(message)) !== null) {
    const keyword = `@${match[1].toLowerCase()}`;
    if (KEYWORD_TO_TOOLS[keyword]) {
      keywords.push(keyword);
    }
  }
  
  return [...new Set(keywords)]; // Remove duplicates
}

/** Greetings and short conversational phrases that don't need tools (token-efficient: send 0 tools) */
const CONVERSATIONAL_PHRASES = new Set([
  'hi', 'hello', 'hey', 'hey there', 'hi there', 'hello there',
  'thanks', 'thank you', 'thx', 'ok', 'okay', 'sure', 'yes', 'no',
  'good morning', 'good afternoon', 'good evening', 'good night',
  'how are you', 'what can you do', 'help', 'what do you do',
  'who are you', 'intro', 'introduction',
]);

/** Task-related verbs that suggest the user wants to use tools */
const TASK_VERBS = /\b(list|show|get|find|search|create|add|update|edit|delete|remove|view|fetch|compare|convert|copy|release)\b/i;

/**
 * Detect if the message is purely conversational (greeting, thanks, etc.) and does not need tools.
 * Used for token-efficient tool use: send 0 tools for these so we don't pay for 171 tool definitions.
 * @param {string} message - User message
 * @returns {boolean} True if message is conversational only and tools can be omitted
 */
export function isConversationalOnly(message) {
  if (!message || typeof message !== 'string') {
    return true;
  }
  const trimmed = message.trim();
  if (trimmed.length === 0) return true;
  // Very short message that matches a known conversational phrase
  const lower = trimmed.toLowerCase();
  if (CONVERSATIONAL_PHRASES.has(lower)) {
    return true;
  }
  // Short message (e.g. under 30 chars) with no task verb → likely chitchat
  if (trimmed.length < 30 && !TASK_VERBS.test(trimmed)) {
    return true;
  }
  return false;
}

/**
 * Get tool names for given keywords
 * @param {string[]} keywords - Array of keywords (e.g., ['@customer', '@invoice'])
 * @returns {string[]|null} Array of tool names, or null if no keywords (means use all tools)
 */
export function getToolsForKeywords(keywords) {
  if (!keywords || keywords.length === 0) {
    return null; // Return null means use all tools
  }
  
  const toolSet = new Set();
  keywords.forEach(keyword => {
    const tools = KEYWORD_TO_TOOLS[keyword];
    if (tools) {
      tools.forEach(tool => toolSet.add(tool));
    }
  });
  
  return Array.from(toolSet);
}

/**
 * Get all available keywords
 * @returns {string[]} Array of all supported keywords
 */
export function getAvailableKeywords() {
  return Object.keys(KEYWORD_TO_TOOLS);
}

/**
 * Get keyword for a specific tool (for debugging)
 * @param {string} toolName - Tool name
 * @returns {string[]} Array of keywords associated with the tool
 */
export function getKeywordsForTool(toolName) {
  return TOOL_TO_KEYWORDS[toolName] || [];
}

export { KEYWORD_TO_TOOLS, TOOL_TO_KEYWORDS };

