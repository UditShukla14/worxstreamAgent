# Governance Control Tower — Final Vision, Flow & Requirements

This document describes the **final vision** for the Worxstream Governance Control Tower: event-driven master agents that enforce policies and rules using **RAG** over uploaded policy documents, with a UI for managing policies and viewing results. Use this as the single reference when implementation starts **after** Worxstream APIs and the chat system are complete and stable.

---

## 1. Vision & Scope

**Goal:** A **Governance Control Tower** inside the same worxstreamAgent project that:

- Runs **autonomously** when Worxstream sends webhooks (e.g. estimate created, invoice paid).
- Executes a **pipeline of master agents** (Profit Policy, Inventory Check, Customer Check) that can **invoke child MCP agents** (estimate, invoice, customer, product) when needed.
- Applies **company-specific policies and rules** that users upload and manage via a **Governance UI** — without pasting full documents into prompts; instead, **RAG** retrieves only relevant policy/rule chunks and injects them into the master agents.
- Produces **alerts, flags, and audit logs** so the business can see what was checked and what failed.

**Out of scope for v1:** Training a custom model; the tower uses the existing LLM (Claude) with RAG over policy docs. Optional later: scheduled re-checks or polling.

---

## 2. Prerequisites (Before Starting Control Tower Work)

- **Worxstream backend:** Webhook delivery implemented and stable (see `docs/WORXSTREAM_WEBHOOKS_REQUIRED.md` for event types and payloads).
- **Chat system:** Worxstream AI chat (POST /api/agents/stream, multi-agent routing, MCP tools) working correctly so that child agents and tools are reliable.
- **Worxstream APIs:** All MCP tools used by governance (get_estimate_details, get_customer_details, list_invoices, get_product_details, etc.) tested and stable.

---

## 3. End-to-End Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ 1. WORXSTREAM BACKEND                                                            │
│    User action (e.g. create estimate) → backend persists → fires webhook        │
│    POST /api/webhooks/worxstream with event_type + payload + company_id          │
└─────────────────────────────────────────────────────────────────────────────────┘
                                          │
                                          ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ 2. AGENT APP (this repo)                                                         │
│    • Verify webhook (secret/signature), dedupe by event_id                       │
│    • Optionally enqueue job (respond 200 quickly); worker runs pipeline         │
└─────────────────────────────────────────────────────────────────────────────────┘
                                          │
                                          ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ 3. PIPELINE RUNNER (control/)                                                    │
│    • getPipelineForEvent(event_type) → e.g. [ profitPolicy, inventoryCheck,      │
│      customerCheck ]                                                             │
│    • For each master agent in order:                                             │
└─────────────────────────────────────────────────────────────────────────────────┘
                                          │
                                          ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ 4. RAG (per master agent run)                                                    │
│    • Build query from event + current agent (e.g. "profit margin policy          │
│      estimate customer")                                                         │
│    • Vector search over embedded policy/rule docs (company-scoped)              │
│    • Return top-k relevant chunks (e.g. 3–5)                                    │
└─────────────────────────────────────────────────────────────────────────────────┘
                                          │
                                          ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ 5. MASTER AGENT RUN                                                              │
│    • System prompt includes: (a) governance role, (b) retrieved policy chunks    │
│      from RAG (no full doc). Message = event context (e.g. estimate_id,            │
│      customer_id, product_ids).                                                  │
│    • Master can:                                                                 │
│      – Use MCP tools directly (get_estimate_details, get_product_details, …)   │
│      – Call invoke_agent(agent_key, message) to run child agents                 │
│    • Output: structured conclusion (pass/fail, flags, suggested actions)        │
└─────────────────────────────────────────────────────────────────────────────────┘
                                          │
                                          ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ 6. CONTROL OUTPUTS                                                               │
│    • Append result to pipeline run (event_id, event_type, agent, response,      │
│      tools_used)                                                                 │
│    • If any agent flags a violation: persist alert, optionally notify (Slack,    │
│      email, or in-app)                                                           │
│    • Audit: store run summary for Governance UI (runs history, drill-down)       │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**Summary:** Worxstream sends an event → we run a pipeline of master agents → each master gets **RAG-retrieved policy chunks** (not the full document) + event context → master uses tools and/or invokes child agents → results and alerts are stored and (optionally) surfaced in the Governance UI.

---

## 4. Requirements

### 4.1 Event ingestion & pipeline execution

| ID | Requirement | Notes |
|----|-------------|--------|
| R1 | Accept POST at `/api/webhooks/worxstream` with JSON body matching `docs/WORXSTREAM_WEBHOOKS_REQUIRED.md`. | Common envelope: event_type, event_id, timestamp, company_id, payload. |
| R2 | Verify webhook authenticity (shared secret header or HMAC signature). Reject unverified requests with 401. | |
| R3 | Deduplicate by `event_id` (and optionally idempotency key). Ignore duplicate deliveries. | |
| R4 | Map `event_type` to an ordered list of master agent keys (pipeline). Run pipeline in sequence. | Config in code or DB; see pipeline config in design doc. |
| R5 | Respond 200 quickly; process pipeline synchronously or (preferred) enqueue and process in a worker. | So Worxstream retries don’t hit long-running agent calls. |

### 4.2 Master agents & child invocation

| ID | Requirement | Notes |
|----|-------------|--------|
| R6 | Implement master agents: at least **Profit Policy**, **Inventory Check**, **Customer Check**. Each has a system prompt and a scoped tool list. | Definitions in `control/governanceAgents.js` or equivalent; not in chat router. |
| R7 | Provide MCP tool `invoke_agent(agent_key, message)`. Implementation calls `callAgent(agent_key, message)` and returns the child agent response. Only governance agents have this tool. | Child agents (estimate, invoice, customer, product, …) unchanged. |
| R8 | Master agents can use read-only MCP tools (get_estimate_details, get_customer_details, list_invoices, get_product_details, etc.) as needed. | Same registry as chat; scoped per master. |
| R9 | Chat router must **not** route to governance agents. Only the pipeline runner invokes them. | Router prompt lists only child agents. |

### 4.3 RAG for policies and rules

| ID | Requirement | Notes |
|----|-------------|--------|
| R10 | **Ingest:** When a user uploads or edits a policy/rule document (via Governance UI or API), chunk the text and generate embeddings; store in a vector store (e.g. pgvector, Pinecone, Chroma) with metadata (company_id, document_id, type: policy | rule). | No training; embed-only. Re-embed on update/delete. |
| R11 | **Retrieve:** At the start of each master agent run, build a short query from event_type + event payload + master agent name (e.g. "profit margin policy estimate"). Run vector search (company-scoped); return top-k chunks (e.g. k=3–5). | |
| R12 | **Inject:** Append "Relevant policies/rules:" plus the retrieved chunk text to the master agent’s system prompt or as a dedicated context block. Do **not** inject the full document. | |
| R13 | Optionally expose a tool for the master agent: `get_relevant_policies(query)` that runs the same retrieval so the agent can pull more context mid-run if needed. | |

### 4.4 Policy & rule storage and API

| ID | Requirement | Notes |
|----|-------------|--------|
| R14 | **Policies:** Store policy documents (e.g. "Minimum margin policy", "Credit hold rules"). Fields: company_id, name, content (text/markdown), type (e.g. policy), version/updated_at. | DB table or document store. |
| R15 | **Rules:** Store structured rules (e.g. "If margin < 20% then flag", "If 2+ overdue invoices then block"). Fields: company_id, name, condition/action or structured JSON, event_type (optional), priority. | Can be same table with type=rule or separate. |
| R16 | **API:** CRUD for policies and rules: e.g. GET/POST/PUT/DELETE `/api/control/policies`, GET/POST/PUT/DELETE `/api/control/rules`. Scope by company_id. | Used by Governance UI and by RAG ingest step. |
| R17 | On create/update/delete of a policy or rule, trigger re-embedding (or re-indexing) for RAG so the next pipeline run sees the latest content. | |

### 4.5 Governance UI

| ID | Requirement | Notes |
|----|-------------|--------|
| R18 | **Policy documents:** UI to list, create, edit, delete policy documents. Optional: file upload (then extract text for embedding). Show name, type, last updated. | Same app (e.g. /governance) or separate admin app. |
| R19 | **Rules:** UI to list, create, edit, delete rules. Form or simple builder for condition/action (or structured fields). | |
| R20 | **Pipeline runs / audit:** View recent pipeline runs (event_id, event_type, timestamp, pipeline, status). Drill-down to see per-agent response and tools used. | Read-only; data from control run storage. |
| R21 | **Alerts:** View governance alerts (e.g. "Margin below policy for estimate 1001"). Optional: link to run details and to source policy. | |

### 4.6 Identity, security & observability

| ID | Requirement | Notes |
|----|-------------|--------|
| R22 | Pipeline runs use a **system/service identity** (e.g. runAs: 'control-tower') for Worxstream API calls and audit. Do not use the end-user token from the event unless explicitly required. | |
| R23 | Policies, rules, and run data are **scoped by company_id** (and optionally tenant) so multi-tenant is safe. | |
| R24 | Log pipeline start/end, per-agent duration, and tool usage (e.g. via Rex or a dedicated control logger) for debugging and cost. | |

---

## 5. High-Level Architecture (Recap)

| Layer | Component | Responsibility |
|-------|-----------|----------------|
| **Ingestion** | Worxstream backend | Emit webhooks on entity events. |
| **Ingestion** | `POST /api/webhooks/worxstream` | Verify, dedupe, enqueue or run pipeline. |
| **Control** | Pipeline config | event_type → [ masterAgentKeys ]. |
| **Control** | Pipeline runner | For each event, run master agents in sequence; pass event + RAG context. |
| **RAG** | Vector store + embed API | Store policy/rule chunks; retrieve by query (company-scoped). |
| **RAG** | Retrieve + inject | Before each master run, query RAG and inject top-k chunks into prompt. |
| **Agents** | Master agents | Profit Policy, Inventory Check, Customer Check; use RAG context + tools + invoke_agent. |
| **Agents** | Child agents | Existing estimate, invoice, customer, product, etc.; invoked via invoke_agent. |
| **Storage** | Policies & rules | CRUD + versioning; trigger re-embed on change. |
| **Storage** | Run history & alerts | Persist run summary and alerts for UI and audit. |
| **UI** | Governance UI | Manage policies/rules; view runs and alerts. |

---

## 6. Document References

- **Webhook contract (Worxstream backend):** `docs/WORXSTREAM_WEBHOOKS_REQUIRED.md`
- **Control tower design (same repo, master/child, layout):** `docs/GOVERNANCE_CONTROL_TOWER_DESIGN.md`
- **This vision (flow + RAG + requirements):** `docs/GOVERNANCE_CONTROL_TOWER_VISION.md`

---

## 7. Implementation Order (Suggested)

1. **Prerequisites:** Worxstream APIs and chat stable; webhooks implemented on Worxstream side.
2. **Foundation:** Webhook route (verify, dedupe), pipeline config, pipeline runner, master agent definitions, `invoke_agent` tool.
3. **RAG:** Vector store + embed pipeline; ingest on policy/rule create/update; retrieve + inject in pipeline runner before each master run.
4. **Policy CRUD + API:** Storage and APIs for policies and rules; wire RAG ingest to these.
5. **Governance UI:** Policies, rules, runs, alerts.
6. **Hardening:** Identity, company scoping, logging, optional alerting (Slack/email).

---

*This document is the single source of truth for the final vision. Start implementation once Worxstream APIs and the chat system are complete and working correctly.*
