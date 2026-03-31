# Lessons

## Architecture

- **Hosted Valkey/Redis (e.g. DigitalOcean)**: Prefer `REDIS_HOST` + `REDIS_PORT` + `REDIS_USERNAME` + `REDIS_PASSWORD` (or a single `rediss://…` URL) in `.env`; `src/config/index.js` builds a TLS URL for port `25061` automatically. Never commit credentials.

- **Persist formatter output for agent turns, not raw agent text**: Specialist runs produce `combinedRawText`; `formatOutputStreaming` turns that into UI XML (`<table>`, etc.). MongoDB must store the **formatted** string (returned from the formatter) so conversation history replays the same HTML parsing as the live stream. Storing only raw text caused history to show plain lists and extra unformatted fields.

- **Canonical ID slots beat “raw id”**: List/detail APIs often return `id`, but downstream tools require domain-specific slots like `customer_id`. Normalize IDs into canonical slots (e.g. map customer `id` → `customer_id`) so follow-ups like “his estimates” can reliably call list tools without guesswork.
- **Context must be tenant-scoped**: Any shared context store (Redis) should key by `(company_id, user_id, conversation_id)` to avoid cross-tenant collisions and confusing follow-up behavior.

## Date/Time

- **Inject current date/time into agent context**: Agents need the current date to resolve relative phrases like "last month", "this week", "last quarter". Use `getCurrentDateTimeContext()` from `src/utils/dateContext.js` and prepend it to system prompts (legacy chat) or conversation context (multi-agent flow).
- **Enforce list policies at runtime**: Apply shared behaviors in `BaseAgent` so prompts can’t drift: normalize date filters (`created_date` → `created_at`, BETWEEN arrays → `"from,to"`), paginate automatically for “all” requests (with a safe cap), and filter by status labels like Open/Paid without putting status into `filter.search`. Policies live in `src/agents/policies/listPolicies.js`.

