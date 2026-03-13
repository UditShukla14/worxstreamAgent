# Governance Control Tower — Design & Layout

This document describes how the **Governance Control Tower** (master agents that run autonomously on Worxstream events and can invoke child MCP agents) fits into the codebase and why it lives in **this same project**.

---

## 1. Recommendation: Same Project

**Keep the Governance Control Tower in this repository** (worxstreamAgent) alongside the chat agent.

| Concern | Same project ✅ | Separate project |
|--------|------------------|------------------|
| **Master invoking child** | Direct `callAgent(key, message)` in-process; no network, no duplicate auth | Would need HTTP API or shared lib; extra latency and failure modes |
| **Tools & APIs** | One MCP registry, one Worxstream client, one config | Duplicate tools/agents or a shared npm package to maintain |
| **Deployment** | One app: chat routes + control routes; optional separate worker process for pipelines | Two deploys, two envs, coordination |
| **Separation of concerns** | Clear separation via **routes** (`/api/agents/*` vs `/api/webhooks/*`, `/api/control/*`) and **modules** (`src/control/`) | N/A |
| **Chat vs governance** | Chat = user-initiated (POST /api/agents/stream). Governance = event-initiated (webhook → pipeline). Same agent layer. | Split by product boundary only if different teams or products |

**When to split:** Consider a separate project only if governance becomes a different product, different team, or needs different scaling/infra (e.g. governance in a separate region or tenant).

---

## 2. Concepts

- **Child agents (MCP agents)** — Existing specialist agents: estimate, invoice, customer, product, workflow, etc. They use **MCP tools only** (get_estimate_details, list_invoices, …). Used by chat and by the Control Tower.
- **Master agents (governance agents)** — Control Tower agents: e.g. Profit Policy Agent, Inventory Check Agent, Customer Check Agent. They can:
  - Use MCP tools directly (read estimates, products, customers, invoices), and/or
  - **Invoke child agents** when they need a specialist to do something (e.g. “get full estimate breakdown” via estimate agent, “check customer payment history” via invoice/customer agents).
- **Control Tower** — The subsystem that:
  1. Receives Worxstream webhook events
  2. Maps event type → pipeline (ordered list of **master** agent keys)
  3. Runs each master agent in sequence with event context
  4. Optionally stores results, alerts, or audit logs

---

## 3. How Master Agents Invoke Child Agents

- Add **one MCP tool** that only governance (master) agents see: e.g. `invoke_agent`.
- **Signature:** `invoke_agent({ agent_key: string, message: string })`  
  - Implementation: calls existing `callAgent(agent_key, message)` and returns the child agent’s response (and optionally tools_used, usage).
- Governance agent definitions (Profit Policy, Inventory Check, Customer Check) include `invoke_agent` in their `tools` array, plus any direct read-only MCP tools you want (e.g. `get_estimate_details`, `get_product_details`).
- So:
  - **Chat flow:** User → Router → one or more **child** agents (no `invoke_agent`).
  - **Governance flow:** Webhook → Pipeline Runner → one or more **master** agents → each master can call MCP tools and/or `invoke_agent` to run **child** agents.

Child agents stay unchanged; they do not need to know they were invoked by a master or by the chat router.

---

## 4. Proposed Layout (Same Repo)

```
worxstreamAgent/
├── src/
│   ├── index.js
│   ├── app.js
│   ├── routes/
│   │   ├── index.js              # mount control + webhook routes
│   │   ├── agents.js             # chat: POST /api/agents/stream, etc.
│   │   ├── chat.js
│   │   ├── webhooks.js           # NEW: POST /api/webhooks/worxstream
│   │   └── control.js            # NEW (optional): GET /api/control/pipelines, runs, config
│   │
│   ├── control/                  # NEW: Governance Control Tower
│   │   ├── index.js              # export runPipeline, getPipelineForEvent, etc.
│   │   ├── pipelineRunner.js     # given event, resolve pipeline, run master agents in sequence
│   │   ├── pipelineConfig.js     # event_type → [ masterAgentKey1, masterAgentKey2, ... ]
│   │   ├── governanceAgents.js    # definitions for master agents (profitPolicy, inventoryCheck, customerCheck)
│   │   └── contextBuilder.js     # build message + context from webhook payload for each master
│   │
│   ├── agents/
│   │   ├── index.js
│   │   ├── router.js
│   │   ├── BaseAgent.js
│   │   ├── agentDefinitions.js    # existing child agents (estimate, invoice, customer, ...)
│   │   └── ...
│   │
│   ├── mcp/
│   │   ├── server.js
│   │   ├── tools/
│   │   │   ├── index.js
│   │   │   ├── invokeAgent.js     # NEW: tool for master agents to call callAgent(agent_key, message)
│   │   │   └── ...
│   │   └── ...
│   └── ...
│
├── docs/
│   ├── WORXSTREAM_WEBHOOKS_REQUIRED.md
│   └── GOVERNANCE_CONTROL_TOWER_DESIGN.md   # this file
└── ...
```

**Routing:**

- **Chat:** `POST /api/agents/stream`, `POST /api/chat`, … → router → **child** agents only.
- **Governance:** `POST /api/webhooks/worxstream` → verify webhook → enqueue or run **runPipeline(event)** → for each step, run **master** agent with event context; master may call **invoke_agent** to run child agents.

**Agent definitions:**

- **Child agents:** Stay in `src/agents/agentDefinitions.js` (estimate, invoice, customer, product, …). Used by chat router and by master agents via `invoke_agent`.
- **Master agents:** New definitions, either in the same file under a separate object (e.g. `GOVERNANCE_AGENT_DEFINITIONS`) or in `src/control/governanceAgents.js`. Only the pipeline runner and the Control Tower use them; the chat router does **not** route to them (router prompt lists only child agents).

---

## 5. Pipeline Config (event → master agents)

Example mapping:

| event_type | Pipeline (master agents in order) |
|------------|------------------------------------|
| `estimate.created` | profitPolicy → inventoryCheck → customerCheck |
| `estimate.updated` | profitPolicy → inventoryCheck → customerCheck |
| `invoice.created`  | customerCheck → (optional) profitPolicy |
| `invoice.paid`     | customerCheck |
| `customer.updated` | customerCheck |

Stored in code (e.g. `pipelineConfig.js`) or later in DB. Pipeline runner loads it and runs each master agent in sequence, passing the webhook payload so the master can build a message (e.g. “Check profit policy for estimate_id 1001, customer_id 2001”) and optionally invoke child agents.

---

## 6. Implementation Checklist (high level)

1. **MCP tool `invoke_agent`**  
   - Input: `agent_key`, `message`.  
   - Implementation: call `callAgent(agent_key, message)`; return response (and optionally usage).  
   - Register in `mcp/tools/invokeAgent.js`; do **not** add to any child agent’s `tools`; add only to governance agents’ `tools`.

2. **Governance agent definitions**  
   - Add at least three: `profitPolicy`, `inventoryCheck`, `customerCheck`.  
   - Each has: name, description, systemPrompt, and `tools: [ 'invoke_agent', 'get_estimate_details', 'get_product_details', ... ]` as needed (read-only tools + `invoke_agent`).  
   - Instantiate them in the same way as child agents (e.g. from a map or a second init function) but **do not** register them in the chat router’s list.

3. **Pipeline runner**  
   - `runPipeline(event)` where `event = { event_type, payload, company_id, ... }`.  
   - Resolve pipeline from config: `const agentKeys = getPipelineForEvent(event.event_type)`.  
   - For each `agentKey`, get the **governance** agent instance, build message from `event.payload`, call `agent.run(message, context)` with event context.  
   - Collect results; optionally persist or send to alerts.

4. **Webhook route**  
   - `POST /api/webhooks/worxstream`: verify signature, parse body, dedupe by `event_id`, then call `runPipeline(event)` (sync) or enqueue job that runs `runPipeline(event)` (async).  
   - Respond 200 quickly if async.

5. **Router isolation**  
   - Chat router’s “available agents” list stays as today (child agents only). Governance agents are not in that list so chat never routes to them; only the pipeline runner invokes them.

---

## 7. Summary

| Question | Answer |
|----------|--------|
| Same or separate project? | **Same project.** |
| Where does the Control Tower live? | **`src/control/`** (pipeline runner, config, governance agent definitions, context builder). |
| How do master agents invoke child agents? | **`invoke_agent` MCP tool** (only on master agents) that calls `callAgent(agent_key, message)`. |
| How are chat and governance separated? | **Routes:** chat uses `/api/agents/*`, `/api/chat`. Governance uses `/api/webhooks/worxstream` and optional `/api/control/*`. **Agents:** router only knows child agents; pipeline runner only runs master agents. |

This keeps one codebase, one deployment, shared MCP tools and Worxstream API, and a clear separation between chat (user-driven) and governance (event-driven Control Tower with master agents that can invoke child MCP agents).
