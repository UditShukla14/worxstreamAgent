# PROJECT_KNOWLEDGE.md — worxstreamAgent

> A single document to understand the entire project: what it is, how every layer works,
> how the pieces communicate, and how to extend it. Read this before developing further.
> Companion file: `LESSONS.md` (hard-won gotchas — always read both).

---

## 1. What This Project Is

**worxstreamAgent** is an AI "coworker" backend for the Worxstream business platform
(ERP/CRM: customers, estimates, invoices, jobs, products, HR, finance...). It exposes the
Worxstream REST API as ~193 MCP-style tools and runs a **multi-agent LLM system**
(Anthropic Claude) that routes user messages to specialist agents, executes tools,
maintains conversation memory, and streams formatted output to a React chat UI.

**High-level flow:**

```
React client (SSE)
  → POST /api/agents/stream (Express)
    → runCoworkerTurn (coworker pipeline)
      → Router LLM (pick agents) → Nova LLM (plan: single/parallel/sequential)
        → Specialist BaseAgent(s) → MCP tool registry → Worxstream REST API
      → OutputFormatter LLM (raw text → UI XML)
      → Persist (MongoDB history, Redis context, rolling summary)
```

**Stack:** Node.js (ES modules), Express 4, `@anthropic-ai/sdk`, `@modelcontextprotocol/sdk`
(real Streamable HTTP endpoint at `/mcp` — see §3), Mongoose 9 (MongoDB), Redis 5 (optional),
Zod v4, Multer, xlsx.
Frontends: `client/` (Vite + React 18 + TS + Tailwind v4) and `control_tower/` (governance
admin UI, currently mock-data only). Deployed via PM2 (`ecosystem.config.cjs`) on a droplet.

---

## 2. Repository Layout

```
src/
  index.js              # entry → app.js startServer()
  app.js                # Express app, middleware, bootstrap order
  config/index.js       # ALL config + credential resolution (env/session getters)
  db/connection.js      # Mongoose connect
  mcp/
    server.js           # in-process tool registry + createMcpServer() factory for /mcp transport
    toolIndex.js        # tools grouped byDomain (used for per-agent tool scoping)
    toolCapabilities.js # ordered DOMAIN_RULES + {action, safety} inference from tool names
    toolPolicyPipeline.js # before/after/error hooks around every tool call
    tools/              # 23 domain modules registering ~193 tools (see §4)
  agents/
    index.js            # barrel exports
    agentDefinitions.js # 22 agent definitions (Nova + 21 specialists)
    router.js           # LLM intent classification → agent keys
    BaseAgent.js        # the agent run loop (tool_use execution, policies, write gate)
    coworkerPipeline.js # runCoworkerTurn — the unified turn lifecycle (THE spine)
    ConversationContext.js # Redis canonical-ID context (ws:ctx:*)
    workingMemory.js    # workingSet: sessionGoal/activeTask/pendingClarification/lastOutcome
    playbooks.js        # injects docs/playbooks/<domain>.md into system prompts
    pendingConfirm.js   # write-confirmation flow (ws:pending:*)
    OutputFormatter.js  # raw text → UI XML (second LLM pass)
    PlanState.js        # ws:plan:* self-check retry counter
    AgentTracker.js     # "Rex" observability singleton (+ logs/rex.jsonl)
    soul.js             # loads SOUL.md (identity prompt for all agents)
    policies/listPolicies.js # runtime list normalization/pagination/status filters
  routes/               # agents, session, health, tools, rex, priceComparison, webhooks, mcp
  middleware/           # errorHandler + requestContext (both mounted in app.js)
  request/requestContext.js # AsyncLocalStorage per-request tenant ctx (consumed by config)
  session/worxstreamSession.js # global in-memory session — fallback below per-request ALS ctx
  models/               # Conversation.js, UserPreferences.js (Mongo)
  services/             # httpClient.js (Worxstream axios), redisClient.js (fail-safe wrapper)
  utils/                # contextWindow, conversationHistory, conversationSummary, dateContext,
                        # chartGenerator, tokenCounter, validateMessages, compareStocks, ...
  scripts/analyzePostmanCollection.js # dev tool: diff Postman collection vs registered tools
client/                 # main chat UI
control_tower/          # governance UI (mock data, future /api/control/* API)
docs/                   # design docs + playbooks/ (agent domain instructions)
test/context/           # node --test unit tests for memory/context modules
SOUL.md                 # agent identity/values — prepended to every system prompt
LESSONS.md              # gotchas — read first, always
```

---

## 3. MCP Layer — How Tools Work

### Dual-faced: in-process registry + real MCP server

The source of truth is a module-level `Map` (`toolRegistry`) in `src/mcp/server.js` —
that's what the in-process agents execute against (`executeMcpTool`). Additionally,
external MCP clients connect via **Streamable HTTP at `POST /mcp`** (`src/routes/mcp.js`):
stateless pattern — each request gets a fresh `createMcpServer()` (factory that registers
all registry tools into an SDK `McpServer`) + `StreamableHTTPServerTransport`
(`sessionIdGenerator: undefined`, `enableJsonResponse: true`), torn down on response close.
GET/DELETE return JSON-RPC 405.

### Registration

- `registerTool(name, { title, description, inputSchema (Zod raw shape), capabilities? }, callback)`
  stores into the Map and normalizes capabilities via `toolCapabilities.js`
  (`action`/`safety` from name conventions: `list_*`, `get_*`,
  `create_*`/`update_*`/`delete_*` ⇒ safety `write`; `domain` via ordered `DOMAIN_RULES`,
  first match wins, most specific first).
- `src/mcp/tools/index.js` imports all 23 modules and **auto-runs `registerAllTools()` at
  import time** — `app.js` imports it for side effects before `initializeAgents()`.

### Exposure to Claude

- `getAnthropicTools(filterNames)` → Anthropic tool defs. Zod→JSON-Schema conversion uses
  zod v4's native `z.toJSONSchema` (nested objects/arrays/unions fully represented,
  `$schema`/top-level `additionalProperties` stripped), **memoized per tool**, with a
  permissive-schema fallback on conversion failure.
- `getAnthropicToolsForToolSearch()` → BM25 on-demand tool loading
  (`tool_search_tool_bm25_20251119`) with `defer_loading: true`; auto-enabled for
  supported models via `config.anthropic.useToolSearch`.

### Execution — `executeMcpTool(name, input, context)`

1. Lookup; unknown → `{success:false, error_type:'unknown_tool'}`.
2. `beforeToolCall` (toolPolicyPipeline): normalizes `list_*` inputs, strips `sort`/`take`,
   forces `page=1` on "latest/recent" messages.
3. Awaits callback; parses MCP `{content:[{type:'text',text:JSON}]}` envelope, else wraps
   as `{success:true, data}`.
4. `afterToolCall` ensures a `success` boolean; `onToolError` → `{success:false, error_type:'tool_exception'}`.
   **Tools never throw** — HTTP failures become `{success:false, error}`.

### Cross-cutting tool patterns

- **Tenant injection:** every tool calls `getWorxstreamContext()` at invocation time —
  the LLM never supplies tenant IDs. Two naming conventions coexist: list endpoints take
  camelCase `companyId/userId/appName`; everything else snake_case `company_id/user_id/app_name`.
- **Generic master-objects API:** estimates, invoices, credit memos, POs, bills all share
  `/master-objects/list|show|store`, disambiguated by app name.
- **LLM-sloppiness coercion:** `normalizeFilter` (string→`{search}`), `Number()`/`Boolean()`
  coercion, field mapping (`line_items`→`lineItems` in reports).
- **Inconsistent maturity (by design):** only `list_estimates`/`get_estimate_details` are
  Redis-cached (60s TTL, key `ws:cache:*`); only `list_invoices` supports `all_pages`
  aggregation with pagination hints.
- **Quirk:** `reports.js` returns API results directly (no content envelope) — re-wrapped
  by `executeMcpTool`'s fallback.

### HTTP client — `src/services/httpClient.js`

Axios instance: base URL = `WORXSTREAM_BASE_URL` + `/api`, 30s timeout, **no retries**.
Auth header resolved **per request** via a getter → `getWorxstreamApiToken()`
(session → env). GET merges `data` into query params. Errors → `{success:false, error}`.

---

## 4. Tool Inventory (~193 tools, 23 modules)

| Module | Count | Tools (key ones) | Endpoint family |
|---|---|---|---|
| `customers.js` | 5 | `list_customers`, `get_customer_details`, `update_customer`, `get_customer_dropdown`, `quick_update_customer` | `/master/customer/*` |
| `contacts.js` | 7 | `list/get/create/update/delete/clone/quick_update_contact` | `/master/contact/*` |
| `estimates.js` | 3 | `list_estimates` (Redis-cached), `get_estimate_details`, `create_estimate` | `/master-objects/*` (estimate) |
| `invoices.js` | 3 | `list_invoices` (all_pages aggregation), `get_invoice_details`, `create_invoice` | `/master-objects/*` (invoice) |
| `creditMemos.js` | 3 | `list/get/create_credit_memo*` | `/master-objects/*` (credit_memo) |
| `purchaseOrders.js` | 3 | `list/get/create_purchase_order*` | `/master-objects/*` (purchase_order) |
| `bills.js` | 3 | `list/get/create_bill*` | `/master-objects/*` (bill) |
| `jobs.js` | 3 | `list_jobs`, `get_job_details`, `create_job` | `/transaction/job/*` |
| `projects.js` | 6 | `list/get/create/update/delete/clone_project` | `/transaction/project/*` |
| `tasks.js` | 3 | `list_tasks`, `get_task_details`, `create_task` | `/transaction/task/*` |
| `vendors.js` | 3 | `list_vendors`, `get_vendor_details`, `update_vendor` | `/master/vendor/*` |
| `products.js` | 15 | products/services CRUD + clone, categories, subcategories, `bulk_action_product_service`, dropdowns | `/master/product/*` |
| `hr.js` | 24 | departments (8), teams (9), team members (6), `get_hr_statistics` | `/hr/*` |
| `company.js` | 46 | company details/status/stats, branches, DB setup/migrate/delete-OTP, org contacts, custom number ranges (10), payment instructions (9), signatures (8) | `/company/*`, `/branches/*`, etc. |
| `finance.js` | 19 | taxes (4), chart of accounts (5), dropdown values, column configs, fields groups, `get_app_filters` | `/master/tax/*`, `/master/config/*` |
| `config.js` | 7 | `get_dropdown_configs/values`, `get_column_configs`, `get_all_apps`, `get_menus`, `get_forms`, `get_country_codes` | `/master/config/*`, `/framework/*` |
| `addresses.js` | 12 | address CRUD (6) + tax exemptions (6) | `/addresses/*` |
| `workflows.js` | 8 | `list_workflows`, `get_workflows_by_object`, `get_workflow_object_tree`, `link_workflow_nodes`, `create_workflow_node` (convert/copy/release), `update/cancel_workflow` | `/workflow/*` |
| `reports.js` | 13 | `get_report_filters`, `generate_estimate_report`, `generate_invoice_report`, `export_invoice_report_csv`, line items ×2, `get_product_selling_history`, goals (6) | `/report/*` |
| `subscriptions.js` | 2 | `list_subscriptions`, `get_active_subscriptions` | `/v1/master-subscriptions*` |
| `systemFinder.js` | 2 | `get_system_finder_options`, `get_system_finder_matchup_products` (HVAC) | `/systemfinder/*` |
| `priceComparison.js` | 1 | `compare_stock_prices` (no API call — echoes Excel diff data) | n/a |
| `helpers.js` | 2 | `get_timezones`, `get_currencies` | `/helper/*` |

---

## 5. Agent Layer

### Agent inventory (`agentDefinitions.js`) — 22 agents

Each definition: `{name, description, domain, systemPrompt}` (optionally `domains: []`
for multi-domain agents — e.g. finance uses `['finance', 'config']`). **Tools are NOT
listed per agent** — resolved at runtime as the union of `toolIndex.byDomain[...]`
buckets. An empty bucket logs a loud error and yields ZERO tools (never falls back to
all tools); `test/context/agent-tool-domains.test.js` guards every agent's coverage.

**Name → ID resolution (never ask the user for IDs):**
- Every agent automatically gets the `lookup` domain bucket — `BaseAgent.getTools()`
  appends it — containing the universal `resolve_entity` meta-tool
  (`src/mcp/tools/lookup.js`). It takes `{entity_type, query}` and dispatches to the
  right lookup tool (`ENTITY_LOOKUPS` table: team_member, customer, contact, product,
  vendor, tax, department, branch, job, project, task), then returns compact, scored
  matches plus a hint (1 match → proceed; 0 → ask for correct name; many → ask which).
- Additionally, cross-domain tools an agent's prompt names directly are cherry-picked
  via `extraTools: []` on the definition (validated against the registry at runtime and
  in tests): task gets team-member lookups; estimate/invoice/credit memo/PO/bill get
  customer/product dropdowns + `list_taxes` (+ `list_vendors` for PO/bill); job/project
  get `list_contacts`/`get_customer_dropdown`.
- `BaseAgent` appends a global "ID RESOLUTION" rule to every system prompt: resolve
  names via `resolve_entity` (or a domain lookup tool); only ask the user on zero or
  ambiguous matches.

| Key | Domain | Notes |
|---|---|---|
| `nova` | none | Orchestrator/manager — no tools; outputs JSON plan `{mode, agents, reason}`, max 3 agents |
| `estimate`, `invoice`, `creditMemo`, `purchaseOrder`, `bill` | own domains | Date-filter awareness (`filter.advance` BETWEEN), never status in `filter.search`, reuse 300-series customer_id from context |
| `customer` | customer | **ID discipline:** 300-series master id only for details; surfaces customer_id for downstream agents |
| `contact` | contact | CRM leads — explicitly NOT customers |
| `product`, `vendor`, `job`, `task`, `project`, `hr`, `finance`, `workflow`, `company`, `address`, `config` | own domains | Domain CRUD specialists |
| `systemFinder` | system_finder | HVAC matchup flow |
| `priceComparison` | price_comparison | Excel stock/price file diffs |
| `reports` | reports | **Runs on Haiku** (cost); charts MANDATORY; emits `<chart>/<stats>/<gauge>/<trend>` XML itself; prefers `generate_*_report` over `list_*` |

Also exported: `AGENT_STATUS_LABELS` (UI strings), `getAgentDescriptionsForRouter`.

### Models

- Specialists + general chat: `config.anthropic.model` (default `claude-sonnet-4-6`)
- Router, Nova plan, self-check: `config.anthropic.fastModel` (default `claude-haiku-4-5`,
  with history trimmed to ~6 recent turns — latency optimization)
- Formatter: `config.anthropic.formatterModel` (defaults to fastModel;
  `ANTHROPIC_FORMATTER_MODEL` overrides)
- Reports agent + conversation summaries: `config.anthropic.reportsModel`
  (default `claude-haiku-4-5`, ~92% cheaper)
- Nova is **skipped entirely** for single-agent routes (plan is trivially single)

### `BaseAgent` run loop

- System prompt = `SOUL.md` + definition prompt + recovery note + domain playbook
  (`docs/playbooks/<domain>.md`, only estimate/invoice/customer/workflow/reports exist).
- Loop bounded by `AGENT_MAX_TOOL_ITERATIONS` (15): call Claude → if `stop_reason ===
  'tool_use'`, execute each block via `executeMcpTool`, push `tool_result`, repeat.
- `runWithEvents` (pipeline path) additionally:
  - emits SSE `tool_use`/`tool_result` events;
  - **write-confirmation gate**: if `COWORKER_CONFIRM_WRITES=true` and tool is a write
    (`create_/update_/delete_` or capability safety=write), stores pending confirm in Redis,
    emits `confirmation_required`, returns `needsConfirmation: true`;
  - **auto-pagination**: "all/every/entire" messages trigger up to `AGENT_MAX_AUTO_PAGES`
    (10) merged pages + status filtering (`listPolicies.js`).
- History injection: `context._conversationHistory` (built by `buildSpecialistHistory` —
  6 recent messages, or 12 when activeTask is in_progress, ~12k token cap) is prepended.

### Router & Nova

- `resolveAgentKeys(message, ctx, priorMessages)`: Sonnet call with all agent descriptions +
  few-shot examples → JSON array of agent keys. Invalid → `['none']` → general-chat branch.
- `getNovaPlan(...)`: Nova returns `{mode: single|parallel|sequential, agents, reason}`;
  fallback mode derived from router result.

### Turn lifecycle — `runCoworkerTurn` (the spine; ALL entry points must use it)

1. conversation_id (given or UUID) → SSE `conversation_id` + immediate `status` event
2. Pre-work in parallel (`Promise.all`): Mongo state ∥ (`applyClarificationPick` →
   Redis context) ∥ user preferences
3. Build context prompt: last-assistant snippet + Redis context (`buildContextPrompt`) +
   date/time (`getCurrentDateTimeContext`) + `[Conversation summary]` + `[User preferences]`
4. Clarification gate (`detectClarificationNeeded`) — may return early with options
5. Build specialist history window
6. Route (router LLM, fast model, last 6 turns) — `type: 'conversation'` → general chat
   branch (Sonnet streaming, persist, return)
7. Plan: single-agent route skips Nova; multi-agent → Nova plan (fast model) →
   run agents (single / parallel Promise.all / sequential with `[Context from <agent>]`
   chaining); each agent run updates Redis context; any `needsConfirmation`
   short-circuits the turn
8. Self-check loop: `selfCheckCompletion` (fast model, raw text capped at 4k chars,
   `{done, next_instruction}`), max 1 retry, attempts tracked in `PlanState` (Redis `ws:plan:*`)
9. Format: `formatOutputStreaming` (SSE) or `formatOutput` (formatter model)
10. Persist: append user+assistant (the **formatted** string — see LESSONS.md) to Mongo;
    `maybeRefreshSummary` every 10 turns (Haiku, ≤400 tokens, preserves IDs)
11. Final `updateContext` + SSE `done`

Also: `runConfirmAction` (backs `POST /api/agents/confirm`), `deleteConversationFull`
(Mongo + all Redis keys).

---

## 6. Memory Architecture (two layers + working set)

| Layer | Store | Key | TTL | Contents |
|---|---|---|---|---|
| Conversation history | MongoDB `Conversation` | unique `(company_id, user_id, conversation_id)` | ∞ | UI turns (formatted), rolling summary, per-turn `tool_activity` (compact tool transcript) |
| Canonical context | Redis | `ws:ctx:{companyId}:{userId}:{conversationId}` | 1800s | `entities` (numeric IDs from tool I/O), `entityRefs`, `recentResults` (top-10 rows × 5 sets), `workingSet`, `lastAgent/lastAction/lastSearch` |
| Pending write confirm | Redis | `ws:pending:{c}:{u}:{conv}` | 300s | `{confirmationId, tool, input, agentKey}` |
| Plan/retry state | Redis | `ws:plan:{c}:{u}:{conv}` | 1800s | `{attempts}` |
| Tool cache | Redis | `ws:cache:*` | 60s | estimate list/details only |

**Critical ID rule (Redis context):** Worxstream customer master IDs are **300-series**.
`resolveCustomerRecordId()` refuses 200-series list-row `id`s; a guard deletes them so
they're never promoted to `customer_id`. Downstream tools (`get_customer_details`,
`list_estimates customer_id=`) need the 300-series id.

**Working memory (`workingMemory.js`):** `workingSet = {sessionGoal, activeTask,
pendingClarification, lastOutcome, toolNotes}` — derived per turn via regex heuristics
(`deriveWorkingSetDelta`), merged, and rendered as a `[Session focus]` block in every
prompt. Failed tools record `lastOutcome.error` + a `suggestedNext` recovery hint.
`toolNotes` accumulates per-tool failure messages across the whole turn (capped at 5,
cleared when that tool later succeeds) and renders as "Known tool errors (fix
parameters BEFORE calling again)".

**Workflow tree visualization:** when a turn calls `get_workflow_object_tree`, the
pipeline captures the raw tree payload and appends `<workflow>{json}</workflow>` to the
formatted output after the formatter pass (deterministic — the JSON never round-trips
through an LLM; also emitted as a final SSE text delta in stream mode). The client
(`extractWorkflowFromXML` → `WorkflowVisualization`) renders it with React Flow:
subtree-based layout (one vertical slot per leaf), document cards per node, dashed
edges to task nodes, and `deposit` nodes mapped to payment fields (method, amount,
Paid/Pending from `paymentStatus`).

**Tool transcript replay (Cursor-style):** each assistant message persisted to Mongo
carries `tool_activity` = `[{tool, input (≤200 chars), ok, error?}]`
(`compactToolActivity` in `coworkerPipeline.js`). `normalizeStoredMessages` appends a
`[Tools used this turn]` block to assistant history messages, so router/Nova/specialists
all see which tools already ran, with what inputs, and what failed — preventing repeated
lookups and re-discovering the same validation errors.

**Redis is optional and fail-safe:** `redisClient.js` no-ops when unconfigured; all errors
swallowed. Outages never break a turn.

---

## 7. HTTP API Surface

Bootstrap (`app.js`): `validateConfig()` (exits on missing `ANTHROPIC_API_KEY` /
`WORXSTREAM_BASE_URL` / `MONGODB_URL`) → side-effect import registers all tools →
CORS → `express.json()` → static → routes → 404/error handlers. `startServer()`:
`connectDB()` → `initializeAgents()` → listen on `PORT` (3000). Redis connects lazily.

| Endpoint | Purpose |
|---|---|
| **`POST /api/agents/stream`** | **Primary chat (SSE).** Body `{message, conversation_id?, companyId?, userId?}`. Delegates fully to `runCoworkerTurn`. |
| `POST /api/agents/route` | Same pipeline, plain JSON response |
| `POST /api/agents/multi` | Run specified agents `{agents[], mode}` |
| `POST /api/agents/:agentKey` | Direct single specialist |
| `POST /api/agents/confirm` | Approve/reject pending write `{conversation_id, confirmationId, approved}` |
| `GET/DELETE /api/agents/conversations[/:id]` | Sidebar history / transcript / delete (Mongo + Redis cleanup) |
| `GET/PATCH /api/agents/preferences` | UserPreferences Mongo doc |
| `GET /api/agents` | List agents (key, name, domain, toolCount) |
| `POST|GET|DELETE /session` and `/api/auth/session` | Set/check/clear the global in-memory Worxstream session (one router mounted at both paths) |
| `POST /mcp` | **MCP Streamable HTTP endpoint** — external MCP clients (initialize / tools/list / tools/call) |
| `GET /api/tools[, /names, /debug/index]` | Tool listing / domain index |
| `GET /api/rex/dashboard, /logs, /stream` | Rex observability (JSON + SSE) |
| `POST /api/price-comparison/upload-and-compare` | Multer upload `oldFile`+`newFile` → `compareStocks` |
| `POST /api/webhooks/worxstream` | `{event_type, company_id?, payload?}`; optional `x-worxstream-webhook-secret`; runs `runCoworkerTurn` on a synthetic `webhook-<uuid>` conversation |
| `GET /health` | Status + model + tool count |

**SSE event protocol** (each line `data: {json}\n\n`): `conversation_id`, `status`
(`{label}`), `agent_selected`, `tool_use`, `tool_result`, `text` (formatted-XML chunks),
`clarification` (options), `confirmation_required`, `done`, `error`.
Authoritative contract doc: `FRONTEND_CHANGES.md`.

**Tenant resolution per request:** `requestContextMiddleware` (mounted after
`express.json` in `app.js`, scoped to `/api/agents|tools|price-comparison|webhooks`) binds
`{companyId, userId, apiToken}` from body/headers into AsyncLocalStorage.
`resolveWorxstreamCredentials()` resolves per field: **ALS → global session → env**
(`DEFAULT_COMPANY_ID`/`DEFAULT_USER_ID`/`WORXSTREAM_API_TOKEN`). Concurrent multi-tenant
requests are isolated; the API token can also come per request via `x-worxstream-token`
or `Authorization: Bearer`.

---

## 8. Output Formatting & Frontend Contract

`OutputFormatter.js` is a **second LLM pass** (Sonnet) run once per turn: raw specialist
text → presentation XML. Tags: `<stats>/<stat>`, `<table>/<headers>/<row>` (status badge
colors), `<details>/<item>`, `<alert>`, `<chart type="bar|line|pie|multi-bar">`, `<gauge>`,
`<trend>`, `<workflow>` (JSON → reactflow), `<list>/<item>`. Rules: never show raw ID
fields, ≤4–5 table columns, lists must be tables, no information added/removed.
`<milestones>` is banned in formatter output but parsed by the client.

The client (`client/src/utils/parseXML.ts`) regex-transforms this XML into styled HTML
(rendered via `dangerouslySetInnerHTML`); `<workflow>`/`<milestones>` are extracted and
rendered by React components. **The client never sees raw specialist output** — and the
formatted string is what gets persisted to Mongo (so history replays identically).

`client/src/hooks/useStreamingChat.ts` owns the whole backend connection. Identity
(companyId/userId) comes from an `IdentityModal` → localStorage. Note: the hook does not
yet handle `clarification`/`confirmation_required` events (documented in
`FRONTEND_CHANGES.md` as pending work).

`control_tower/` is a separate Vite app (port 5174) for the planned governance system —
currently **100% mock data** (`src/mock/controlTowerMockData.ts`) matching the design in
`docs/GOVERNANCE_CONTROL_TOWER_DESIGN.md` / `_VISION.md` (webhook-triggered master agents,
RAG over policy docs, `/api/control/*` CRUD — not yet implemented).

---

## 9. Observability — Rex

`AgentTracker.js` singleton: request lifecycle (`startRequest` → `routerResolved` →
`toolCall` → `agentFinished` → `formatterFinished` → `endRequest`), per-agent stats,
global counters, 200-entry ring buffer, SSE subscribers, JSONL log at `logs/rex.jsonl`
(timings: router/raw/formatter/total durations, token usage). Consumed by
`/api/rex/*` and the client's `RexDashboard`.

---

## 10. Configuration (env vars)

Required: `ANTHROPIC_API_KEY`, `WORXSTREAM_BASE_URL`, `MONGODB_URL`.

| Group | Vars |
|---|---|
| Worxstream | `WORXSTREAM_API_TOKEN`, `DEFAULT_COMPANY_ID`, `DEFAULT_USER_ID` (fallbacks when no session) |
| Models | `ANTHROPIC_MODEL` (sonnet), `ANTHROPIC_REPORTS_MODEL` (haiku), `ANTHROPIC_USE_TOOL_SEARCH`, `ANTHROPIC_MAX_TOKENS_AGENT/FORMATTER/ROUTER/NOVA/CONVERSATION[_SHORT]` |
| Runtime caps | `AGENT_MAX_TOOL_ITERATIONS` (15), `AGENT_MAX_AUTO_PAGES` (10), `AGENTS_SELF_CHECK_MAX_LOOPS` (1) |
| Context windows | `MAX_CONTEXT_MESSAGES/TOKENS`, `RESERVE_TOKENS` (orchestrator); `SPECIALIST_CONTEXT_MESSAGES` (6) / `_ACTIVE` (12) / `_TOKENS` (12k) / `SPECIALIST_RESERVE_TOKENS` |
| Memory | `CONVERSATION_SUMMARY_EVERY_N` (10), `WORKING_MEMORY_LLM_EVERY_N` (0=off) |
| Coworker | `COWORKER_CONFIRM_WRITES` (off by default), `COWORKER_PENDING_CONFIRM_TTL` (300) |
| Redis | `REDIS_URL` or `REDIS_HOST/PORT/USERNAME/PASSWORD/TLS/DB` (TLS auto for port 25061 / DO Valkey), `REDIS_CONTEXT_TTL_SECONDS` (1800), `REDIS_CACHE_TTL_SECONDS` (60) |
| Server | `PORT`, `NODE_ENV`, `CORS_ORIGINS`, `BACKEND_URL`/`PUBLIC_URL`, `WORXSTREAM_WEBHOOK_SECRET` |

---

## 11. Tests

`npm test` → `node --test test/**/*.test.js` (native runner, no framework, no server needed):

- `customer-followup` — clarification detection + "#2" pick resolution
- `mongo-roundtrip` — specialist history windows, summary prompt formatting
- `tenant-isolation` — ALS-per-request precedence, concurrent-tenant isolation, env fallback
- `working-memory` — workingSet delta/merge/prompt rendering, error→suggestedNext
- `write-confirm` — `isWriteTool` + `COWORKER_CONFIRM_WRITES` gating
- `agent-tool-domains` — every agent domain has tools; no orphan/unknown domains

Plus xlsx fixtures + `generateTestFiles.js` for the price-comparison flow.

---

## 12. Known Gaps, Quirks & In-Progress Work

1. `reports.js` breaks the content-envelope convention (handled by fallback path).
2. Client doesn't yet handle `clarification`/`confirmation_required` SSE events.
3. `control_tower/` is mock-only; `/api/control/*` governance API unimplemented.
4. Caching/pagination support is per-tool-module inconsistent (estimates cached,
   invoices paginated, others plain).
5. `/mcp` endpoint currently has no auth of its own — it relies on tenant resolution
   falling back to session/env; add a token check before exposing it publicly.

Resolved (kept for history): global-session-only credentials (now ALS per-request first),
vestigial `McpServer` (now a real `/mcp` Streamable HTTP endpoint), shallow Zod→JSON-Schema
conversion (now native `z.toJSONSchema`), all-tools fallback on empty domain buckets (now
zero tools + loud error), duplicate `/session` vs `/api/auth/session` routers (one router,
two mounts), unused `express-rate-limit` dependency (removed), dead legacy router paths
`routeToAgents`/`callAgentsParallel`/`callAgentsSequential` (removed; `callAgent` kept for
the planned governance `invoke_agent` tool).

---

## 13. How to Extend (recipes)

**Add a new tool:** create/extend a module in `src/mcp/tools/`, follow the skeleton
(`getWorxstreamContext()` → `callWorxstreamAPI` → content envelope), register it in
`src/mcp/tools/index.js` if it's a new module. Ensure a `DOMAIN_RULES` entry in
`toolCapabilities.js` matches the tool name (or pass explicit `capabilities`) — unmatched
tools land in `unknown` and are unreachable by every agent. Run
`test/context/agent-tool-domains.test.js` to verify.

**Add a new agent:** add an entry to `AGENT_DEFINITIONS` (key, name, description, domain,
systemPrompt) + a status label in `AGENT_STATUS_LABELS`. The router discovers it
automatically via `getAgentDescriptionsForRouter()`. Optionally add
`docs/playbooks/<domain>.md` and map it in `playbooks.js`.

**Add a playbook:** drop `docs/playbooks/<domain>.md` and add the domain to the map in
`src/agents/playbooks.js`. It becomes a permanent part of that agent's system prompt.

**New entry point:** ALWAYS go through `runCoworkerTurn` (LESSONS.md: unified pipeline) —
never call agents directly from routes, or history/context/formatting will diverge.

**New output element:** teach the `FORMATTER_PROMPT` (OutputFormatter.js) the new tag AND
add a parser branch in `client/src/utils/parseXML.ts`. Both sides must agree.

**Runtime behavior guarantees:** put them in `src/agents/policies/` or
`toolPolicyPipeline.js`, not in prompts — prompts drift.