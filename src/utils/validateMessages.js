/**
 * Message Validation Utility
 * Ensures message pairs (tool_use/tool_result) are valid before sending to Claude
 */

/**
 * Validate and fix message pairs to ensure tool_use/tool_result pairs are valid
 * Removes orphaned tool_result blocks that don't have a corresponding tool_use
 */
export function validateMessagePairs(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return messages;
  }

  const validatedMessages = [];
  const toolUseIds = new Set();

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg || !msg.role) {
      continue;
    }

    // If it's an assistant message, collect all tool_use IDs
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      const toolUseBlocks = msg.content.filter(block => block.type === 'tool_use');
      toolUseBlocks.forEach(block => {
        if (block.id) {
          toolUseIds.add(String(block.id));
        }
      });
      validatedMessages.push(msg);
      continue;
    }

    // If it's a user message with tool_result blocks, validate them
    if (msg.role === 'user' && Array.isArray(msg.content)) {
      const toolResultBlocks = msg.content.filter(block => block.type === 'tool_result');
      
      if (toolResultBlocks.length > 0) {
        // Check if the previous message was an assistant message with tool_use
        const prevMsg = i > 0 ? messages[i - 1] : null;
        const hasValidToolUse = prevMsg && 
                                 prevMsg.role === 'assistant' && 
                                 Array.isArray(prevMsg.content) &&
                                 prevMsg.content.some(block => 
                                   block.type === 'tool_use' && 
                                   toolResultBlocks.some(tr => tr.tool_use_id === block.id)
                                 );

        if (!hasValidToolUse) {
          // Check if tool_use_id exists in our collected set
          const validToolResults = toolResultBlocks.filter(block => 
            block.tool_use_id && toolUseIds.has(String(block.tool_use_id))
          );

          if (validToolResults.length === 0) {
            // No valid tool_results, skip this message or keep only non-tool_result content
            const nonToolResultContent = msg.content.filter(block => block.type !== 'tool_result');
            if (nonToolResultContent.length > 0) {
              validatedMessages.push({
                ...msg,
                content: nonToolResultContent,
              });
            }
            // Skip this message if it only had invalid tool_results
            continue;
          } else {
            // Keep only valid tool_results
            const otherContent = msg.content.filter(block => block.type !== 'tool_result');
            validatedMessages.push({
              ...msg,
              content: [...otherContent, ...validToolResults],
            });
            continue;
          }
        }
      }
    }

    // For all other messages, add as-is
    validatedMessages.push(msg);
  }

  return validatedMessages;
}

/**
 * Remove orphaned tool_result blocks that don't have corresponding tool_use blocks
 * This is a more aggressive cleanup that removes invalid pairs
 */
export function removeOrphanedToolResults(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return messages;
  }

  const cleanedMessages = [];
  const activeToolUseIds = new Set();

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg || !msg.role) {
      continue;
    }

    // Track tool_use IDs from assistant messages
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      msg.content.forEach(block => {
        if (block.type === 'tool_use' && block.id) {
          activeToolUseIds.add(String(block.id));
        }
      });
      cleanedMessages.push(msg);
      continue;
    }

    // Clean tool_result blocks from user messages
    if (msg.role === 'user' && Array.isArray(msg.content)) {
      const cleanedContent = msg.content.filter(block => {
        if (block.type === 'tool_result') {
          // Only keep tool_result if we have the corresponding tool_use
          if (block.tool_use_id && activeToolUseIds.has(String(block.tool_use_id))) {
            // Remove from active set after use (tool_use can only be used once)
            activeToolUseIds.delete(String(block.tool_use_id));
            return true;
          }
          return false;
        }
        return true;
      });

      if (cleanedContent.length > 0) {
        cleanedMessages.push({
          ...msg,
          content: cleanedContent,
        });
      }
      continue;
    }

    // For all other messages, add as-is
    cleanedMessages.push(msg);
  }

  return cleanedMessages;
}

