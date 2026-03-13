# Lessons

## Architecture

- **Canonical ID slots beat “raw id”**: List/detail APIs often return `id`, but downstream tools require domain-specific slots like `customer_id`. Normalize IDs into canonical slots (e.g. map customer `id` → `customer_id`) so follow-ups like “his estimates” can reliably call list tools without guesswork.
- **Context must be tenant-scoped**: Any shared context store (Redis) should key by `(company_id, user_id, conversation_id)` to avoid cross-tenant collisions and confusing follow-up behavior.

