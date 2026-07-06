# Lessons

## Architecture

- **Per-request tenant context via AsyncLocalStorage**: `requestContextMiddleware` (mounted in `app.js` after `express.json`) binds `{companyId, userId, apiToken}` from the request body/headers into ALS for `/api/agents|tools|price-comparison|webhooks`. `resolveWorxstreamCredentials()` resolves per field: ALS → global session (`POST /session`) → env defaults. This makes concurrent multi-tenant requests safe; the global session is only a fallback.

- **The MCP server is dual-faced**: the in-process `toolRegistry` Map in `src/mcp/server.js` is the source of truth used by agents (`executeMcpTool`); external MCP clients connect via Streamable HTTP at `POST /mcp` (stateless: a fresh `createMcpServer()` + transport per request, since an SDK server binds to one transport). Never re-introduce a module-level connected `McpServer`.

- **Use zod v4's native `z.toJSONSchema` for tool schemas**: the old hand-rolled converter flattened nested objects/unions to `{type:'string'}`, hiding `filter.advance` structure from the model. Conversion is memoized per tool; strip `$schema`/top-level `additionalProperties` for Anthropic's `input_schema`.

- **Tool domains use ordered explicit rules, never substring guessing**: `DOMAIN_RULES` in `toolCapabilities.js` (first match wins, most specific first — e.g. `organization_contact`→company must precede `contact`). `BaseAgent.getTools()` never falls back to all tools — an empty domain bucket logs an error and returns `[]` (with tool search enabled, `[]` allowList would still leak all tools through BM25, so return a plain `[]`). Guarded by `test/context/agent-tool-domains.test.js`.

- **Agents can span multiple tool domains**: set `domains: ['a', 'b']` on the definition (e.g. finance = `['finance','config']`); `BaseAgent` unions the buckets. Prefer this over duplicating tools into a second domain.

- **Universal `resolve_entity` meta-tool for name→ID resolution**: every agent automatically gets the `lookup` domain bucket (`BaseAgent.getTools()` appends it), whose single `resolve_entity` tool dispatches `{entity_type, query}` to the right lookup tool (team_member/customer/contact/product/vendor/tax/department/branch/job/project/task) and returns compact scored matches. Agents must NEVER ask the user for an internal ID — the global ID RESOLUTION prompt rule enforces this. Dispatch targets are test-guarded.

- **Cross-domain lookups via `extraTools`, not user prompts**: strict domain scoping broke prompts that assumed access to `get_customer_dropdown`/`get_team_members_dropdown` etc., so agents asked users for IDs they could look up themselves. Cherry-pick the few read-only lookup tools an agent needs via `extraTools: [...]` on its definition (good for tools its prompt names directly); for everything else `resolve_entity` covers it. Typos fail in `agent-tool-domains.test.js`.

- **Worxstream credentials from env/session**: `getWorxstreamContext()` and MCP tools use per-request ALS context first, then `POST /session` credentials, then `WORXSTREAM_API_TOKEN`, `DEFAULT_COMPANY_ID`, and `DEFAULT_USER_ID` from `.env`. Chat `companyId`/`userId` in the request body now scope both Mongo/Redis conversations AND Worxstream API calls.

- **Tool transcripts must survive the turn (Cursor-style memory)**: Mongo only stored user text + formatted assistant text, so the next turn's agent had NO idea which tools already ran — it repeated the same lookups and re-discovered the same API validation errors every turn. Fix: `persistConversation` stores a compact `tool_activity` array on each assistant message (tool, capped input, ok/error), and `normalizeStoredMessages` replays it as a `[Tools used this turn]` block in agent history.

- **Coworker working memory**: Redis `ConversationContext` includes `workingSet` (session goal, active task, pending clarification, lastOutcome, toolNotes) via `src/agents/workingMemory.js` — not only numeric IDs. Injected in `buildContextPrompt` as `[Session focus]`. `toolNotes` accumulates per-tool failure messages (e.g. "create_task: The issue type field is required", capped at 5) and clears each note when that tool succeeds — `lastOutcome` alone only remembered the final tool of a turn.

- **Unified pipeline**: All agent entry points should use `runCoworkerTurn` in `src/agents/coworkerPipeline.js` so Mongo history, Redis context, formatter, and summary stay consistent.

- **Cheaper conversation memory**: MongoDB stores UI turns; `/api/agents/stream` loads them each request. Router/Nova/general chat use `manageContextWindow` (full cap). Specialists get `SPECIALIST_CONTEXT_MESSAGES` recent turns via `_conversationHistory` in `BaseAgent`. Redis `ConversationContext` remains for canonical IDs — both layers together.

- **Hosted Valkey/Redis (e.g. DigitalOcean)**: Prefer `REDIS_HOST` + `REDIS_PORT` + `REDIS_USERNAME` + `REDIS_PASSWORD` (or a single `rediss://…` URL) in `.env`; `src/config/index.js` builds a TLS URL for port `25061` automatically. Never commit credentials.

- **Persist formatter output for agent turns, not raw agent text**: Specialist runs produce `combinedRawText`; `formatOutputStreaming` turns that into UI XML (`<table>`, etc.). MongoDB must store the **formatted** string (returned from the formatter) so conversation history replays the same HTML parsing as the live stream. Storing only raw text caused history to show plain lists and extra unformatted fields.

- **Worxstream customer ids are 300-series**: `list_customers` rows may include a 200-series `id` (record/contact) and a separate master id (`customer_id` / `customerId`, e.g. `30000000037`). `get_customer_details` and Redis context must use the **300-series** id only. Do not copy example ids from prompts (e.g. `20000001109`).
- **Canonical ID slots beat “raw id”**: List/detail APIs often return `id`, but downstream tools require domain-specific slots like `customer_id`. Use `resolveCustomerRecordId()` in `ConversationContext.js` and match list rows by email/search before setting `customer_id`.
- **Context must be tenant-scoped**: Any shared context store (Redis) should key by `(company_id, user_id, conversation_id)` to avoid cross-tenant collisions and confusing follow-up behavior.

- **Workflow trees are embedded deterministically, never via the formatter LLM**: `runCoworkerTurn` captures the `get_workflow_object_tree` payload and appends `<workflow>{json}</workflow>` AFTER formatting (also streamed as a final text SSE event). Asking Haiku to copy a large JSON tree verbatim is unreliable and token-expensive; the formatter prompt explicitly forbids emitting `<workflow>` itself. The client extracts the tag in `Message.tsx` and renders it with React Flow (`WorkflowVisualization`).

## Gotchas

- **Single Anthropic model, no dated snapshots**: All calls use `ANTHROPIC_MODEL` (default `claude-sonnet-4-6`). Dated snapshot IDs in env are rejected and fall back to the main model; retired IDs are auto-migrated.

- **Worxstream HR endpoints require `user_id` even for dropdowns**: `/hr/team-members/dropdown-list` 400s with "User ID is required" when only `company_id` is sent. Always pass both from `getWorxstreamContext()` in HR tools.

- **Haiku wraps output in markdown code fences**: any Haiku call whose output is consumed programmatically (router JSON, Nova plan, formatter XML) MUST strip \`\`\` fences before parsing/rendering — and prompts should explicitly forbid fences. Sonnet rarely does this, so the bug only appears after switching a call to the fast model. Strips live in `router.js`, `coworkerPipeline.js` (`stripJsonCodeFence`), `OutputFormatter.js` (`stripCodeFence`), and `client/src/utils/parseXML.ts`.

## Performance

- **Control calls use the main model with trimmed history**: router, Nova plan, and self-check use `config.anthropic.model` and only the last ~6 turns.
- **Skip Nova for single-agent routes**: when the router returns one agent, the plan is trivially `{mode:'single'}` — calling Nova to confirm it was a full wasted LLM round-trip on the most common path.
- **Parallelize turn pre-work**: Mongo history, Redis context, and user preferences are independent — `Promise.all` them in `runCoworkerTurn` instead of five sequential awaits. Emit a `status` SSE event immediately at turn start so the UI shows activity before any I/O completes.

## Date/Time

- **Inject current date/time into agent context**: Agents need the current date to resolve relative phrases like "last month", "this week", "last quarter". Use `getCurrentDateTimeContext()` from `src/utils/dateContext.js` and prepend it to system prompts (legacy chat) or conversation context (multi-agent flow).
- **Enforce list policies at runtime**: Apply shared behaviors in `BaseAgent` so prompts can’t drift: normalize date filters (`created_date` → `created_at`, BETWEEN arrays → `"from,to"`), paginate automatically for “all” requests (with a safe cap), and filter by status labels like Open/Paid without putting status into `filter.search`. Policies live in `src/agents/policies/listPolicies.js`.


## Frontend/Rex Dashboard

- **Rex dashboard component must exist**: The App.tsx imports `RexDashboard` from `./components/RexDashboard` and routes `/rex` to it, but the component file was missing. Always ensure imported components exist, especially for admin interfaces that might not be frequently accessed during development.

## Reports & Analytics

- **Charts are MANDATORY for all reports**: The Reports Agent must ALWAYS generate visual charts for numerical data. Never present reports without charts, KPI cards, and visual elements. This is a hard requirement, not optional.
- **Minimum required elements**: Every report must include: 1) Executive summary, 2) KPI cards, 3) At least one chart, 4) Data table, 5) Trend indicators when applicable.
- **Use chart generation utilities for visual reports**: The Reports Agent should leverage `ChartGenerator` and `ReportAnalytics` utilities to create visual charts, KPI cards, and performance gauges. Use `generateMandatoryDashboard()` to ensure all required elements are present.
- **Reports require visual formatting**: When generating reports, use the extended XML tags (`<chart>`, `<gauge>`, `<trend>`) in the output formatter. Include executive summaries with key insights and actionable recommendations.
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
