# Frontend Changes (Worxstream integration)

This backend has removed the legacy chat flow and now relies on the **multi‑agent pipeline** only.

## Breaking changes

- **Removed endpoints**:
  - `POST /api/chat`
  - `POST /api/chat/stream`
  - `GET /api/chat`
  - `GET /api/chat/:conversation_id`
  - `DELETE /api/chat/:conversation_id`

- **Removed backend “keyword tool filtering”**:
  - `@customer`, `@invoice`, etc. keywords are **no longer used by the backend** to filter tools.
  - Frontend can keep allowing users to type them, but they’re treated as normal text.

## What the frontend must use now

### Primary chat endpoint (streaming)
- **Endpoint**: `POST /api/agents/stream`
- **Body** (required):

```json
{
  "message": "user message",
  "conversation_id": "optional UUID to continue",
  "companyId": "optional — defaults to DEFAULT_COMPANY_ID in server .env",
  "userId": "optional — defaults to DEFAULT_USER_ID in server .env"
}
```

- **Worxstream API auth (unchanged)**:
  - Server uses `WORXSTREAM_API_TOKEN`, `DEFAULT_COMPANY_ID`, and `DEFAULT_USER_ID` from `.env` for MCP tool calls.
  - Optional: `POST /session` or `POST /api/auth/session` to override credentials in memory until logout.

- **Notes**:
  - If `conversation_id` is omitted, backend generates one and emits it via SSE.
  - If `companyId` / `userId` are omitted, conversation storage and Redis context use the same defaults as the server `.env`.

### SSE event contract (what to handle)
The backend streams Server-Sent Events where each event is JSON in `data: ...`.

Common event types:
- **`conversation_id`**: `{ type: "conversation_id", conversation_id: "..." }`
- **`status`**: `{ type: "status", label: "..." }` (UI “working…” text)
- **`agent_selected`**: `{ type: "agent_selected", agent: "invoice" }`
- **`tool_use`**: `{ type: "tool_use", tool: "list_invoices", input: { ... } }`
- **`tool_result`**: `{ type: "tool_result", tool: "list_invoices", success: true }`
- **`text`**: `{ type: "text", content: "..." }` (this is the formatted XML stream from OutputFormatter)
- **`clarification`**: `{ type: "clarification", question: "...", options: [{ index, id, label }] }` — user should reply with `#1`, `#2`, etc.
- **`confirmation_required`**: `{ type: "confirmation_required", confirmationId, tool, input }` — then `POST /api/agents/confirm` with `{ conversation_id, confirmationId, approved: true|false }`
- **`done`**: `{ type: "done", agent: "invoice, customer", toolsUsed: [...] }` (may include `pending_confirmation: true`)
- **`error`**: `{ type: "error", error: "..." }`

### Write confirmation
- When `COWORKER_CONFIRM_WRITES=true`, create/update/delete tools pause until the user confirms.
- **Endpoint**: `POST /api/agents/confirm` with `companyId`, `userId`, `conversation_id`, `confirmationId`, `approved`.

### Preferences (cross-session)
- `GET /api/agents/preferences?companyId=&userId=`
- `PATCH /api/agents/preferences` with `{ preferences: { ... } }`

### Conversations sidebar/history
Use the existing multi-agent endpoints:
- `GET /api/agents/conversations?companyId=...&userId=...`
- `GET /api/agents/conversations/:conversation_id?companyId=...&userId=...`
- `DELETE /api/agents/conversations/:conversation_id?companyId=...&userId=...`

## UI expectations / parsing

- The streamed `text` chunks are **already formatted XML** (tables/details/stats/workflow) intended for the same XML rendering layer you already have.
- Do **not** try to render the raw specialist output; the backend formats once at the end via the formatter and streams that formatted result.

## Suggested frontend code changes checklist

- **Networking**
  - Replace any usage of `/api/chat` or `/api/chat/stream` with `/api/agents/stream`.
  - Ensure `companyId` and `userId` are included in every request.

- **SSE handler**
  - Continue appending `event.type === "text"` chunks to the assistant message buffer.
  - Handle `conversation_id` immediately to persist/route future messages.
  - Optionally show progress UI using `status` and `agent_selected`.

- **Remove keyword-filter UI assumptions**
  - If you had special UI logic based on `@customer` etc. (tool scoping), remove it or keep as purely cosmetic.

## Why this is needed (high level)

The backend now:
- routes + orchestrates specialists via `/api/agents/stream`
- loads prior turns from MongoDB when `conversation_id` is sent (router/Nova: full window; specialists: last ~6 messages)
- keeps short, tenant-scoped memory (Redis) for better follow-ups and canonical IDs
- dynamically selects tools (no static keyword filtering / no hardcoded per-agent tool lists)

