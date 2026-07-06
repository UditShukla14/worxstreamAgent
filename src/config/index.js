/**
 * Application Configuration
 */

import dotenv from 'dotenv';
import * as worxstreamSession from '../session/worxstreamSession.js';
import { getRequestContext } from '../request/requestContext.js';

dotenv.config();

/**
 * Build a Redis URL from discrete env vars when `REDIS_URL` is not set.
 * Used for hosted Valkey/Redis (e.g. DigitalOcean) where TLS on port 25061 is typical.
 * Usernames/passwords are URL-encoded for special characters.
 */
function buildRedisUrlFromEnv() {
  const direct = (process.env.REDIS_URL || '').trim();
  if (direct) return direct;

  const host = (process.env.REDIS_HOST || '').trim();
  if (!host) return '';

  const port = (process.env.REDIS_PORT || '6379').trim();
  const username = (process.env.REDIS_USERNAME || 'default').trim();
  const password = process.env.REDIS_PASSWORD ?? '';

  const portNum = parseInt(port, 10);
  const tlsEnv = process.env.REDIS_TLS;
  /** DO managed Valkey often uses 25061 with TLS; allow override via REDIS_TLS. */
  const useTls =
    tlsEnv === 'true' ||
    (tlsEnv !== 'false' && Number.isFinite(portNum) && portNum === 25061);

  const scheme = useTls ? 'rediss' : 'redis';
  const auth =
    password !== ''
      ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`
      : `${encodeURIComponent(username)}@`;

  return `${scheme}://${auth}${host}:${port}`;
}

/** Single Anthropic model for all calls — dateless ID, not a dated snapshot. */
const DEFAULT_MODEL = 'claude-sonnet-4-6';

/** Retired snapshot IDs → main model (auto-migrated at startup). */
const RETIRED_MODEL_MAP = {
  'claude-sonnet-4-20250514': DEFAULT_MODEL,
  'claude-opus-4-20250514': DEFAULT_MODEL,
  'claude-sonnet-4-0': DEFAULT_MODEL,
  'claude-opus-4-0': DEFAULT_MODEL,
  'claude-3-7-sonnet-20250219': DEFAULT_MODEL,
  'claude-3-5-haiku-20241022': DEFAULT_MODEL,
  'claude-3-haiku-20240307': DEFAULT_MODEL,
};

/** Pre-4.6 models use YYYYMMDD suffixes; those IDs expire when Anthropic retires the snapshot. */
const DATED_SNAPSHOT_RE = /-\d{8}$/;

/** Dateless model IDs that support tool_search_tool_bm25 (on-demand tool loading). */
const TOOL_SEARCH_SUPPORTED_MODELS = [
  'claude-sonnet-4-6',
  'claude-opus-4-6',
  'claude-opus-4-8',
  'claude-sonnet-4-5',
  'claude-opus-4-5',
  'claude-haiku-4-5',
];

/**
 * Resolve ANTHROPIC_MODEL: reject dated snapshots and map retired IDs to the main model.
 * @param {string|undefined} envValue
 */
function resolveAnthropicModel(envValue) {
  let modelId = (envValue || '').trim() || DEFAULT_MODEL;
  if (RETIRED_MODEL_MAP[modelId]) {
    console.warn(
      `⚠️  ANTHROPIC_MODEL "${modelId}" is retired; using "${DEFAULT_MODEL}". Update the env var.`
    );
    return DEFAULT_MODEL;
  }
  if (DATED_SNAPSHOT_RE.test(modelId)) {
    console.warn(
      `⚠️  ANTHROPIC_MODEL "${modelId}" is a dated snapshot; using "${DEFAULT_MODEL}". Set ANTHROPIC_MODEL to a dateless ID.`
    );
    return DEFAULT_MODEL;
  }
  return modelId;
}

const anthropicModel = resolveAnthropicModel(process.env.ANTHROPIC_MODEL);
const useToolSearchEnv = process.env.ANTHROPIC_USE_TOOL_SEARCH;

export const config = {
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    /** Sonnet 4.6 for all agent, router, formatter, and summary calls; override with ANTHROPIC_MODEL. */
    model: anthropicModel,
    /** Enabled when model supports tool search; set ANTHROPIC_USE_TOOL_SEARCH=false/true to override. */
    useToolSearch: useToolSearchEnv === 'false' ? false : useToolSearchEnv === 'true' ? true : TOOL_SEARCH_SUPPORTED_MODELS.includes(anthropicModel),
    /**
     * Centralized token limits. These are intentionally conservative defaults
     * and can be tuned via env without touching code.
     */
    maxTokens: {
      /** For specialist agent runs (tool loop). */
      agent: parseInt(process.env.ANTHROPIC_MAX_TOKENS_AGENT || '4096', 10),
      /** For OutputFormatter pass. */
      formatter: parseInt(process.env.ANTHROPIC_MAX_TOKENS_FORMATTER || '4096', 10),
      /** For router key selection. */
      router: parseInt(process.env.ANTHROPIC_MAX_TOKENS_ROUTER || '100', 10),
      /** For Nova orchestration plan. */
      nova: parseInt(process.env.ANTHROPIC_MAX_TOKENS_NOVA || '256', 10),
      /** For conversational fallback streaming in agents/stream and legacy flows. */
      conversation: parseInt(process.env.ANTHROPIC_MAX_TOKENS_CONVERSATION || '4096', 10),
      /** For conversation-only (non-stream) replies. */
      conversationShort: parseInt(process.env.ANTHROPIC_MAX_TOKENS_CONVERSATION_SHORT || '1024', 10),
    },
  },
  worxstream: {
    baseUrl: process.env.WORXSTREAM_BASE_URL || '',
    get apiToken() {
      return getWorxstreamApiToken();
    },
    get defaultCompanyId() {
      return getWorxstreamContext().companyId;
    },
    get defaultUserId() {
      return getWorxstreamContext().userId;
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
  redis: {
    /** Set REDIS_URL or REDIS_HOST/REDIS_PASSWORD/… to enable Redis-backed context/cache. */
    url: buildRedisUrlFromEnv(),
    /** Optional Redis database index. */
    db: process.env.REDIS_DB ? parseInt(process.env.REDIS_DB, 10) : undefined,
    /** Force TLS (useful for hosted Redis). */
    tls: process.env.REDIS_TLS === 'true' ? true : undefined,
    /** Allow self-signed certs if required by environment. */
    rejectUnauthorized: process.env.REDIS_TLS_REJECT_UNAUTHORIZED === 'false' ? false : undefined,
    /** ConversationContext TTL in seconds (default 30 minutes). */
    contextTtlSeconds: parseInt(process.env.REDIS_CONTEXT_TTL_SECONDS || '1800', 10),
    /** Optional tool cache TTL in seconds (default 60 seconds). */
    cacheTtlSeconds: parseInt(process.env.REDIS_CACHE_TTL_SECONDS || '60', 10),
  },
  contextWindow: {
    maxMessages: parseInt(process.env.MAX_CONTEXT_MESSAGES || '50', 10),
    maxTokens: parseInt(process.env.MAX_CONTEXT_TOKENS || '150000', 10),
    reserveTokens: parseInt(process.env.RESERVE_TOKENS || '10000', 10),
    /** Specialist agents: only the last N stored messages (user+assistant pairs). */
    specialistMaxMessages: parseInt(process.env.SPECIALIST_CONTEXT_MESSAGES || '6', 10),
    specialistMaxTokens: parseInt(process.env.SPECIALIST_CONTEXT_TOKENS || '12000', 10),
    specialistReserveTokens: parseInt(process.env.SPECIALIST_RESERVE_TOKENS || '4000', 10),
    specialistMessagesActive: parseInt(process.env.SPECIALIST_CONTEXT_MESSAGES_ACTIVE || '12', 10),
  },
  agentRuntime: {
    /** Safety cap to prevent infinite tool loops. */
    maxToolIterations: parseInt(process.env.AGENT_MAX_TOOL_ITERATIONS || '15', 10),
    /** When user asks for \"all\", how many additional pages to auto-fetch. */
    maxAutoPages: parseInt(process.env.AGENT_MAX_AUTO_PAGES || '10', 10),
    /** Legacy chat loop iteration cap (if used). */
    maxLegacyIterations: parseInt(process.env.CHAT_MAX_ITERATIONS || '20', 10),
    /** After agents run, how many self-check retry loops are allowed. */
    maxSelfCheckLoops: parseInt(process.env.AGENTS_SELF_CHECK_MAX_LOOPS || '1', 10),
  },
  coworker: {
    confirmWrites: process.env.COWORKER_CONFIRM_WRITES === 'true',
    summaryEveryN: parseInt(process.env.CONVERSATION_SUMMARY_EVERY_N || '10', 10),
    workingMemoryLlmEveryN: parseInt(process.env.WORKING_MEMORY_LLM_EVERY_N || '0', 10),
    specialistMessagesActive: parseInt(process.env.SPECIALIST_CONTEXT_MESSAGES_ACTIVE || '12', 10),
    pendingConfirmTtlSeconds: parseInt(process.env.COWORKER_PENDING_CONFIRM_TTL || '300', 10),
  },
};

/**
 * Worxstream API credentials, resolved per field with this precedence:
 *   1. Per-request context (AsyncLocalStorage, set by requestContextMiddleware
 *      from request body/headers) — safe under concurrent multi-tenant requests.
 *   2. In-memory session (POST /session) — single global session per process.
 *   3. .env fallbacks (DEFAULT_COMPANY_ID / DEFAULT_USER_ID / WORXSTREAM_API_TOKEN).
 */
function resolveWorxstreamCredentials() {
  const req = getRequestContext() || {};
  const s = worxstreamSession.getSession() || {};
  return {
    companyId: req.companyId || s.companyId || process.env.DEFAULT_COMPANY_ID || '1',
    userId: req.userId || s.userId || process.env.DEFAULT_USER_ID || '1',
    apiToken: req.apiToken || s.apiToken || process.env.WORXSTREAM_API_TOKEN || '',
  };
}

/** API token for Worxstream HTTP client — session, then WORXSTREAM_API_TOKEN. */
export function getWorxstreamApiToken() {
  const { apiToken } = resolveWorxstreamCredentials();
  return apiToken || process.env.WORXSTREAM_API_TOKEN || '';
}

/** companyId / userId for MCP tool calls — session, then DEFAULT_* env vars. */
export function getWorxstreamContext() {
  const { companyId, userId } = resolveWorxstreamCredentials();
  return { companyId, userId };
}

/** Default tenant for Mongo/Redis when the client omits companyId/userId. */
export function getDefaultTenantIds() {
  return getWorxstreamContext();
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
  if (config.redis.url) {
    const ttl = config.redis.contextTtlSeconds;
    if (!Number.isFinite(ttl) || ttl <= 0) {
      console.warn('⚠️  REDIS_CONTEXT_TTL_SECONDS is invalid; using default behavior may be unexpected');
    }
  }
}
