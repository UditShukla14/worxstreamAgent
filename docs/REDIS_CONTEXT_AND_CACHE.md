## Redis-backed context and caching

This service can optionally use Redis for:

- **ConversationContext**: storing extracted IDs and follow-up context per `(company_id, user_id, conversation_id)`
- **Tool response caching**: short-lived caching for selected MCP tools (currently estimates)

### Environment variables

- `REDIS_URL`: Redis connection URL. If unset, Redis is disabled and all Redis helpers become no-ops.
- `REDIS_DB` (optional): Redis database index.
- `REDIS_TLS` (optional): set to `true` to force TLS.
- `REDIS_TLS_REJECT_UNAUTHORIZED` (optional): set to `false` to allow self-signed certs.
- `REDIS_CONTEXT_TTL_SECONDS` (optional, default `1800`): TTL for conversation context keys.
- `REDIS_CACHE_TTL_SECONDS` (optional, default `60`): TTL for tool response cache keys.

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

