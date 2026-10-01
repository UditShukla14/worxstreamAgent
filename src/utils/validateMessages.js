/** Remove orphaned OpenAI `tool` messages before a chat-completions request. */
export function sanitizeOpenAIMessages(messages) {
  if (!Array.isArray(messages)) return [];
  const availableResults = new Set(
    messages
      .filter((message) => message?.role === 'tool' && message.tool_call_id)
      .map((message) => String(message.tool_call_id)),
  );
  const pending = new Set();
  const out = [];
  for (const message of messages) {
    if (!message || !message.role) continue;
    if (message.role === 'assistant') {
      const toolCalls = (message.tool_calls || []).filter(
        (call) => call?.id && availableResults.has(String(call.id)),
      );
      for (const call of toolCalls) {
        if (call?.id) pending.add(String(call.id));
      }
      if (message.content || toolCalls.length > 0) {
        const { tool_calls: _discardedToolCalls, ...base } = message;
        out.push({
          ...base,
          ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        });
      }
      continue;
    }
    if (message.role === 'tool') {
      const id = String(message.tool_call_id || '');
      if (!id || !pending.has(id)) continue;
      pending.delete(id);
      out.push(message);
      continue;
    }
    out.push(message);
  }
  return out;
}
