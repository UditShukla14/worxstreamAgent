# Nova orchestration

Nova is the coworker orchestrator for Worxstream. It routes a request to the
appropriate specialist agents, selects a compact set of MCP tools, executes
those tools, and streams a single response through `/api/agents/stream`.

## Native hosted-LLM protocol

All model calls use the OpenAI Chat Completions protocol exposed by the hosted
LLM configured through `LLM_BASE_URL`, `LLM_MODEL`, and `LLM_API_KEY`.

- System instructions are sent as `role: "system"` messages.
- MCP tools are sent as OpenAI `type: "function"` definitions.
- The model requests tools through `assistant.tool_calls`.
- Tool results are returned as `role: "tool"` messages with `tool_call_id`.
- Tool arguments are parsed and validated against their Zod schemas before a
  handler can run.
- Tool calls run sequentially (`parallel_tool_calls: false`) so confirmation,
  ordering, and audit behavior stay deterministic.

There is no Anthropic message or tool-schema translation layer.

## Frontend contract

The frontend continues to consume the existing SSE event contract:

- `status`
- `agent_selected`
- `tool_use`
- `tool_result`
- `text`
- `done`
- `error`

The internal native OpenAI transcript is not included in normal conversation
responses. It is available only from the turn-audit endpoint when requested
with `?transcript=1`.

## Hosted vLLM requirements

The model server must expose `/v1/chat/completions` and have automatic tool
choice enabled with the parser appropriate for the deployed model. For the
configured GPT-OSS model, use the OpenAI tool-call parser described in the
README deployment example.
