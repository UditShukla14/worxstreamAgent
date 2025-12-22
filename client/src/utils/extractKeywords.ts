/**
 * Extract keywords from user message
 * Matches the backend keyword extraction logic
 */

const VALID_KEYWORDS = [
  '@customer',
  '@contact',
  '@product',
  '@vendor',
  '@invoice',
  '@estimate',
  '@job',
  '@task',
  '@workflow',
  '@company',
  '@hr',
  '@finance',
  '@config',
  '@subscription',
];

/**
 * Extract keywords from a message string
 * @param message - User message
 * @returns Array of detected keywords
 */
export function extractKeywords(message: string): string[] {
  if (!message || typeof message !== 'string') {
    return [];
  }
  
  const keywords: string[] = [];
  const keywordPattern = /@(\w+)/g;
  let match;
  
  while ((match = keywordPattern.exec(message)) !== null) {
    const keyword = `@${match[1].toLowerCase()}`;
    if (VALID_KEYWORDS.includes(keyword)) {
      keywords.push(keyword);
    }
  }
  
  return [...new Set(keywords)]; // Remove duplicates
}

/**
 * Get display name for a keyword
 * @param keyword - Keyword (e.g., '@customer')
 * @returns Display name (e.g., 'Customer')
 */
export function getKeywordDisplayName(keyword: string): string {
  const displayNames: Record<string, string> = {
    '@customer': 'Customer',
    '@contact': 'Contact',
    '@product': 'Product',
    '@vendor': 'Vendor',
    '@invoice': 'Invoice',
    '@estimate': 'Estimate',
    '@job': 'Job',
    '@task': 'Task',
    '@workflow': 'Workflow',
    '@company': 'Company',
    '@hr': 'HR',
    '@finance': 'Finance',
    '@config': 'Config',
    '@subscription': 'Subscription',
  };
  
  return displayNames[keyword] || keyword;
}

/**
 * Get color for a keyword badge
 * @param keyword - Keyword (e.g., '@customer')
 * @returns Color class name
 */
export function getKeywordColor(keyword: string): string {
  const colors: Record<string, string> = {
    '@customer': 'keyword-customer',
    '@contact': 'keyword-contact',
    '@product': 'keyword-product',
    '@vendor': 'keyword-vendor',
    '@invoice': 'keyword-invoice',
    '@estimate': 'keyword-estimate',
    '@job': 'keyword-job',
    '@task': 'keyword-task',
    '@workflow': 'keyword-workflow',
    '@company': 'keyword-company',
    '@hr': 'keyword-hr',
    '@finance': 'keyword-finance',
    '@config': 'keyword-config',
    '@subscription': 'keyword-subscription',
  };
  
  return colors[keyword] || 'keyword-default';
}

