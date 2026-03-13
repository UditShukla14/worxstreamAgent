Added a nova manager agent definition

In src/agents/agentDefinitions.js I introduced a nova entry with:
name: nova_orchestrator
description: “Manager agent that orchestrates other agents for cross-domain requests; does not call external MCP tools directly.”
tools: empty [] (Nova never calls MCP tools itself).
systemPrompt: describes Nova’s job: look at the user message, conversation context, router-suggested agent keys, and the catalog of specialist agents, then output a pure JSON plan:
{"mode": "single" | "sequential", "agents": ["customer", "estimate"], "reason": "..."}
No final user answer, just the plan.
Nova planning helper in the backend

In src/routes/agents.js I added getNovaPlan(message, conversationContext, routing):
Builds a compact list of all specialist agents (from AGENT_DEFINITIONS, excluding nova itself) as - key: description.
Takes routing.agentKeys from the existing router as strong hints.
Calls Anthropic with:
system: Nova’s system prompt from AGENT_DEFINITIONS.nova.systemPrompt.
user content: conversation context (if any), user message, router-suggested keys, and the agent catalog, with a clear instruction to return only the JSON plan.
Parses the response text as JSON and normalizes to:
{ mode: 'single' | 'sequential', agents: string[], reason?: string }
Returns null on parse/validation errors so we can fall back cleanly.
Reworked /api/agents/stream to use Nova for orchestration

In src/routes/agents.js, the streaming handler now works as follows:

Step 1 – Existing router still runs first

resolveAgentKeys(message, contextPrompt) is called as before, giving:
routing.type: 'conversation' | 'single' | 'multi'
routing.agentKeys: the low-level router’s chosen agents.
routing.routerUsage: token usage for metrics.
Step 2 – Conversational-only fallback (unchanged in behavior)

If routing.type === 'conversation' (router says “no agent needed”):
Still logs via Rex and streams a plain Claude response (no MCP tools).
Persists the turn in Conversation scoped by (company_id, user_id, conversation_id).
Returns.
Step 3 – Nova decides the orchestration plan

For non-conversational requests:

Calls getNovaPlan(message, contextPrompt, routing).
Computes a fallback plan from router if Nova fails:
fallbackMode: 'single' when router chose one agent, 'sequential' when router chose multiple.
fallbackAgents: routing.agentKeys (if any).
Chooses:
mode = novaPlan.mode || fallbackMode
plannedAgentsRaw = novaPlan.agents || fallbackAgents
Filters plannedAgentsRaw against known agent keys (getAgentKeys()), excluding nova itself, to get plannedAgents.
If plannedAgents ends up empty (Nova + router both unusable), it falls back to a conversational stream and persists that, so you never get stuck.

Sets primaryKey = plannedAgents[0] and calls rex.routerResolved(requestId, primaryKey, routerDuration, routing.routerUsage) so Rex metrics still show a primary agent.

Step 4 – Execute Nova’s plan with SSE and context chaining

Single-agent mode (mode === 'single' or only one plannedAgents entry):

Gets that agent via getAgentInstance(primaryKey).
Emits agent_selected + status SSE events.
Calls agent.runWithEvents(message, { _rexRequestId, _conversationContext: contextPrompt }, sse), exactly as before.
Tracks:
allToolsUsed (aggregating toolsUsed),
allToolResultPayloads (for context),
agentRawTexts (the raw text from the agent).
Runs updateContext(convId, primaryKey, toolsUsed, toolResultPayloads) so future turns know IDs / last agent.
Sequential multi-agent mode (mode === 'sequential' and 2–3 plannedAgents):

Iterates in order over plannedAgents:
For each key:
Looks up the agent; if missing, logs and skips.
Emits agent_selected + status SSE for that agent.
Builds a chained context string:
Start with contextPrompt if present.
If a previous agent ran, append:
[Context from previousAgentName]: previousRawText
Calls agent.runWithEvents(message, { _rexRequestId, _conversationContext: chainedContext, fromAgent: previousAgentName }, sse).
Accumulates:
allToolsUsed.push(...toolsUsed),
allToolResultPayloads.push(...toolResultPayloads),
agentRawTexts.push(rawText).
Calls updateContext(convId, key, toolsUsed, toolResultPayloads) after each agent, so the global conversation context keeps all numeric IDs/search info.
Updates previousRawText and previousAgentName for the next agent.
At the end, it builds combinedRawText = agentRawTexts.join('\n\n').trim().

Step 5 – Persist the orchestrated turn & format output

Persists the whole turn for the given (company_id, user_id, conversation_id):

Fetches existing doc from Conversation with those keys.
Appends:
{ role: 'user', content: message }
{ role: 'assistant', content: combinedRawText }
Upserts back with updated_at set to new Date().
Sends the final formatted response:

Emits status SSE with STATUS_LABEL_FORMATTING.
Calls formatOutputStreaming(message, combinedRawText, res) so the OutputFormatter still handles XML/structure.
Emits a final done SSE event:
agent: a comma-separated list of all agents Nova used.
toolsUsed: merged list of tool calls (name, input, success) across all agents.
Completes Rex metrics and ends the stream.
Resulting behavior
For a cross-domain request like your example (“customer from previous session… need estimate details”), the flow is now:
Low-level router likely suggests ["customer", "estimate"].
Nova receives that suggestion plus all agent descriptions and the user message.
Nova can choose {"mode": "sequential", "agents": ["customer", "estimate"], ...}.
Backend then:
Runs the Customer agent first (to resolve the customer correctly).
Feeds its output as context into the Estimate agent.
Combines both agents’ raw text and formats into a single coherent answer for the user.
All of this happens behind the same /api/agents/stream endpoint, so the frontend does not need to change.