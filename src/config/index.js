/**
 * Application Configuration
 */

import dotenv from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { buildWorxstreamContext } from '../utils/worxstreamCredentials.js';

const agentRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: join(agentRoot, '.env') });
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

/** Default self-hosted model id (vLLM --served-model-name). */
const DEFAULT_LLM_MODEL = 'openai/gpt-oss-120b';

/**
 * Read int env with optional legacy Anthropic_* fallback during migration.
 * @param {string} primary
 * @param {string} legacy
 * @param {string} fallback
 */
function envInt(primary, legacy, fallback) {
  const raw = process.env[primary] || process.env[legacy] || fallback;
  return parseInt(raw, 10);
}

/**
 * @param {string} primary
 * @param {string} legacy
 * @param {string} fallback
 */
function envFloat(primary, legacy, fallback) {
  const raw = process.env[primary] || process.env[legacy] || fallback;
  return parseFloat(raw);
}

const llmBaseUrl = (process.env.LLM_BASE_URL || '').trim().replace(/\/$/, '');
const llmModel = (process.env.LLM_MODEL || DEFAULT_LLM_MODEL).trim() || DEFAULT_LLM_MODEL;

export const config = {
  /**
   * OpenAI-compatible inference (DigitalOcean vLLM / gpt-oss, etc.).
   * Anthropic Messages API is no longer used.
   */
  llm: {
    /** Base URL including /v1, e.g. http://10.x.x.x:8000/v1 or http://127.0.0.1:8000/v1 */
    baseUrl: llmBaseUrl,
    /** API key for gateways that require one; vLLM often accepts any non-empty string. */
    apiKey: (process.env.LLM_API_KEY || 'not-needed').trim(),
    model: llmModel,
    /**
     * Anthropic tool_search is unavailable on OpenAI-compatible backends.
     * Always false — BaseAgent loads full allow-lists (or domain buckets).
     */
    useToolSearch: false,
    timeoutMs: parseInt(process.env.LLM_TIMEOUT_MS || '120000', 10),
    maxRetries: parseInt(process.env.LLM_MAX_RETRIES || '1', 10),
    maxTokens: {
      agent: envInt('LLM_MAX_TOKENS_AGENT', 'ANTHROPIC_MAX_TOKENS_AGENT', '8192'),
      router: envInt('LLM_MAX_TOKENS_ROUTER', 'ANTHROPIC_MAX_TOKENS_ROUTER', '100'),
      nova: envInt('LLM_MAX_TOKENS_NOVA', 'ANTHROPIC_MAX_TOKENS_NOVA', '256'),
      conversation: envInt('LLM_MAX_TOKENS_CONVERSATION', 'ANTHROPIC_MAX_TOKENS_CONVERSATION', '8192'),
      conversationShort: envInt(
        'LLM_MAX_TOKENS_CONVERSATION_SHORT',
        'ANTHROPIC_MAX_TOKENS_CONVERSATION_SHORT',
        '1024',
      ),
    },
    /**
     * USD per 1M tokens for usage analytics. Self-hosted default is $0
     * (GPU billed separately). Override if you want internal chargeback.
     */
    pricing: {
      inputPerMillion: envFloat('LLM_PRICE_INPUT_PER_MTOK', 'ANTHROPIC_PRICE_INPUT_PER_MTOK', '0'),
      outputPerMillion: envFloat('LLM_PRICE_OUTPUT_PER_MTOK', 'ANTHROPIC_PRICE_OUTPUT_PER_MTOK', '0'),
      cacheWritePerMillion: envFloat(
        'LLM_PRICE_CACHE_WRITE_PER_MTOK',
        'ANTHROPIC_PRICE_CACHE_WRITE_PER_MTOK',
        '0',
      ),
      cacheReadPerMillion: envFloat(
        'LLM_PRICE_CACHE_READ_PER_MTOK',
        'ANTHROPIC_PRICE_CACHE_READ_PER_MTOK',
        '0',
      ),
    },
  },
  /**
   * @deprecated Use config.llm — alias kept so leftover imports do not crash mid-migrate.
   */
  get anthropic() {
    return this.llm;
  },
  /** Platform-ops key for /api/admin/* (token usage billing). */
  admin: {
    apiKey: (process.env.ADMIN_API_KEY || '').trim(),
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
    /**
     * Max rows per list_* page. Multi-page aggregation (all_pages) is disabled —
     * tenants can have thousands of invoices; dumping them breaks the model.
     */
    maxListPageSize: parseInt(process.env.AGENT_MAX_LIST_PAGE_SIZE || '25', 10),
    /** @deprecated Multi-page auto-fetch removed; kept so old env vars do not crash. */
    maxAutoPages: 0,
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
    /**
     * Chat turn mode:
     * - orchestrator (default): Nova plans → specialists run tools → Nova presents to UI
     * - direct: single Nova with MCP tools (no specialist fan-out)
     */
    mode: (process.env.COWORKER_MODE || 'orchestrator').toLowerCase() === 'direct'
      ? 'direct'
      : 'orchestrator',
    /**
     * LLM execution plan before the tool loop (default on).
     * Set COWORKER_EXECUTION_PLAN=false to skip the planner call.
     */
    executionPlan: process.env.COWORKER_EXECUTION_PLAN !== 'false',
    /** Cap each tool_result in stored agent_transcript (default 4000 chars). */
    agentTranscriptMaxResultChars: parseInt(
      process.env.AGENT_TRANSCRIPT_MAX_RESULT_CHARS || '4000',
      10,
    ),
    /**
     * Redis numeric ID scrape into entities.* (legacy). Default off — agent
     * memory comes from ConversationTurn transcript. Keep SMS draft keys always.
     * Set COWORKER_SCRAPE_ENTITY_IDS=true to restore old ID injection.
     */
    scrapeEntityIds: process.env.COWORKER_SCRAPE_ENTITY_IDS === 'true',
    /** Intra-request agent continue slices when tool budget / max_tokens hits (default 3). */
    maxContinueSlices: parseInt(process.env.AGENT_CONTINUE_SLICES || '3', 10),
    /**
     * Max MCP tool schemas per turn after LLM tool-search. Full catalog
     * (~260 tools) exceeds gpt-oss 65k context. Default 40.
     */
    maxToolsPerTurn: parseInt(process.env.COWORKER_MAX_TOOLS_PER_TURN || '40', 10),
  },
  /** Telnyx Messaging — used by MCP SMS tools (draft_sms / send_sms). Server-only. */
  telnyx: {
    apiKey: (process.env.TELNYX_API_KEY || '').trim(),
    /** Purchased long code / TF — required for US/CA/PR (+1). */
    fromNumber: (process.env.TELNYX_FROM_NUMBER || '').trim(),
    /** Messaging profile for alphanumeric (international) traffic. */
    messagingProfileId: (process.env.TELNYX_MESSAGING_PROFILE_ID || '').trim(),
    /** Optional dedicated profile for US long-code sends. */
    usMessagingProfileId: (process.env.TELNYX_US_MESSAGING_PROFILE_ID || '').trim(),
    /** Alphanumeric brand sender for non-+1 destinations (e.g. Worxstream). */
    alphaSender: (process.env.TELNYX_ALPHA_SENDER || '').trim(),
    /** SMS draft TTL in Redis / memory (seconds). */
    draftTtlSeconds: parseInt(process.env.TELNYX_SMS_DRAFT_TTL || '600', 10),
  },
};

/**
 * Worxstream API credentials from ALS / session / request.
 * Company and user never fall back to hardcoded defaults.
 */
function resolveWorxstreamCredentials({ allowEnvTokenFallback = true } = {}) {
  const ctx = buildWorxstreamContext({}, { allowEnvTokenFallback });
  return {
    companyId: ctx.companyId,
    userId: ctx.userId,
    apiToken: ctx.apiToken || '',
  };
}

/** API token for Worxstream HTTP client — request/session, then optional env. */
export function getWorxstreamApiToken() {
  const { apiToken } = resolveWorxstreamCredentials();
  return apiToken || '';
}

/** companyId / userId for MCP tool calls — request/session only (per-user). */
export function getWorxstreamContext() {
  const { companyId, userId } = resolveWorxstreamCredentials();
  return { companyId, userId };
}

/** Tenant ids from the current request context (no DEFAULT_* fallback). */
export function getDefaultTenantIds() {
  return getWorxstreamContext();
}

// Validation
export function validateConfig() {
  const errors = [];
  const isProduction = process.env.NODE_ENV === 'production';

  if (!config.llm.baseUrl) {
    errors.push('LLM_BASE_URL is required (OpenAI-compatible base, e.g. http://127.0.0.1:8000/v1)');
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
    console.warn(
      '⚠️  WORXSTREAM_API_TOKEN not set — agent routes need a user JWT; Scribe scheduled reports need this env token.',
    );
  }
  if (isProduction && !process.env.WORXSTREAM_WEBHOOK_SECRET) {
    console.warn(
      '⚠️  WORXSTREAM_WEBHOOK_SECRET is unset — POST /api/webhooks/worxstream will accept unsigned deliveries.',
    );
  }
  if (isProduction && !config.server.corsOrigins) {
    console.warn('⚠️  CORS_ORIGINS not set - set in .env for production (comma-separated origins)');
  }
  if (isProduction && !(process.env.BACKEND_URL || process.env.PUBLIC_URL)) {
    console.warn('⚠️  BACKEND_URL or PUBLIC_URL not set - set in .env for production');
  }
  if (!config.admin.apiKey) {
    console.warn(
      '⚠️  ADMIN_API_KEY not set — /api/admin/analytics will reject all requests until it is configured.',
    );
  }
  if (config.redis.url) {
    const ttl = config.redis.contextTtlSeconds;
    if (!Number.isFinite(ttl) || ttl <= 0) {
      console.warn('⚠️  REDIS_CONTEXT_TTL_SECONDS is invalid; using default behavior may be unexpected');
    }
  }
}
