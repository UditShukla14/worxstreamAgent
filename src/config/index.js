/**
 * Application Configuration
 */

import dotenv from 'dotenv';
import * as worxstreamSession from '../session/worxstreamSession.js';

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
    baseUrl: process.env.WORXSTREAM_BASE_URL || '',
    get apiToken() {
      const s = worxstreamSession.getSession();
      return s ? s.apiToken : process.env.WORXSTREAM_API_TOKEN;
    },
    get defaultCompanyId() {
      const s = worxstreamSession.getSession();
      return s ? s.companyId : (process.env.DEFAULT_COMPANY_ID || '1');
    },
    get defaultUserId() {
      const s = worxstreamSession.getSession();
      return s ? s.userId : (process.env.DEFAULT_USER_ID || '1');
    },
  },
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    env: process.env.NODE_ENV || 'development',
    publicUrl: (() => {
      const url = process.env.BACKEND_URL || process.env.PUBLIC_URL;
      if (url) return url;
      const port = parseInt(process.env.PORT || '3000', 10);
      return process.env.NODE_ENV === 'production' ? '' : `http://localhost:${port}`;
    })(),
    /** Comma-separated list of allowed CORS origins */
    corsOrigins: process.env.CORS_ORIGINS || '',
  },
  database: {
    url: process.env.MONGODB_URL || '',
  },
  contextWindow: {
    maxMessages: parseInt(process.env.MAX_CONTEXT_MESSAGES || '50', 10),
    maxTokens: parseInt(process.env.MAX_CONTEXT_TOKENS || '150000', 10),
    reserveTokens: parseInt(process.env.RESERVE_TOKENS || '10000', 10),
  },
};

/** Resolve current Worxstream context (session or .env). Call at invocation time, not at module load. */
export function getWorxstreamContext() {
  return {
    companyId: config.worxstream.defaultCompanyId,
    userId: config.worxstream.defaultUserId,
  };
}

// Validation
export function validateConfig() {
  const errors = [];
  const isProduction = process.env.NODE_ENV === 'production';

  if (!config.anthropic.apiKey) {
    errors.push('ANTHROPIC_API_KEY is required');
  }
  if (!config.worxstream.baseUrl) {
    errors.push('WORXSTREAM_BASE_URL is required');
  }
  if (!config.database.url) {
    errors.push('MONGODB_URL is required');
  }
  if (errors.length > 0) {
    console.error('❌ Configuration errors:');
    errors.forEach(err => console.error(`   - ${err}`));
    process.exit(1);
  }

  if (!process.env.WORXSTREAM_API_TOKEN) {
    console.warn('⚠️  WORXSTREAM_API_TOKEN not set - set via .env or POST /session after login');
  }
  if (isProduction && !config.server.corsOrigins) {
    console.warn('⚠️  CORS_ORIGINS not set - set in .env for production (comma-separated origins)');
  }
  if (isProduction && !(process.env.BACKEND_URL || process.env.PUBLIC_URL)) {
    console.warn('⚠️  BACKEND_URL or PUBLIC_URL not set - set in .env for production');
  }
}
