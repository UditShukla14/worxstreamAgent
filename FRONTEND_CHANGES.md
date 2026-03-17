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
  "companyId": "required",
  "userId": "required"
}
```

- **Notes**:
  - If `conversation_id` is omitted, backend generates one and emits it via SSE.
  - `companyId` + `userId` are required to scope conversation storage and Redis context.

### SSE event contract (what to handle)
The backend streams Server-Sent Events where each event is JSON in `data: ...`.

Common event types:
- **`conversation_id`**: `{ type: "conversation_id", conversation_id: "..." }`
- **`status`**: `{ type: "status", label: "..." }` (UI “working…” text)
- **`agent_selected`**: `{ type: "agent_selected", agent: "invoice" }`
- **`tool_use`**: `{ type: "tool_use", tool: "list_invoices", input: { ... } }`
- **`tool_result`**: `{ type: "tool_result", tool: "list_invoices", success: true }`
- **`text`**: `{ type: "text", content: "..." }` (this is the formatted XML stream from OutputFormatter)
- **`done`**: `{ type: "done", agent: "invoice, customer", toolsUsed: [...] }`
- **`error`**: `{ type: "error", error: "..." }`

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
- keeps short, tenant-scoped memory (Redis) for better follow-ups
- dynamically selects tools (no static keyword filtering / no hardcoded per-agent tool lists)

