/**
 * List policies applied at runtime for ALL agents/tools.
 *
 * These are enforced in BaseAgent so behavior is consistent even if
 * a prompt drifts (e.g. using status in search, wrong date attribute,
 * or only fetching page 1 for "all" requests).
 */

const ALL_HINTS = [
  /\ball\b/i,
  /\bevery\b/i,
  /\beverything\b/i,
  /\bentire\b/i,
  /\bcomplete\b/i,
];

const STATUS_KEYWORDS = [
  'open',
  'paid',
  'draft',
  'pending',
  'approved',
  'cancelled',
  'canceled',
];

/** Whether the user is requesting the full dataset. */
export function shouldFetchAllPages(userMessage = '') {
  return ALL_HINTS.some((re) => re.test(String(userMessage)));
}

/**
 * Try to infer a desired status from the user message.
 * Returns a lowercase status label or null.
 */
export function inferDesiredStatus(userMessage = '') {
  const msg = String(userMessage).toLowerCase();
  for (const k of STATUS_KEYWORDS) {
    // match whole word where possible
    const re = new RegExp(`\\b${k}\\b`, 'i');
    if (re.test(msg)) return k === 'canceled' ? 'cancelled' : k;
  }
  return null;
}

/**
 * Normalize tool input for list_* calls:
 * - Map db_attribute created_date -> created_at (API uses createdAt/created_at)
 * - For BETWEEN, convert value ["YYYY-MM-DD","YYYY-MM-DD"] -> "YYYY-MM-DD,YYYY-MM-DD"
 *   (matches Postman-tested payload shape)
 */
export function normalizeListInput(input = {}) {
  if (!input || typeof input !== 'object') return input;

  const next = { ...input };
  if (next.filter && typeof next.filter === 'object') {
    const f = { ...next.filter };
    if (Array.isArray(f.advance)) {
      f.advance = f.advance.map((a) => {
        if (!a || typeof a !== 'object') return a;
        const adv = { ...a };

        if (adv.db_attribute === 'created_date') adv.db_attribute = 'created_at';

        const op = String(adv.operator || '').toUpperCase();
        if (op === 'BETWEEN' && Array.isArray(adv.value) && adv.value.length === 2) {
          adv.value = `${adv.value[0]},${adv.value[1]}`;
        }
        return adv;
      });
    }
    next.filter = f;
  }

  return next;
}

/**
 * If the dataset items contain { status: { label } }, filter by desired label.
 * Returns a new array.
 */
export function filterRowsByStatus(rows, desiredStatus) {
  if (!desiredStatus) return rows;
  if (!Array.isArray(rows)) return rows;
  const want = String(desiredStatus).toLowerCase();
  return rows.filter((r) => {
    const label = r?.status?.label ?? r?.status?.name ?? r?.status;
    return String(label || '').toLowerCase() === want;
  });
}

