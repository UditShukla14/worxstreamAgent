## Redis-backed context and caching

This service can optionally use Redis for:

- **ConversationContext**: storing extracted IDs and follow-up context per `(company_id, user_id, conversation_id)`
- **Tool response caching**: short-lived caching for selected MCP tools (currently estimates)

### Environment variables

- `REDIS_URL`: Redis connection URL. If unset and `REDIS_HOST` is also unset, Redis is disabled and all Redis helpers become no-ops.
  - For **TLS** (DigitalOcean Valkey, ElastiCache, etc.), use the `rediss://` scheme, e.g. `rediss://default:PASSWORD@host:25061`.
- **Or** set `REDIS_HOST`, `REDIS_PORT`, `REDIS_USERNAME`, `REDIS_PASSWORD` without `REDIS_URL`: the app builds a URL with `encodeURIComponent` for credentials. TLS on port **25061** is assumed unless `REDIS_TLS=false`.
- `REDIS_DB` (optional): Redis database index.
- `REDIS_TLS` (optional): set to `true` to force TLS when using `redis://` or non-25061 ports; set `false` to disable TLS when you must use a plain `redis://` URL on port 25061 (unusual).
- `REDIS_TLS_REJECT_UNAUTHORIZED` (optional): set to `false` to allow self-signed certs.
- `REDIS_CONTEXT_TTL_SECONDS` (optional, default `1800`): TTL for conversation context keys.
- `REDIS_CACHE_TTL_SECONDS` (optional, default `60`): TTL for tool response cache keys.

### DigitalOcean Managed Valkey

- Use **TLS** (`rediss://`) and your cluster’s **port** (often `25061`).
- Put the connection string or `REDIS_HOST` / `REDIS_PASSWORD` in **`.env` only**; never commit credentials.

### Manual smoke test

1. Start Redis (locally or hosted) and set `REDIS_URL`.
2. Start the server (`npm run dev`).
3. In the UI or via API, run a two-turn flow:
   - Turn 1: find a customer by name (e.g. “is there any customer Acme”).
   - Turn 2: ask for “his/their estimates”.
4. Expected:
   - Follow-up turn uses stored `customer_id` from Redis-backed context.
   - Estimates results are filtered to the customer.

If Redis is down/unset, behavior should **degrade gracefully** (no crash), but follow-up ID memory will not persist across turns.

