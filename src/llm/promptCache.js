/**
 * Prompt-caching helpers for the Anthropic Messages API.
 *
 * Prefix order is tools → system → messages, so one breakpoint on the system
 * block caches tools + system, and a second on the last message caches the
 * growing transcript between tool-loop iterations (max 4 breakpoints allowed).
 * Prompts below the model's minimum cacheable size are simply not cached.
 */

const EPHEMERAL = Object.freeze({ type: 'ephemeral' });

/** @param {string|Array} system */
export function cachedSystem(system) {
  if (Array.isArray(system)) return system;
  const text = String(system || '');
  if (!text) return system;
  return [{ type: 'text', text, cache_control: EPHEMERAL }];
}

/**
 * Copy of `messages` with a cache breakpoint on the last content block.
 * Never mutates the input (the array is also used for transcript persistence).
 * @param {Array<{role: string, content: string|Array}>} messages
 */
export function withMessageCache(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return messages;
  const last = messages[messages.length - 1];
  let blocks;
  if (typeof last.content === 'string') {
    if (!last.content) return messages;
    blocks = [{ type: 'text', text: last.content }];
  } else if (Array.isArray(last.content) && last.content.length > 0) {
    blocks = last.content.map((b) => ({ ...b }));
  } else {
    return messages;
  }
  blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], cache_control: EPHEMERAL };
  return [...messages.slice(0, -1), { ...last, content: blocks }];
}

/** Apply system + message caching to a params object (returns a new object). */
export function withPromptCaching(params) {
  return {
    ...params,
    system: cachedSystem(params.system),
    messages: withMessageCache(params.messages),
  };
}
