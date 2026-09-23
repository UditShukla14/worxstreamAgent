/**
 * Session working memory — goal, active task, clarifications, last tool outcome.
 */

const MAX_FIELD_LEN = 500;

function cap(str, max = MAX_FIELD_LEN) {
  if (str == null) return '';
  const s = String(str);
  return s.length <= max ? s : `${s.slice(0, max - 3)}...`;
}

function parseToolResultError(result) {
  if (!result || typeof result !== 'object') return null;
  if (result.success === false && result.error) return cap(result.error);
  let payload = result;
  if (result.content && Array.isArray(result.content)) {
    const text = result.content.find((b) => b.type === 'text')?.text;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        return null;
      }
    }
  }
  if (payload?.success === false && payload.error) return cap(payload.error);
  if (payload?.data?.message) return cap(payload.data.message);
  return null;
}

function suggestNextForError(toolName, errorMsg) {
  const err = String(errorMsg || '').toLowerCase();
  const tool = String(toolName || '').toLowerCase();
  if (err.includes('tax')) return 'Call list_taxes or configure tax before retrying.';
  if (err.includes('customer')) return 'Resolve customer_id (300-series) via list_customers first.';
  if (tool.startsWith('create_invoice')) return 'Ensure customer_id, line_items, and tax are set.';
  if (tool.startsWith('create_estimate')) return 'Ensure customer_id and line_items are set.';
  return 'Review the error and retry with corrected parameters.';
}

const REFRAME_RE = /\b(actually|instead|let'?s|switch to|focus on|change to)\b/i;
const GOAL_RE = /\b(review|report|reconcile|month[- ]?end|audit|close|analyze|analysis)\b/i;
const DRAFT_RE = /\b(draft|working on|creating|building|in progress)\b/i;

/**
 * @param {object} ctx - Full conversation context object
 * @param {object} turn
 * @param {string} turn.message
 * @param {string} [turn.agentKey]
 * @param {Array<{ name: string, input?: object, success?: boolean }>} [turn.toolsUsed]
 * @param {object[]} [turn.toolResults]
 */
export function deriveWorkingSetDelta(ctx, turn) {
  const delta = {};
  const message = String(turn.message || '').trim();
  const toolsUsed = Array.isArray(turn.toolsUsed) ? turn.toolsUsed : [];
  const existing = ctx?.workingSet && typeof ctx.workingSet === 'object' ? ctx.workingSet : {};

  if (message && (!existing.sessionGoal || REFRAME_RE.test(message))) {
    if (GOAL_RE.test(message) || REFRAME_RE.test(message)) {
      delta.sessionGoal = cap(message, 200);
    } else if (!existing.sessionGoal && message.length > 12) {
      delta.sessionGoal = cap(message, 200);
    }
  }

  // Per-tool failure notes: remember validation errors (e.g. "issue type is
  // required") until that tool succeeds, so the next turn fixes parameters
  // on the FIRST attempt instead of rediscovering the error.
  const toolNotes = {};
  for (let i = 0; i < toolsUsed.length; i++) {
    const t = toolsUsed[i];
    if (!t?.name) continue;
    const err = t.error || parseToolResultError(turn.toolResults?.[i]);
    if (t.success === false || err) {
      if (err) toolNotes[t.name] = { error: cap(err, 200), at: Date.now() };
    } else {
      toolNotes[t.name] = null; // succeeded — clear any earlier note
    }
  }
  if (Object.keys(toolNotes).length > 0) delta.toolNotes = toolNotes;

  const lastTool = toolsUsed.length > 0 ? toolsUsed[toolsUsed.length - 1] : null;
  if (lastTool) {
    const lastResult = Array.isArray(turn.toolResults)
      ? turn.toolResults[turn.toolResults.length - 1]
      : null;
    const err = parseToolResultError(lastResult);
    const ok = lastTool.success !== false && !err;

    delta.lastOutcome = {
      tool: lastTool.name,
      success: ok,
      error: err || undefined,
      suggestedNext: ok ? undefined : suggestNextForError(lastTool.name, err),
      at: Date.now(),
    };

    const name = String(lastTool.name || '');
    if (name.startsWith('create_') || name.startsWith('update_')) {
      const entityType = name.replace(/^(create|update)_/, '').replace(/s$/, '');
      const ref = ctx?.entityRefs?.[entityType] || ctx?.entityRefs?.[entityType + 's'];
      delta.activeTask = {
        type: entityType,
        label: ref?.label ? `${name} — ${ref.label}` : name,
        status: ok ? 'completed' : 'in_progress',
        entityId: ref?.id != null ? String(ref.id) : undefined,
        at: Date.now(),
      };
    } else if (name.startsWith('get_') && ok) {
      const entityType = name.replace(/^get_/, '').replace(/_details$/, '');
      const ref = ctx?.entityRefs?.[entityType];
      if (ref) {
        delta.activeTask = {
          type: entityType,
          label: ref.label || entityType,
          status: 'in_progress',
          entityId: ref.id != null ? String(ref.id) : undefined,
          at: Date.now(),
        };
      }
    }
  }

  if (DRAFT_RE.test(message) && !delta.activeTask) {
    const refs = ctx?.entityRefs && typeof ctx.entityRefs === 'object' ? ctx.entityRefs : {};
    const first = Object.entries(refs)[0];
    if (first) {
      const [type, ref] = first;
      delta.activeTask = {
        type,
        label: ref?.label || type,
        status: 'in_progress',
        entityId: ref?.id != null ? String(ref.id) : undefined,
        at: Date.now(),
      };
    }
  }

  const recent = Array.isArray(ctx?.recentResults) ? ctx.recentResults[0] : null;
  const items = Array.isArray(recent?.items) ? recent.items : [];
  if (items.length > 1 && !ctx?.entities?.customer_id) {
    const pronoun = /\b(that one|the second|the first|#\d|which one|them)\b/i.test(message);
    if (pronoun) {
      delta.pendingClarification = {
        kind: `pick_${recent.entityType || 'entity'}`,
        question: `Multiple ${recent.entityType || 'results'} match — which one?`,
        options: items.slice(0, 5).map((it, idx) => ({
          index: idx + 1,
          id: it.id,
          label: it.label || String(it.id),
        })),
        since: Date.now(),
      };
    }
  }

  if (delta.lastOutcome?.success && existing.pendingClarification) {
    delta.pendingClarification = null;
  }

  return delta;
}

/**
 * @param {object|null} existing
 * @param {object} delta
 */
export function mergeWorkingSet(existing, delta) {
  const base = existing && typeof existing === 'object' ? { ...existing } : {};
  if (delta.sessionGoal != null) base.sessionGoal = delta.sessionGoal;
  if (delta.activeTask != null) base.activeTask = delta.activeTask;
  if (delta.pendingClarification === null) {
    delete base.pendingClarification;
  } else if (delta.pendingClarification != null) {
    base.pendingClarification = delta.pendingClarification;
  }
  if (delta.lastOutcome != null) base.lastOutcome = delta.lastOutcome;
  if (delta.toolNotes != null) {
    const merged = { ...(base.toolNotes || {}) };
    for (const [tool, note] of Object.entries(delta.toolNotes)) {
      if (note === null) delete merged[tool];
      else merged[tool] = note;
    }
    const entries = Object.entries(merged)
      .sort((a, b) => (b[1]?.at || 0) - (a[1]?.at || 0))
      .slice(0, 5);
    if (entries.length > 0) base.toolNotes = Object.fromEntries(entries);
    else delete base.toolNotes;
  }
  return base;
}

/**
 * @param {object|null|undefined} workingSet
 * @param {string} [lastAssistantSnippet]
 */
export function formatWorkingSetForPrompt(workingSet, lastAssistantSnippet = '') {
  if (!workingSet || typeof workingSet !== 'object') {
    if (lastAssistantSnippet) {
      return `[Current focus]\nLast reply (excerpt): ${cap(lastAssistantSnippet, 500)}`;
    }
    return '';
  }

  const lines = ['[Session focus]'];
  if (workingSet.sessionGoal) lines.push(`Goal: ${workingSet.sessionGoal}`);
  if (workingSet.activeTask) {
    const t = workingSet.activeTask;
    lines.push(
      `Active task: ${t.label || t.type || 'task'} (${t.status || 'unknown'})`
      + (t.entityId ? ` [id=${t.entityId}]` : ''),
    );
  }
  if (workingSet.pendingClarification) {
    const p = workingSet.pendingClarification;
    lines.push(`Pending: ${p.question || p.kind}`);
    if (Array.isArray(p.options) && p.options.length > 0) {
      const opts = p.options.map((o) => `#${o.index} ${o.label}${o.id != null ? ` (${o.id})` : ''}`).join('; ');
      lines.push(`Options: ${opts}`);
    }
  }
  if (workingSet.lastOutcome) {
    const o = workingSet.lastOutcome;
    if (o.success) {
      lines.push(`Last action: ${o.tool} succeeded.`);
    } else {
      lines.push(`Last action: ${o.tool} failed — ${o.error || 'unknown error'}.`);
      if (o.suggestedNext) lines.push(`Suggested next: ${o.suggestedNext}`);
    }
  }
  if (workingSet.toolNotes && Object.keys(workingSet.toolNotes).length > 0) {
    lines.push('Known tool errors (fix parameters BEFORE calling again):');
    for (const [tool, note] of Object.entries(workingSet.toolNotes)) {
      lines.push(`- ${tool}: ${note?.error || 'failed previously'}`);
    }
  }
  if (lastAssistantSnippet) {
    lines.push(`Last reply (excerpt): ${cap(lastAssistantSnippet, 500)}`);
  }
  return lines.join('\n');
}

/**
 * Apply numeric pick from user message ("#2", "the second one").
 * @param {object} ctx
 * @param {string} message
 * @returns {object|null} patch for entities or null
 */
/**
 * Structured clarification when pronoun reference is ambiguous.
 * @param {object} ctx
 * @param {string} message
 */
export function detectClarificationNeeded(ctx, message) {
  const pending = ctx?.workingSet?.pendingClarification;
  if (pending?.options?.length) return pending;

  const recent = Array.isArray(ctx?.recentResults) ? ctx.recentResults[0] : null;
  const items = Array.isArray(recent?.items) ? recent.items : [];
  if (items.length <= 1) return null;
  if (ctx?.entities?.customer_id) return null;

  const m = String(message || '');
  if (!/\b(that one|the second|the first|the third|#\d|which one|them)\b/i.test(m)) {
    return null;
  }

  return {
    kind: `pick_${recent.entityType || 'entity'}`,
    question: `Multiple ${recent.entityType || 'matches'} found — which one do you mean?`,
    options: items.slice(0, 5).map((it, idx) => ({
      index: idx + 1,
      id: it.id,
      label: it.label || String(it.id),
    })),
    since: Date.now(),
  };
}

export function resolveClarificationPick(ctx, message) {
  const pending = ctx?.workingSet?.pendingClarification;
  if (!pending?.options?.length) return null;

  const m = String(message || '').trim().toLowerCase();
  let index = null;
  const numMatch = m.match(/#?\s*(\d+)/);
  if (numMatch) index = parseInt(numMatch[1], 10);
  if (/\b(second|2nd)\b/.test(m)) index = 2;
  if (/\b(first|1st)\b/.test(m)) index = 1;
  if (/\b(third|3rd)\b/.test(m)) index = 3;

  if (!Number.isFinite(index) || index < 1) return null;
  const pick = pending.options.find((o) => o.index === index);
  if (!pick) return null;

  const patch = { entities: { ...ctx.entities } };
  const kind = String(pending.kind || '');
  if (kind.includes('customer') && pick.id != null) {
    patch.entities.customer_id = pick.id;
  } else if (pick.id != null) {
    patch.entities.id = pick.id;
  }
  patch.workingSet = {
    ...ctx.workingSet,
    pendingClarification: null,
  };
  return patch;
}
