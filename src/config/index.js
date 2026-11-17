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

/** Main model for agent tool loops — dateless ID, not a dated snapshot. */
const DEFAULT_MODEL = 'claude-sonnet-4-6';
/** Cheap model for control calls (plan, router, summary, formatter). */
const DEFAULT_FAST_MODEL = 'claude-haiku-4-5';

/** Retired snapshot IDs (resolved to the fallback passed into resolveAnthropicModel). */
const RETIRED_MODEL_IDS = new Set([
  'claude-sonnet-4-20250514',
  'claude-opus-4-20250514',
  'claude-sonnet-4-0',
  'claude-opus-4-0',
  'claude-3-7-sonnet-20250219',
  'claude-3-5-haiku-20241022',
  'claude-3-haiku-20240307',
]);

/** Pre-4.6 models use YYYYMMDD suffixes; those IDs expire when Anthropic retires the snapshot. */
const DATED_SNAPSHOT_RE = /-\d{8}$/;


/**
 * Resolve an Anthropic model env var: reject dated snapshots and retired IDs.
 * @param {string|undefined} envValue
 * @param {{ fallback?: string, envName?: string }} [opts]
 */
function resolveAnthropicModel(envValue, { fallback = DEFAULT_MODEL, envName = 'ANTHROPIC_MODEL' } = {}) {
  let modelId = (envValue || '').trim() || fallback;
  if (RETIRED_MODEL_IDS.has(modelId)) {
    console.warn(
      `⚠️  ${envName} "${modelId}" is retired; using "${fallback}". Update the env var.`
    );
    return fallback;
  }
  if (DATED_SNAPSHOT_RE.test(modelId)) {
    console.warn(
      `⚠️  ${envName} "${modelId}" is a dated snapshot; using "${fallback}". Set a dateless ID.`
    );
    return fallback;
  }
  return modelId;
}

const anthropicModel = resolveAnthropicModel(process.env.ANTHROPIC_MODEL);
const anthropicFastModel = resolveAnthropicModel(process.env.ANTHROPIC_MODEL_FAST, {
  fallback: DEFAULT_FAST_MODEL,
  envName: 'ANTHROPIC_MODEL_FAST',
});
const useToolSearchEnv = process.env.ANTHROPIC_USE_TOOL_SEARCH;

export const config = {
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    /** Sonnet for agent / governance tool loops; override with ANTHROPIC_MODEL. */
    model: anthropicModel,
    /** Haiku for plan / router / summary / formatter; override with ANTHROPIC_MODEL_FAST. */
    fastModel: anthropicFastModel,
    /** On by default (all current Claude models support it); set ANTHROPIC_USE_TOOL_SEARCH=false to disable. */
    useToolSearch: useToolSearchEnv !== 'false',
    /** Extended thinking in interactive chat: 'adaptive' (default, supported models only) or 'off'. */
    thinking: String(process.env.NOVA_THINKING || 'adaptive').toLowerCase() === 'off' ? 'off' : 'adaptive',
    /**
     * Centralized token limits. These are intentionally conservative defaults
     * and can be tuned via env without touching code.
     */
    maxTokens: {
      /** For specialist agent runs (tool loop). Reports/large answers need headroom. */
      agent: parseInt(process.env.ANTHROPIC_MAX_TOKENS_AGENT || '8192', 10),
      /** For OutputFormatter pass — large reports expand into XML tables/charts. */
      formatter: parseInt(process.env.ANTHROPIC_MAX_TOKENS_FORMATTER || '16384', 10),
      /** For router key selection. */
      router: parseInt(process.env.ANTHROPIC_MAX_TOKENS_ROUTER || '100', 10),
      /** For Nova orchestration plan. */
      nova: parseInt(process.env.ANTHROPIC_MAX_TOKENS_NOVA || '256', 10),
      /** For conversational fallback streaming in agents/stream and legacy flows. */
      conversation: parseInt(process.env.ANTHROPIC_MAX_TOKENS_CONVERSATION || '8192', 10),
      /** For conversation-only (non-stream) replies. */
      conversationShort: parseInt(process.env.ANTHROPIC_MAX_TOKENS_CONVERSATION_SHORT || '1024', 10),
    },
    /**
     * Fallback Sonnet list rates when a caller still reads flat `pricing`.
     * Billing uses per-model rates via `resolveModelRates` in analytics/modelPricing.js.
     */
    pricing: {
      inputPerMillion: parseFloat(process.env.ANTHROPIC_PRICE_INPUT_PER_MTOK || '3'),
      outputPerMillion: parseFloat(process.env.ANTHROPIC_PRICE_OUTPUT_PER_MTOK || '15'),
      cacheWritePerMillion: parseFloat(process.env.ANTHROPIC_PRICE_CACHE_WRITE_PER_MTOK || '3.75'),
      cacheReadPerMillion: parseFloat(process.env.ANTHROPIC_PRICE_CACHE_READ_PER_MTOK || '0.30'),
    },
  },
  billing: {
    /**
     * Markup on Anthropic cost charged to customers (0.2 = +20%). Applied PER EVENT at metering time
     * and stored on the ledger row together with the provider cost. 0 = off (default, so nothing
     * changes until explicitly enabled; a company wallet can override it with `markup_rate`).
     */
    // Worxstream's margin on Anthropic's price (0.2 = +20%). Charged per request against the company's credit, so
    // everything a company sees (plan prices, balance, usage) is in the dollars it is charged, never Anthropic's cost.
    markupRate: Math.min(5, Math.max(0, parseFloat(process.env.NOVA_MARKUP_RATE || '0.2') || 0)),
    /** Hard stop for one chat turn's PROVIDER cost in USD (0 = off). Guards runaway tool loops. */
    maxTurnCostUsd: parseFloat(process.env.NOVA_MAX_TURN_COST_USD || '3'),
    /** Free trial credit given to a company the first time it uses Nova (0 = off: no wallet means unlimited). */
    trialAllowanceUsd: Math.max(0, parseFloat(process.env.NOVA_TRIAL_ALLOWANCE_USD || '0') || 0),
    /** true: a company with no wallet (and no trial) cannot use Nova until it buys credits or ops grants some. */
    requireWallet: process.env.NOVA_REQUIRE_WALLET === 'true',
    /** The wallet reports low_balance below this share of everything granted, or below this many dollars. */
    lowBalanceRatio: Math.min(1, Math.max(0, parseFloat(process.env.NOVA_LOW_BALANCE_RATIO || '0.1') || 0.1)),
    lowBalanceUsd: Math.max(0, parseFloat(process.env.NOVA_LOW_BALANCE_USD || '2') || 2),
  },
  /** Stripe (Nova credit purchases). Secret key and webhook signing secret are server-only; never sent to the browser. */
  stripe: {
    secretKey: (process.env.STRIPE_SECRET_KEY || '').trim(),
    webhookSecret: (process.env.STRIPE_WEBHOOK_SECRET || '').trim(),
  },
  /** Seller details printed on invoices. Address lines are separated with "|". */
  invoice: {
    sellerName: (process.env.INVOICE_SELLER_NAME || 'Worxstream').trim(),
    sellerAddress: (process.env.INVOICE_SELLER_ADDRESS || '').trim(),
    sellerTaxId: (process.env.INVOICE_SELLER_TAX_ID || '').trim(),
  },
  /** Platform-ops key for /api/admin/* (token usage billing). */
  admin: {
    apiKey: (process.env.ADMIN_API_KEY || '').trim(),
  },
  /** Service-to-service key for /api/internal/* (the mail service reports Raven usage and asks whether Raven is allowed). */
  apps: {
    serviceKey: (process.env.APP_SERVICE_KEY || '').trim(),
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
    /** Optional message-count cap (0 = off). The window is token-based, like Claude's. */
    maxMessages: parseInt(process.env.MAX_CONTEXT_MESSAGES || '0', 10),
    /** Working window per conversation: min(model window, this). 200k = Claude's standard window; raise it to use a 1M model fully (costs more per turn). */
    maxTokens: parseInt(process.env.CONTEXT_WINDOW_TOKENS || process.env.MAX_CONTEXT_TOKENS || '200000', 10),
    reserveTokens: parseInt(process.env.RESERVE_TOKENS || '10000', 10),
    /** Fraction of the model window held back as a safety margin (token estimates are approximate). */
    safetyMargin: parseFloat(process.env.CONTEXT_SAFETY_MARGIN || '0.05'),
    /** Soft threshold (share of usable budget): start compacting history into the rolling summary. */
    softRatio: parseFloat(process.env.CONTEXT_SOFT_RATIO || '0.8'),
    /** Hard threshold: clear old tool results inside the agent loop. */
    hardRatio: parseFloat(process.env.CONTEXT_HARD_RATIO || '0.92'),
    /** Specialist agents: only the last N stored messages (user+assistant pairs). */
    specialistMaxMessages: parseInt(process.env.SPECIALIST_CONTEXT_MESSAGES || '6', 10),
    specialistMaxTokens: parseInt(process.env.SPECIALIST_CONTEXT_TOKENS || '12000', 10),
    specialistReserveTokens: parseInt(process.env.SPECIALIST_RESERVE_TOKENS || '4000', 10),
    specialistMessagesActive: parseInt(process.env.SPECIALIST_CONTEXT_MESSAGES_ACTIVE || '12', 10),
  },
  agentRuntime: {
    /** Max chars of one tool result sent back to the model (full result is kept for UI widgets). */
    toolResultMaxChars: parseInt(process.env.AGENT_TOOL_RESULT_MAX_CHARS || '30000', 10),
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
     * - orchestrator (default): one Nova agent + tool search (Claude/OpenAI-style). Skips router/Nova-plan fan-out.
     * - specialists: legacy router → specialist(s) → formatter path.
     */
    mode: (process.env.COWORKER_MODE || 'orchestrator').toLowerCase() === 'specialists'
      ? 'specialists'
      : 'orchestrator',
    /**
     * Orchestrator: LLM execution plan before the tool loop (default on).
     * Set COWORKER_EXECUTION_PLAN=false to skip (legacy direct tool chat).
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
  },
  /** Mail backend (Outlook/Gmail sync + AI enrichment). The agent reads the signed-in user's mailbox through it. */
  mail: {
    baseUrl: (process.env.MAIL_AGENT_API_URL || '').trim().replace(/\/+$/, ''),
    timeoutMs: parseInt(process.env.MAIL_AGENT_TIMEOUT_MS || '20000', 10),
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
