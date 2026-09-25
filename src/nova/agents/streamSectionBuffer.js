/**
 * Streaming helpers — OpenAI / Claude style.
 *
 * Transport: send continuous text deltas (optionally coalesced for network),
 * not "wait for a whole table then dump it". Large payloads (reports, long
 * snippets) stream the same way ChatGPT/Claude stream long code fences.
 *
 * UI: incomplete structured blocks are split off like an open ``` fence —
 * committed content can be parsed; the open trailing block renders in a
 * streaming snippet panel until its closing tag arrives.
 */

/** Block tags the UI parses as atomic units (same role as markdown fences). */
export const STREAM_BLOCK_TAGS = [
  'table',
  'stats',
  'chart',
  'details',
  'alert',
  'gauge',
  'trend',
  'workflow',
  'milestones',
];

/**
 * @param {string} text
 * @returns {{ tag: string, index: number, openLen: number } | null}
 */
export function findEarliestOpenBlock(text) {
  const src = String(text || '');
  let best = null;
  for (const tag of STREAM_BLOCK_TAGS) {
    const re = new RegExp(`<${tag}(\\s[^>]*)?>`, 'i');
    const m = src.match(re);
    if (!m || m.index == null) continue;
    if (!best || m.index < best.index) {
      best = { tag, index: m.index, openLen: m[0].length };
    }
  }
  return best;
}

/**
 * @param {string} text
 * @param {string} tag
 * @returns {{ end: number } | null}
 */
export function findClosingBlockEnd(text, tag) {
  const re = new RegExp(`</${tag}\\s*>`, 'i');
  const m = String(text || '').match(re);
  if (!m || m.index == null) return null;
  return { end: m.index + m[0].length };
}

/**
 * Split accumulated stream text the way ChatGPT/Claude treat open code fences:
 * everything before an unclosed block is "committed"; the open block is "pending".
 *
 * @param {string} text
 * @param {{ streaming?: boolean }} [opts]
 * @returns {{ committed: string, pending: null | { tag: string, openTag: string, body: string } }}
 */
export function splitStreamingUiContent(text, opts = {}) {
  const src = String(text || '');
  const streaming = opts.streaming !== false;

  if (!streaming || !src) {
    return { committed: src, pending: null };
  }

  // Walk blocks; if the last open has no close, that trailing open is pending.
  let cursor = 0;
  let lastUnclosed = null;

  while (cursor < src.length) {
    const slice = src.slice(cursor);
    const open = findEarliestOpenBlock(slice);
    if (!open) break;

    const absOpen = cursor + open.index;
    const afterOpen = src.slice(absOpen);
    const close = findClosingBlockEnd(afterOpen, open.tag);
    if (!close) {
      lastUnclosed = {
        tag: open.tag,
        index: absOpen,
        openLen: open.openLen,
      };
      break;
    }
    cursor = absOpen + close.end;
  }

  if (!lastUnclosed) {
    return { committed: src, pending: null };
  }

  const openTag = src.slice(lastUnclosed.index, lastUnclosed.index + lastUnclosed.openLen);
  const body = src.slice(lastUnclosed.index + lastUnclosed.openLen);
  return {
    committed: src.slice(0, lastUnclosed.index),
    pending: { tag: lastUnclosed.tag, openTag, body },
  };
}

/**
 * Coalesce tiny token deltas into short frames — same idea as browser paint
 * batching while still feeling like OpenAI/Claude token streaming.
 *
 * @param {(chunk: string) => void} onFlush
 * @param {{ maxDelayMs?: number, maxChars?: number }} [opts]
 */
export function createDeltaCoalesceBuffer(onFlush, opts = {}) {
  const maxDelayMs = Number.isFinite(opts.maxDelayMs) ? opts.maxDelayMs : 40;
  const maxChars = Number.isFinite(opts.maxChars) ? opts.maxChars : 96;
  const emit = typeof onFlush === 'function' ? onFlush : () => {};

  let buf = '';
  let timer = null;

  const flushNow = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!buf) return;
    const chunk = buf;
    buf = '';
    emit(chunk);
  };

  const schedule = () => {
    if (timer) return;
    timer = setTimeout(flushNow, maxDelayMs);
  };

  return {
    push(delta) {
      if (!delta) return;
      buf += delta;
      if (buf.length >= maxChars) {
        flushNow();
        return;
      }
      schedule();
    },
    flush: flushNow,
    pending() {
      return buf;
    },
  };
}

/**
 * @deprecated Prefer createDeltaCoalesceBuffer + splitStreamingUiContent.
 * Kept for tests that still assert block hold/flush.
 */
export function createStreamSectionBuffer(onFlush) {
  let buf = '';
  const emit = typeof onFlush === 'function' ? onFlush : () => {};

  function flushReady() {
    // Pass-through coalescer: immediately emit everything (OpenAI-style).
    // Callers that need fence UX should use splitStreamingUiContent on the client.
    if (!buf) return;
    emit(buf);
    buf = '';
  }

  return {
    push(delta) {
      if (!delta) return;
      buf += delta;
      flushReady();
    },
    flush() {
      if (!buf) return;
      emit(buf);
      buf = '';
    },
    pending() {
      return buf;
    },
  };
}

/**
 * Scale formatter max_tokens from raw agent output size so large reports
 * are less likely to stop mid-table.
 *
 * @param {string} rawOutput
 * @param {number} baseMax
 * @param {{ hardCap?: number }} [opts]
 * @returns {number}
 */
export function resolveFormatterMaxTokens(rawOutput, baseMax, opts = {}) {
  const base = Math.max(1024, Number(baseMax) || 4096);
  const hardCap = Number.isFinite(opts.hardCap) ? opts.hardCap : 32000;
  const len = String(rawOutput || '').length;
  const estimated = Math.ceil((len / 3) * 1.5) + 2048;
  return Math.min(hardCap, Math.max(base, estimated));
}
