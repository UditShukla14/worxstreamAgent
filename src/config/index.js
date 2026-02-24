/**
 * Application Configuration
 */

import dotenv from 'dotenv';
dotenv.config();

/** Model IDs that support tool_search_tool_bm25 (on-demand tool loading). GA Feb 2026. */
const TOOL_SEARCH_SUPPORTED_MODELS = [
  'claude-sonnet-4-6',
  'claude-opus-4-6',
  'claude-sonnet-4-5-20250929',
  'claude-opus-4-5-20251101',
  'claude-haiku-4-5-20251001',
];

const anthropicModel = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
const useToolSearchEnv = process.env.ANTHROPIC_USE_TOOL_SEARCH;

export const config = {
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    /** Default to Sonnet 4.6 for tool search support; override with ANTHROPIC_MODEL. */
    model: anthropicModel,
    /** Enabled when model supports tool search; set ANTHROPIC_USE_TOOL_SEARCH=false/true to override. */
    useToolSearch: useToolSearchEnv === 'false' ? false : useToolSearchEnv === 'true' ? true : TOOL_SEARCH_SUPPORTED_MODELS.includes(anthropicModel),
  },
  worxstream: {
    baseUrl: process.env.WORXSTREAM_BASE_URL || 'https://api.worxstream.io',
    apiToken: process.env.WORXSTREAM_API_TOKEN,
    defaultCompanyId: process.env.DEFAULT_COMPANY_ID || '1',
    defaultUserId: process.env.DEFAULT_USER_ID || '1',
  },
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    env: process.env.NODE_ENV || 'development',
    publicUrl: process.env.BACKEND_URL || process.env.PUBLIC_URL || 'https://mcp.worxstream.io',
  },
  database: {
    url: process.env.MONGODB_URL || 'mongodb+srv://doadmin:94f0Pq2rX1768uKe@db-mongodb-nyc1-38465-c4ba6c32.mongo.ondigitalocean.com/?authSource=admin',
  },
  contextWindow: {
    maxMessages: parseInt(process.env.MAX_CONTEXT_MESSAGES || '50', 10),
    maxTokens: parseInt(process.env.MAX_CONTEXT_TOKENS || '150000', 10),
    reserveTokens: parseInt(process.env.RESERVE_TOKENS || '10000', 10),
  },
};

// Validation
export function validateConfig() {
  const errors = [];

  if (!config.anthropic.apiKey) {
    errors.push('ANTHROPIC_API_KEY is required');
  }

  if (!config.worxstream.apiToken) {
    console.warn('⚠️  WORXSTREAM_API_TOKEN not set - API calls will fail');
  }

  if (errors.length > 0) {
    console.error('❌ Configuration errors:');
    errors.forEach(err => console.error(`   - ${err}`));
    process.exit(1);
  }
}
