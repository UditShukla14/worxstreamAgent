/**
 * Token Counting Utility
 * Estimates token counts for messages and context using approximation
 * (roughly four characters per token for planning purposes)
 */

/**
 * Count tokens in a text string
 * Uses approximation: ~4 characters per token
 */
export function countTokens(text) {
  if (!text || typeof text !== 'string') {
    return 0;
  }
  
  // Rough approximation: 1 token ≈ 4 characters
  // This is a conservative estimate
  return Math.ceil(text.length / 4);
}

/**
 * Count tokens in a message content
 * Handles strings and OpenAI content-part arrays.
 */
export function countMessageContentTokens(content) {
  if (!content) {
    return 0;
  }

  if (typeof content === 'string') {
    return countTokens(content);
  }

  if (Array.isArray(content)) {
    return content.reduce((total, block) => {
      if (!block || typeof block !== 'object') {
        return total;
      }

      if (block.type === 'text' && block.text) {
        return total + countTokens(String(block.text));
      }

      return total;
    }, 0);
  }

  // If content is an object, stringify it
  if (typeof content === 'object') {
    return countTokens(JSON.stringify(content));
  }

  return 0;
}

/**
 * Count tokens in a single message object
 */
export function countMessageTokens(message) {
  if (!message || !message.role) {
    return 0;
  }

  // Role token (small overhead)
  let tokens = 2; // "user" or "assistant" ≈ 2 tokens

  // Content tokens
  tokens += countMessageContentTokens(message.content);
  if (Array.isArray(message.tool_calls)) {
    tokens += countTokens(JSON.stringify(message.tool_calls));
  }
  if (message.tool_call_id) tokens += countTokens(String(message.tool_call_id));

  return tokens;
}

/**
 * Count total tokens in an array of messages
 */
export function countMessagesTokens(messages) {
  if (!Array.isArray(messages)) {
    return 0;
  }

  return messages.reduce((total, msg) => {
    return total + countMessageTokens(msg);
  }, 0);
}

/**
 * Estimate tokens for tools definition
 */
export function countToolsTokens(tools) {
  if (!Array.isArray(tools) || tools.length === 0) {
    return 0;
  }

  // Estimate tokens for tools schema
  // Each OpenAI tool definition includes a function name, description, and parameters.
  let tokens = 0;
  
  for (const tool of tools) {
    const fn = tool.function || {};
    if (fn.name) tokens += countTokens(String(fn.name));
    if (fn.description) tokens += countTokens(String(fn.description));
    if (fn.parameters) tokens += countTokens(JSON.stringify(fn.parameters));
    // Overhead for tool structure
    tokens += 10;
  }

  return tokens;
}

/**
 * Estimate total context size including system prompt, messages, and tools
 */
export function estimateContextSize(systemPrompt, messages, tools = []) {
  let totalTokens = 0;

  // System prompt tokens
  if (systemPrompt) {
    totalTokens += countTokens(String(systemPrompt));
  }

  // Messages tokens
  totalTokens += countMessagesTokens(messages);

  // Tools tokens
  totalTokens += countToolsTokens(tools);

  // Overhead for API structure (headers, formatting, etc.)
  totalTokens += 100;

  return totalTokens;
}
