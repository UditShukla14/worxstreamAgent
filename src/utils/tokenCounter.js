/**
 * Token Counting Utility
 * Estimates token counts for messages and context using approximation
 * (Anthropic uses ~4 characters per token on average)
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
 * Handles both string and array formats (Anthropic message format)
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

      if (block.type === 'tool_use') {
        // Count tool_use block: name, id, and input
        let tokens = 0;
        if (block.name) tokens += countTokens(String(block.name));
        if (block.id) tokens += countTokens(String(block.id));
        if (block.input) {
          tokens += countTokens(JSON.stringify(block.input));
        }
        return total + tokens;
      }

      if (block.type === 'tool_result') {
        // Count tool_result block: tool_use_id and content
        let tokens = 0;
        if (block.tool_use_id) tokens += countTokens(String(block.tool_use_id));
        if (block.content) {
          tokens += countTokens(
            typeof block.content === 'string' 
              ? block.content 
              : JSON.stringify(block.content)
          );
        }
        return total + tokens;
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
  // Each tool definition includes: name, description, input_schema
  let tokens = 0;
  
  for (const tool of tools) {
    if (tool.name) tokens += countTokens(String(tool.name));
    if (tool.description) tokens += countTokens(String(tool.description));
    if (tool.input_schema) {
      tokens += countTokens(JSON.stringify(tool.input_schema));
    }
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

