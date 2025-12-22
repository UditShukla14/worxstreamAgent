/**
 * Context Window Manager
 * Manages conversation context using sliding window approach
 */

import { countMessagesTokens, estimateContextSize, countToolsTokens } from './tokenCounter.js';
import { config } from '../config/index.js';

/**
 * Apply sliding window to messages array
 * Keeps only the most recent N messages, preserving message pairs when possible
 */
export function applySlidingWindow(messages, maxMessages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return [];
  }

  const max = maxMessages || config.contextWindow.maxMessages || 50;

  // If we have fewer messages than the limit, return all
  if (messages.length <= max) {
    return messages;
  }

  // Keep only the most recent messages
  const truncated = messages.slice(-max);

  // Try to preserve message pairs (user + assistant)
  // If the first message is an assistant message without a preceding user message,
  // we might want to remove it, but for simplicity, we'll just keep the last N messages
  // This ensures we always have complete conversation context

  return truncated;
}

/**
 * Truncate messages based on token limit
 * Removes oldest messages until we're within the token limit
 */
export function truncateByTokens(messages, maxTokens, reserveTokens = 0) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return messages;
  }

  const availableTokens = maxTokens - reserveTokens;
  let currentTokens = countMessagesTokens(messages);

  // If we're within the limit, return all messages
  if (currentTokens <= availableTokens) {
    return messages;
  }

  // Remove oldest messages until we're within the limit
  let truncated = [...messages];
  
  while (truncated.length > 0 && currentTokens > availableTokens) {
    // Remove the oldest message
    truncated.shift();
    currentTokens = countMessagesTokens(truncated);
  }

  return truncated;
}

/**
 * Manage context window - applies both message limit and token limit
 * Returns the optimized messages array
 */
export function manageContextWindow(messages, systemPrompt = '', tools = []) {
  if (!Array.isArray(messages)) {
    return [];
  }

  const maxMessages = config.contextWindow.maxMessages || 50;
  const maxTokens = config.contextWindow.maxTokens || 150000;
  const reserveTokens = config.contextWindow.reserveTokens || 10000;

  // For very short conversations, don't truncate at all
  // This ensures context is preserved for follow-up questions
  if (messages.length <= 10) {
    // Only check token limit for very short conversations, don't apply message limit
    const currentContextSize = estimateContextSize(systemPrompt, messages, tools);
    const availableTokens = maxTokens - reserveTokens;
    
    if (currentContextSize <= availableTokens) {
      // Well within limits, return all messages
      return messages;
    }
    // If over token limit even with few messages, truncate by tokens only
    return truncateByTokens(messages, availableTokens, 0);
  }

  // First, apply sliding window (message count limit)
  let optimizedMessages = applySlidingWindow(messages, maxMessages);

  // Then, check token limit and truncate if needed
  const currentContextSize = estimateContextSize(systemPrompt, optimizedMessages, tools);
  const availableTokens = maxTokens - reserveTokens;

  if (currentContextSize > availableTokens) {
    // Need to truncate further based on tokens
    optimizedMessages = truncateByTokens(optimizedMessages, availableTokens, 0);
  }

  return optimizedMessages;
}

/**
 * Get context statistics for logging
 */
export function getContextStats(messages, systemPrompt = '', tools = []) {
  const messageCount = Array.isArray(messages) ? messages.length : 0;
  const messageTokens = countMessagesTokens(messages);
  const systemTokens = systemPrompt ? Math.ceil(systemPrompt.length / 4) : 0;
  const toolsTokens = countToolsTokens(tools);
  const totalTokens = estimateContextSize(systemPrompt, messages, tools);

  return {
    messageCount,
    messageTokens,
    systemTokens,
    toolsTokens,
    totalTokens,
    maxMessages: config.contextWindow.maxMessages || 50,
    maxTokens: config.contextWindow.maxTokens || 150000,
    reserveTokens: config.contextWindow.reserveTokens || 10000,
  };
}

