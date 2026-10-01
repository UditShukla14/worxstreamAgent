/**
 * Claude Code–style activity verbs emitted over SSE while Nova waits on the LLM.
 * Frontend displays `type: 'status'` labels as-is — rotation lives here, not in apps/web.
 */

export const ACTIVITY_KEYWORDS = [
  'Thinking',
  'Pondering',
  'Analyzing',
  'Reasoning',
  'Considering',
  'Exploring',
  'Synthesizing',
  'Working',
  'Unpacking',
  'Figuring',
  'Composing',
  'Brewing',
];

export const ACTIVITY_KEYWORD_INTERVAL_MS = 2200;

/**
 * Start rotating `{ type: 'status', label }` SSE events.
 * Call the returned stop() before emitting a concrete phase label (planning, tool, formatter).
 *
 * @param {(data: object) => void} sse
 * @param {{ intervalMs?: number }} [opts]
 * @returns {() => void} stop
 */
export function startActivityKeywordRotation(sse, opts = {}) {
  const intervalMs = Number.isFinite(opts.intervalMs)
    ? opts.intervalMs
    : ACTIVITY_KEYWORD_INTERVAL_MS;
  const emit = typeof sse === 'function' ? sse : () => {};
  let index = 0;
  let stopped = false;

  const tick = () => {
    if (stopped) return;
    const word = ACTIVITY_KEYWORDS[index % ACTIVITY_KEYWORDS.length];
    index += 1;
    emit({ type: 'status', label: `${word}…` });
  };

  tick();
  const timer = setInterval(tick, intervalMs);

  return () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
  };
}
