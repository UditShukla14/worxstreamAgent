/**
 * List policies applied at runtime for list_* tools.
 *
 * - Schema normalization (dates, BETWEEN shape)
 * - Hard safety caps: never dump thousands of rows into the model
 *   (strip all_pages; clamp limit/page). Claude must page interactively.
 */

import { config } from '../../../config/index.js';

const DEFAULT_LIST_PAGE_SIZE = 25;

/** Max rows per list_* call (env AGENT_MAX_LIST_PAGE_SIZE). */
export function getMaxListPageSize() {
  const n = Number(config.agentRuntime?.maxListPageSize);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 100) : DEFAULT_LIST_PAGE_SIZE;
}

/**
 * Multi-page aggregation is permanently disabled — protects the model context
 * when tenants have thousands of invoices/orders/etc.
 */
export function shouldFetchAllPages() {
  return false;
}

/**
 * Normalize + safety-clamp list_* tool input.
 * - Map db_attribute created_date -> created_at
 * - BETWEEN arrays -> "from,to" string
 * - Strip all_pages / max_pages (never allowed)
 * - Clamp limit to maxListPageSize; ensure page >= 1
 */
export function normalizeListInput(input = {}) {
  if (!input || typeof input !== 'object') return input;

  const next = { ...input };

  // Hard gate: never allow bulk multi-page fetches into the LLM context.
  delete next.all_pages;
  delete next.allPages;
  delete next.max_pages;
  delete next.maxPages;

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

  const max = getMaxListPageSize();
  const rawLimit = next.limit ?? next.take ?? DEFAULT_LIST_PAGE_SIZE;
  const limitNum = Number(rawLimit);
  next.limit = Number.isFinite(limitNum) && limitNum > 0
    ? Math.min(Math.floor(limitNum), max)
    : Math.min(DEFAULT_LIST_PAGE_SIZE, max);
  delete next.take;

  if (next.page != null) {
    const p = Number(next.page);
    next.page = Number.isFinite(p) && p >= 1 ? Math.floor(p) : 1;
  }

  return next;
}

/**
 * Filter rows by status label when the caller already decided a label.
 * Prefer letting Claude filter when presenting — this is a pure helper.
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
