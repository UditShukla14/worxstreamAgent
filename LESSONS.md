# Lessons

## Billing / Analytics

- **Anthropic `usage` is billing truth**: Persist token counts only from Messages API `response.usage` (via `src/llm/anthropicClient.js` → `recordUsage`). Never bill from `tokenCounter.js` estimates — those are context-window helpers only. Capture cache fields (`cache_creation_input_tokens`, `cache_read_input_tokens`) when present. Collections: `llm_usage_events` + `llm_usage_daily` in the `worxagent` Mongo DB (URL path). Platform reads are `/api/admin/analytics/*` behind `ADMIN_API_KEY`.
- **Multi-agent attribution, single configured model**: All Anthropic calls use `config.anthropic.model` (`ANTHROPIC_MODEL`, default `claude-sonnet-4-6`) — specialists, Nova, router, formatter, summary, governance. Billing still attributes each call to an `agent_key` (specialist key like `estimate`/`nova`, or phase label like `router`/`formatter`). Daily rollups keep company/user totals (`agent_key`+`model` empty) plus per-agent and per-model slices — do not collapse multi-agent turns into one opaque total.

## Architecture

- **Nova SMS is draft → confirm → Telnyx send**: MCP tools `draft_sms` / `send_sms` / `get_sms_status` in `src/mcp/tools/sms.js` call Telnyx REST via `src/services/telnyxClient.js`. Nova must draft, stop, then send on the next chat confirm. Confirmation is agent-judged (`usesAgentChatConfirm` skips `COWORKER_CONFIRM_WRITES`). **SMS draft memory** (not a separate agent): `ws:sms-draft:…` + `ws:sms-latest:{company}:{user}` so `send_sms` recovers when the model invents `"draft_id"`; conversation context also stores `sms_draft_id`. Every `draft_sms` appends `Type STOP to opt-out from further receiving any updates` unless the body already has STOP opt-out language. Do not add a dedicated SMS agent just for draft memory — orchestrator mode already owns the tools.
- **`→ send_sms` with no `Executing MCP tool` is the write-confirm gate**: When `COWORKER_CONFIRM_WRITES=true`, BaseAgent intercepts write tools before `executeMcpTool` and returns `confirmation_required`. Logs show `⏸️ … gated — awaiting write confirmation`. A broken Redis used to hang forever on `storePendingConfirm` (looked like a silent Telnyx failure). Redis commands now time out (`REDIS_COMMAND_TIMEOUT_MS`, default 3s) and pending confirms have an in-memory fallback. PM2 `pidusage` noise is unrelated.
- **SMS sender is destination-aware (Telnyx)**: NANP `+1` (US/CA/PR) must use purchased `TELNYX_FROM_NUMBER` (long code) — alphanumeric is unsupported and can failover oddly. International prefers `TELNYX_ALPHA_SENDER` + `TELNYX_MESSAGING_PROFILE_ID`. `resolveSmsRoute(to)` implements this; logs `path: nanp_long_code|intl_alpha`. Optional `TELNYX_US_MESSAGING_PROFILE_ID` for US-only profile. See Telnyx alphanumeric-sender-id + international-sms-compliance docs.

- **Single Nova orchestrator (default chat)**: `COWORKER_MODE=orchestrator` (default) runs one Nova + MCP tools with tool-search — skips router/Nova-plan/specialist fan-out. UI formatter still runs by default (tables/cards/badges via `OutputFormatter`); set `formatOutput: false` to skip. Use `COWORKER_MODE=specialists` or `options.agentKeys` for the legacy multi-agent path.

- **Calls list filter matches web UI**: `list_call_sessions` posts `filter.advance` with `started_at` BETWEEN and `value: [from, to]` (array) — not `created_at` and not `"from,to"`. Optional status/outcome/assigned_to advance filters. Pass `app_id` when known. Resolve status/outcome IDs via `get_call_session_filters`.

- **List page-wise only (hard safety)**: Never dump full tenant lists into the model (e.g. 3000+ invoices). `normalizeListInput` strips `all_pages` and clamps `limit` to `AGENT_MAX_LIST_PAGE_SIZE` (default 25). BaseAgent does not multi-page aggregate. List tools return `has_more` / `next_page`; Nova shows one page and asks before fetching the next.

- **Two products, two folders**: Coworker (Nova + specialists) lives in `src/nova/`. Control Tower (Aegis/Vigil/Scribe, webhooks, catalog, reports) lives in `src/governance/`. Shared kernel stays at `src/{config,mcp,middleware,utils,...}`. Do not put governance agents under Nova or reintroduce `invoke_agent` → chat specialists. Aegis uses `GovernanceAgent` (no SOUL/playbooks/write-confirm); Nova uses `BaseAgent`.

- **Nova MCP fine-tuning**: Shared DATE/STATUS/INTER-AGENT/PROPORTIONALITY rules live in `coworkerRules.js` (appended once by `BaseAgent`) — do not duplicate them in specialist prompts. Chart XML for reports lives in `docs/playbooks/reports-charts.md`. External `POST /mcp` excludes governance tools and registers coworker resources/prompts via `src/nova/mcpSurface.js`. CRM/communications are tool-search pilots with wider allow-lists (`crm`+`deal`; communications `extraTools` for document lookup).

- **Structured governance thresholds**: When a live catalog item’s text encodes an extractable numeric rule (margin below X%, stock less than N), `structuredChecks.js` evaluates it deterministically and merges over Aegis JSON for that check name. Prose-only catalog items stay LLM-only — never invent thresholds absent from the catalog.

- **New chat domains wrap remaining apps/web APIs**: `sales_order`, `inventory`, `deal`, `crm`, `calls` (voice-agent session reports from `voiceAgentSessionReportService`), `payments`, `communications`, `shopify` (Sales Channel via `shopifyService`). Endpoints and payloads come from `apps/web/src/services/apiEndpoints.ts` + the matching `*Service.ts` — do not invent paths. Auth, Stripe checkout, Ably, and QuickBooks stay out of agent tools. Shopify tools live in `src/mcp/tools/shopify.js`; put `shopify` ahead of `product`/`customer` in `DOMAIN_RULES` so `list_shopify_*` stays in the shopify bucket. `create_shopify_document` uses DB `order_id` (not Shopify GID); refresh/PO tools use `shopify_order_id`. `salesorder` is the master-object `appName`/`app_name`; tool names use `sales_order`. CRM `list_calls` is object-attached logs (`/modules/get-calls`); Calls page sessions use `list_call_sessions` (`/livekit/voice-agent/session-report/*`). `payment_instruction` must stay ahead of `received_payment` / `payment_method` / `deposit` in `DOMAIN_RULES`. `pipeline` maps to the deal agent; report pipeline tools stay in `reports` via the `*_report`/`goal` special case.

- **Entity labels must use event_type, not customNumber-as-estimate**: Invoices and estimates both send `customNumber`. Labeling from that field first made every run `Estimate #…`. Prefer `event_type` (`invoice.*` → Invoice). Recompute on `runToApi` from payload + event type so historical rows fix without a Mongo migrate.

- **Vigil is housekeeping, not a pipeline master**: `vigil` reviews stored alerts against the current catalog. It permanently deletes stale ones and re-checks remaining open alerts with Aegis (`evaluateGovernanceEvent`, live entity overlay). Do not instantiate Vigil as a GovernanceAgent or put it on the dashboard. Chat router never sees `vigil`. Aegis remains the only event-evaluation agent.

- **Alert sweep permanently deletes and can resolve**: `POST /api/control/alerts/sweep` streams NDJSON. Stale alerts are hard-deleted. Open catalog-backed alerts are resolved when the current check passes or is omitted; they stay open if still flagged. Fail closed (keep) when the re-check has no structured findings. `POST /api/control/alerts/delete` hard-deletes by `alert_id`. Do not soft-delete sweep results with `deleted_at`.

- **Vigil live overlay is opt-in**: `hydrateSharedContext({ preferLiveEntity: true })` fetches the current estimate/invoice and overlays it on the stored run payload so status updates reflect current values. The webhook pipeline must keep `preferLiveEntity` off — inbound payload remains source of truth for the original run.

- **Control `/api/control` requires a WorxStream JWT**: Middleware `requireControlAuth` verifies the Bearer token with `GET /api/user-info` and binds `company_id` / `user_id` to that session. Query `company_id` alone is not enough. Cache identity for 60s per token.

- **Failed-delivery redeliver starts Aegis from the stored payload**: `POST /api/control/deliveries/redeliver` (JWT) runs `acceptGovernanceEvent` on the delivery `requestPayload`. It does not ask WorxStream to re-POST. Use a new `event_id` (`{deliveryId}:redeliver:{uuid}`) so ProcessedEvent dedupe does not skip the run.

- **Webhook signing secret is optional**: `WORXSTREAM_WEBHOOK_SECRET` is not required. If unset, `POST /api/webhooks/worxstream` accepts unsigned deliveries. When set, accept `X-Worxstream-Webhook-Secret` or HMAC-SHA256 of the raw body in `X-Worxstream-Signature`. Do not 401 just because the secret env var is empty.

- **Alert API includes `runId`**: `alertToApi` exposes stored `run_id` so Control Tower can open `/runs?run=`. Do not drop it.

- **Dashboard Aegis stats use prefix / pipeline**: Attribute runs where `pipeline` contains `aegis` or `agentKey` starts with `aegis_`. Pass rate is from run `status`, not finding keys.

- **Orphaned running runs are marked error on boot**: `reconcileOrphanedRuns` after Mongo connect. Do not leave `status: running` ghosts after a deploy.

- **Persistent catalog context, not a per-run Mongo fetch**: Active policies and active rules live in `catalogContext` (process memory, Redis when enabled, no TTL). Aegis and `get_relevant_policies` read that snapshot. Mongo loads only on a miss. Create/update/delete of a policy or rule invalidates it (Mongoose save/delete hooks + seed refresh). Filter by `event_type` in memory. Empty catalog → pass with no findings. `mergeCatalogFindings` still drops leftover invented names. Seeded margin rules (`Flag Low Margin Estimates`) are estimate events only unless you add invoice types.

- **Alert prepared by comes from the payload, not Aegis text**: Persist `prepared_by` from `preparedBy` / `prepared_by` / `preparedByDetails` (name, then email) when creating alerts; fall back to `createdBy.name`. Control Tower shows it as a **Prepared by** column so operators can see who created the document. Skip raw numeric IDs. Existing alerts without the field fall back to the linked run payload in `alertToApi`.

- **Alert customer type comes from the payload, not Aegis text**: Persist `customer_type` from `customer.customerType.label` (or `value` / `customer_type` / `type_of_customer`) when creating alerts. Control Tower shows Reseller / Contractor / etc. on the alert detail card. Skip raw numeric type IDs. Existing alerts without the field fall back to the linked run payload in `alertToApi`.

- **Control Tower UI is not in this app**: The governance frontend lives in `apps/control-tower`. Pipeline runtime is `src/governance/` (Aegis, persistent catalog context, Mongo policies/rules/runs/alerts). Chat router never sees governance keys.

- **Aegis is the only governance agent**: Aegis (`aegis`) evaluates every active policy/rule for an event. Do not add a new master per policy — add the policy/rule in Control Tower; Aegis reads the persistent catalog context. Chat router never sees `aegis`. Aegis must not call Nova specialists (`invoke_agent` was removed). Event entry is only `POST /api/webhooks/worxstream`. Historical runs may still show Profit Policy / Inventory / Customer step names. Rules store `event_types[]` (plus legacy `event_type` for the first). Do not reject unknown catalog codes against the old 10-type allowlist — a rule applies when any listed type matches. Non-empty webhook events without a named pipeline still run Aegis.

- **WorxStream webhook body is `event` / `object` / `data`**: Production POSTs send `{ event: "estimate_updated", deliveryId, companyId, occurredAt, object: { type, id }, data }`, not `event_code` + `payload`. `eventFromWorxstreamWebhook` must accept `event` (and header `X-WorxStream-Event`), copy `object.id` onto `estimate_id` when `data.estimateId` is null, and treat `data` as the payload. Missing that returns HTTP 400.

- **Governance inventory hydration must read product service ids**: Estimate/invoice line items may omit `product_id` and send `productServiceId`. Line items often live in `sections[].items[]`, not a top-level `items` array. `hydrateSharedContext` must flatten those sections, preserve `product_service_id`, and use it as a product lookup fallback, or snapshot `products` stays empty and inventory checks become missing-data errors.

- **Shared entity snapshot before Aegis**: `hydrateSharedContext` fetches the event entity once (estimate/invoice/customer/products) and injects it into Aegis. Empty nested webhook `payload: {}` must not wipe delivery `objectId` (`fromDelivery.js`). Product stock is often `qty`, mapped to `stock_qty`.

- **WorxStream webhook payload is Aegis source of truth**: Financial fields, line items, customer, and status come from the event payload JSON exactly as WorxStream sends them — no field picking or remapping in `hydrateSharedContext`. That module only resolves IDs and fetches enrichment the payload lacks (overdue invoices for credit hold, product stock when line items have no `availableQty`). Sparse payloads get `enrichment.from_api` as a fallback; substantive payloads skip entity API fetches entirely.

- **Aegis run steps are catalog items, not one wrapper**: Persist one step per active policy and applicable rule. If Aegis JSON fails or is truncated, keep those named steps as errors — never collapse the drawer to a single "Aegis check". Control Tower should show `detail` as the step body, not only the short `message`.

- **Aegis findings become pipeline steps**: Aegis returns `findings[]` (one per applicable policy/rule). The runner matches those onto catalog steps and opens an alert per flag/error. List endpoints `GET /api/control/{runs,alerts,policies,rules,deliveries}` are paginated (`page`, `per_page` alias `limit`, default 20, max 100) and return `{ data, pagination }`. Control Tower loads them on page load, filter change, Refresh, and after mutations — do not poll. Soft-deleted runs and deliveries (`deleted_at`) are omitted from list queries. Do not expose `GET /deliveries/hidden` — never fetch deleted IDs for the client to filter.

- **Pipeline stop is cooperative**: `POST /api/control/runs/:runId/stop` marks the run `stopped` and the runner skips remaining work after the current `agent.run()`. `POST /api/control/runs/:runId/restart` queues a new run from the stored payload; do not restart while status is `running`. Persist `payload` + `user_id` on `PipelineRun` so restart works without the original webhook.

- **Governance seed is bootstrap-only**: `npm run seed:governance` inserts default policies/rules for an **empty** tenant (matched by `seed_key`). It does **not** run on agent startup. Aegis reads whatever is in Mongo via Control Tower — `seed_key` is ignored at runtime. Re-running seed is **insert-only** by default; existing seed rows are skipped so Control Tower edits are kept. Use `SEED_FORCE_UPDATE=1` only in dev to reset seeded rows to `seedData.js`. User-created rules have no `seed_key`.

- **User-created governance rules omit seed_key**: Seeded rows use unique `(company_id, seed_key)`. User rules must not store `seed_key: null`. Models use a partial unique index (`seed_key` is string only), unset null/empty `seed_key` on save, and `ensureGovernanceSeedKeyIndexes()` runs on Mongo connect to drop legacy indexes and `$unset` bad rows.

- **Scribe scheduled reports (Control Tower)**: `ReportDefinition` stores interval + criteria (`missing_fields` | `negative_profit`); `ReportRun` stores matched rows. Scheduler ticks every 60s (`startReportScheduler` on boot). Manual runs use the Control Tower JWT; scheduled runs use `WORXSTREAM_API_TOKEN` + definition `user_id`. Lists entities via `/master-objects/list` with `created_at BETWEEN` the period, enriches with show for missing-field checks. APIs: `/api/control/report-definitions`, `/api/control/report-runs`.

- **Per-request tenant context via AsyncLocalStorage**: `requestContextMiddleware` binds `{companyId, userId, apiToken}` from body, query, or headers into ALS for `/api/agents|tools|price-comparison|webhooks|control`. Token-only env fallback (`WORXSTREAM_API_TOKEN`) is allowed for `/api/tools` and `/api/webhooks`. **Never use `DEFAULT_COMPANY_ID` / `DEFAULT_USER_ID`** — every user has their own ids. Conversation Mongo: `resolveConversationTenantIds` (request → session → ALS); missing ids → 400.

- **The MCP server is dual-faced**: the in-process `toolRegistry` Map in `src/mcp/server.js` is the source of truth used by agents (`executeMcpTool`); external MCP clients connect via Streamable HTTP at `POST /mcp` (stateless: a fresh `createMcpServer()` + transport per request, since an SDK server binds to one transport). Never re-introduce a module-level connected `McpServer`.

- **Use zod v4's native `z.toJSONSchema` for tool schemas**: the old hand-rolled converter flattened nested objects/unions to `{type:'string'}`, hiding `filter.advance` structure from the model. Conversion is memoized per tool; strip `$schema`/top-level `additionalProperties` for Anthropic's `input_schema`.

- **Tool domains use ordered explicit rules, never substring guessing**: `DOMAIN_RULES` in `toolCapabilities.js` (first match wins, most specific first — e.g. `organization_contact`→company must precede `contact`). `BaseAgent.getTools()` never falls back to all tools — an empty domain bucket logs an error and returns `[]` (with tool search enabled, `[]` allowList would still leak all tools through BM25, so return a plain `[]`). Guarded by `test/context/agent-tool-domains.test.js`.

- **Agents can span multiple tool domains**: set `domains: ['a', 'b']` on the definition (e.g. finance = `['finance','config']`); `BaseAgent` unions the buckets. Prefer this over duplicating tools into a second domain.

- **Universal `resolve_entity` meta-tool for name→ID resolution**: every agent automatically gets the `lookup` domain bucket (`BaseAgent.getTools()` appends it), whose single `resolve_entity` tool dispatches `{entity_type, query}` to the right lookup tool (team_member/customer/contact/product/vendor/tax/department/branch/job/project/task) and returns compact scored matches. Agents must NEVER ask the user for an internal ID — the global ID RESOLUTION prompt rule enforces this. Dispatch targets are test-guarded.

- **Cross-domain lookups via `extraTools`, not user prompts**: strict domain scoping broke prompts that assumed access to `get_customer_dropdown`/`get_team_members_dropdown` etc., so agents asked users for IDs they could look up themselves. Cherry-pick the few read-only lookup tools an agent needs via `extraTools: [...]` on its definition (good for tools its prompt names directly); for everything else `resolve_entity` covers it. Typos fail in `agent-tool-domains.test.js`.

- **Worxstream API creds vs conversation tenant**: MCP tools and chat use the request/session `companyId`/`userId` (user JWT, or optional env `WORXSTREAM_API_TOKEN` for the token only). Scribe scheduled runs use the report definition’s `company_id`/`user_id` + `WORXSTREAM_API_TOKEN`. Do not reintroduce a global DEFAULT tenant — that collapsed every user’s conversations and API calls onto one identity.

- **Tool transcripts must survive the turn (Cursor-style memory)**: Mongo only stored user text + formatted assistant text, so the next turn's agent had NO idea which tools already ran — it repeated the same lookups and re-discovered the same API validation errors every turn. Fix: `persistConversation` stores a compact `tool_activity` array on each assistant message (tool, capped input, ok/error), and `normalizeStoredMessages` replays it as a `[Tools used this turn]` block in agent history.

- **Coworker working memory**: Redis `ConversationContext` includes `workingSet` (session goal, active task, pending clarification, lastOutcome, toolNotes) via `src/nova/agents/workingMemory.js` — not only numeric IDs. Injected in `buildContextPrompt` as `[Session focus]`. `toolNotes` accumulates per-tool failure messages (e.g. "create_task: The issue type field is required", capped at 5) and clears each note when that tool succeeds — `lastOutcome` alone only remembered the final tool of a turn.

- **Unified pipeline**: Chat entry points should use `runCoworkerTurn` in `src/nova/agents/coworkerPipeline.js` so Mongo history, Redis context, formatter, and summary stay consistent. Governance webhooks are the exception — they call `runPipeline` in `src/governance/`, not the coworker turn.

- **Cheaper conversation memory**: MongoDB stores UI turns; `/api/agents/stream` loads them each request. Router/Nova/general chat use `manageContextWindow` (full cap). Specialists get `SPECIALIST_CONTEXT_MESSAGES` recent turns via `_conversationHistory` in `BaseAgent`. Redis `ConversationContext` remains for canonical IDs — both layers together.

- **Hosted Valkey/Redis (e.g. DigitalOcean)**: Prefer `REDIS_HOST` + `REDIS_PORT` + `REDIS_USERNAME` + `REDIS_PASSWORD` (or a single `rediss://…` URL) in `.env`; `src/config/index.js` builds a TLS URL for port `25061` automatically. Never commit credentials.

- **Persist formatter output for agent turns, not raw agent text**: Specialist runs produce `combinedRawText`; `formatOutputStreaming` turns that into UI XML (`<table>`, etc.). MongoDB must store the **formatted** string (returned from the formatter) so conversation history replays the same HTML parsing as the live stream. Storing only raw text caused history to show plain lists and extra unformatted fields.

- **Worxstream customer ids are 300-series**: `list_customers` rows may include a 200-series `id` (record/contact) and a separate master id (`customer_id` / `customerId`, e.g. `30000000037`). `get_customer_details` and Redis context must use the **300-series** id only. Do not copy example ids from prompts (e.g. `20000001109`).
- **Canonical ID slots beat “raw id”**: List/detail APIs often return `id`, but downstream tools require domain-specific slots like `customer_id`. Use `resolveCustomerRecordId()` in `ConversationContext.js` and match list rows by email/search before setting `customer_id`.
- **Context must be tenant-scoped**: Any shared context store (Redis) should key by `(company_id, user_id, conversation_id)` to avoid cross-tenant collisions and confusing follow-up behavior.

- **Workflow trees are embedded deterministically, never via the formatter LLM**: `runCoworkerTurn` captures the `get_workflow_object_tree` payload and appends `<workflow>{json}</workflow>` AFTER formatting (also streamed as a final text SSE event). Asking Haiku to copy a large JSON tree verbatim is unreliable and token-expensive; the formatter prompt explicitly forbids emitting `<workflow>` itself. The client extracts the tag in `Message.tsx` and renders it with React Flow (`WorkflowVisualization`).

- **Aegis system prompt is static at process start**: `BaseAgent` bakes `systemPrompt` in the constructor. Live policy/rule text must go in the per-run user message from `catalogContext` (`loadPolicyCatalog` + `buildMasterMessage`). Do not put catalog content in the system prompt.

- **Inactive rules stay in RAG until de-indexed**: Creating or saving a rule used to always `reindexDocument`. Sync on save: index if `active`, otherwise `removeDocumentChunks`. Aegis evaluation uses the persistent catalog context, not RAG retrieval.

- **Bulk alert resolve is POST, not N PATCHes**: `POST /api/control/alerts/resolve` with `alert_ids` sets matching open alerts to `resolved`. Control Tower bulk-select uses that endpoint, not a loop of `PATCH /alerts/:id`.

- **Single Anthropic model, no dated snapshots**: All calls use `ANTHROPIC_MODEL` (default `claude-sonnet-4-6`). Dated snapshot IDs in env are rejected and fall back to the main model; retired IDs are auto-migrated.

- **Worxstream HR endpoints require `user_id` even for dropdowns**: `/hr/team-members/dropdown-list` 400s with "User ID is required" when only `company_id` is sent. Always pass both from `getWorxstreamContext()` in HR tools.

- **Haiku wraps output in markdown code fences**: any Haiku call whose output is consumed programmatically (router JSON, Nova plan, formatter XML) MUST strip \`\`\` fences before parsing/rendering — and prompts should explicitly forbid fences. Sonnet rarely does this, so the bug only appears after switching a call to the fast model. Strips live in `router.js`, `coworkerPipeline.js` (`stripJsonCodeFence`), `OutputFormatter.js` (`stripCodeFence`), and `client/src/utils/parseXML.ts`.

## Performance

- **Control calls use the main model with trimmed history**: router, Nova plan, and self-check use `config.anthropic.model` and only the last ~6 turns.
- **Skip Nova for single-agent routes**: when the router returns one agent, the plan is trivially `{mode:'single'}` — calling Nova to confirm it was a full wasted LLM round-trip on the most common path.
- **Parallelize turn pre-work**: Mongo history, Redis context, and user preferences are independent — `Promise.all` them in `runCoworkerTurn` instead of five sequential awaits. Emit a `status` SSE event immediately at turn start so the UI shows activity before any I/O completes.

## Date/Time

- **Inject current date/time into agent context**: Agents need the current date to resolve relative phrases like "last month", "this week", "last quarter". Use `getCurrentDateTimeContext()` from `src/utils/dateContext.js` and prepend it to system prompts (legacy chat) or conversation context (multi-agent flow).
- **List policies are schema + safety, not intent**: `listPolicies.js` normalizes date filters and **hard-caps** list pages (`all_pages` stripped, `limit` clamped). Status filtering belongs in the model's answer. Do not reintroduce keyword "all"/"paid" scanners or multi-page dumps.


## Frontend/Rex Dashboard

- **Dashboard JSON must not assume `tools` on every definition**: `GET /api/rex/dashboard` used `AGENT_DEFINITIONS[key].tools.length`. Nova has no `tools` (others use `extraTools`), which 500s the REST snapshot while `/api/rex/stream` still works. Use `tools?.length ?? extraTools?.length ?? 0`.
- **Rex dashboard component must exist**: The App.tsx imports `RexDashboard` from `./components/RexDashboard` and routes `/rex` to it, but the component file was missing. Always ensure imported components exist, especially for admin interfaces that might not be frequently accessed during development.

## Reports & Analytics

- **Charts are MANDATORY for all reports**: The Reports Agent must ALWAYS generate visual charts for numerical data. Never present reports without charts, KPI cards, and visual elements. This is a hard requirement, not optional.
- **Minimum required elements**: Every report must include: 1) Executive summary, 2) KPI cards, 3) At least one chart, 4) Data table, 5) Trend indicators when applicable.
- **Reports emit chart XML in the agent prompt**: The Reports Agent writes `<chart>`, `<gauge>`, and `<trend>` tags in raw output. The frontend parses those tags. Do not depend on unused helper modules for this.
- **Report revisions stay on the same report**: When the user asks to change an existing report in the conversation (chart type, filters, sections, date range), Nova/reports revise that report only — do not draft a full new report pack. Playbook `reports.md` + `reports-charts.md` minimum pack apply to **new** reports; OutputFormatter must not expand a partial revision into a new full pack.
- **AI chat report download**: `apps/web` Message bubble shows Download report for report messages (`isDownloadableAgentReport`). Formats: HTML file, CSV (tables), Print/Save as PDF. Implemented in `pages/AI/utils/downloadAgentReport.ts` — no jspdf dependency.
- **Stream like OpenAI/Claude (fences, not bulk sections)**: Transport = continuous text deltas via `createDeltaCoalesceBuffer` (~40ms / ~96 chars). UI = `splitStreamingUiContent` + `StreamingSnippetPanel` for an unclosed `<table>`/`<chart>`/… (same idea as an open ``` fence). Do not hold entire tables on the server before sending. Large reports: continue on `stop_reason=max_tokens` (OutputFormatter up to 3 passes); `resolveFormatterMaxTokens` scales with raw size.
- **Reports require visual formatting**: When generating **new** reports, use the extended XML tags (`<chart>`, `<gauge>`, `<trend>`) in the output formatter. Include executive summaries with key insights and actionable recommendations.
- **Chart types by data**: Bar charts for comparisons, line charts for trends, pie charts for distributions, multi-series for multiple metrics, gauges for goal progress, and trend indicators for period-over-period changes.
- **Charts require explicit XML generation**: Reports Agent MUST generate specific XML tags (`<chart>`, `<stats>`, `<gauge>`, `<trend>`) in raw output. The frontend parses these tags for visual rendering. Agent prompts must include chart XML examples to ensure proper generation.
- **Chart CSS requires valid variables**: Chart containers use `var(--bg-chat)` not `var(--bg-primary)` in CSS. All chart CSS variables must map to existing theme variables defined in index.css.
- **Use specific report tools not generic list tools**: Reports Agent should use `generate_estimate_report`/`generate_invoice_report` rather than `list_estimates`/`list_invoices` when generating reports. Only fall back to generic list tools if report endpoints return 404.
- **Context injection pattern**: Report tools get `companyId`/`userId` from `getWorxstreamContext()` and inject them into API calls as `company_id`/`user_id`, removing the need for agents to manually pass these parameters.
- **Data type conversion in MCP tools**: Agent parameters may come as strings, so MCP tools must convert them to proper types (Boolean for booleans, Number for numbers). Use explicit conversion: `Boolean(param)`, `Number(param)`.
- **Field name mapping**: API may expect different field names than tool parameters (e.g., tool uses `line_items` but API expects `lineItems`). Map field names in the tool implementation.
- **Report tools must hit the reports domain first**: tools like `generate_invoice_report` contain `invoice` — the reports special-case in `toolCapabilities.js` must stay ahead of all entity rules. (Domain rules themselves: see Architecture section.)
- **All agents use the main model**: `config.anthropic.model` (`ANTHROPIC_MODEL`, default `claude-sonnet-4-6`) for specialists, router, formatter, reports, and summaries.
- **Line item data must be explicitly requested**: Reports Agent should always use `line_items=true` parameter in report generation and include detailed product/service breakdowns, top performers, and margin analysis. Enhanced system prompt ensures comprehensive line item analysis with dedicated charts and tables.
