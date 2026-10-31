/**
 * Universal entity resolver — one meta-tool every agent can call to turn a
 * human reference ("Santiago", "Acme Corp", "GST 18%") into internal IDs,
 * without knowing which domain tool owns the lookup. The dispatch table
 * below encodes that knowledge once.
 *
 * For types covered by Worxstream global search, we try that single API first
 * (returns type, id, appId, name) and only fall back to domain dropdowns/lists
 * when it returns nothing or errors.
 */

import { z } from 'zod';
import { registerTool, executeMcpTool } from '../server.js';

/**
 * entity_type → which registered tool to call and how to pass the query.
 * Tools without server-side search return full lists; we filter locally.
 */
export const ENTITY_LOOKUPS = {
  team_member: { tool: 'get_team_members_dropdown', args: () => ({}) },
  customer: { tool: 'get_customer_dropdown', args: (q) => ({ search: q }) },
  contact: { tool: 'list_contacts', args: (q) => ({ filter: { search: q }, limit: 25 }) },
  product: { tool: 'get_products_dropdown', args: (q) => ({ search: q }) },
  vendor: { tool: 'list_vendors', args: (q) => ({ filter: { search: q }, limit: 25 }) },
  tax: { tool: 'list_taxes', args: () => ({}) },
  department: { tool: 'list_departments', args: () => ({}) },
  branch: { tool: 'list_branches', args: () => ({}) },
  job: { tool: 'list_jobs', args: (q) => ({ filter: { search: q }, limit: 25 }) },
  project: { tool: 'list_projects', args: (q) => ({ filter: { search: q }, limit: 25 }) },
  task: { tool: 'list_tasks', args: (q) => ({ filter: { search: q }, limit: 25 }) },
  estimate: { tool: 'list_estimates', args: (q) => ({ filter: { search: q }, limit: 25 }) },
  invoice: { tool: 'list_invoices', args: (q) => ({ filter: { search: q }, limit: 25 }) },
  sales_order: { tool: 'list_sales_orders', args: (q) => ({ filter: { search: q }, limit: 25 }) },
  warehouse: { tool: 'get_warehouses_dropdown', args: () => ({}) },
  deal: { tool: 'list_deals', args: (q) => ({ search: q, take: 25 }) },
};

/**
 * entity_type → global-search object_name. Types absent here stay on domain tools only
 * (tax, department, branch, warehouse, team_member, sales_order, …).
 */
export const GLOBAL_SEARCH_OBJECT_NAMES = {
  customer: 'customer',
  contact: 'contact',
  product: 'product',
  vendor: 'vendor',
  job: 'job',
  project: 'project',
  task: 'task',
  estimate: 'estimate',
  invoice: 'invoice',
  deal: 'deal',
};

const ENTITY_TYPES = Object.keys(ENTITY_LOOKUPS);

const MAX_MATCHES = 10;
const ID_KEY_RE = /(^|_)id$|^value$|appId$/i;
const NAME_KEY_RE = /name|title|label|email|^text$|^code$|customNumber|custom_number/i;

/**
 * Find the first non-empty array of plain objects anywhere in an API result
 * (responses vary: data, data.data, rows, list...). Breadth-first so the
 * shallowest (primary) collection wins.
 */
function findRows(root) {
  const queue = [root];
  while (queue.length > 0) {
    const node = queue.shift();
    if (Array.isArray(node)) {
      if (node.length > 0 && node.every((el) => el && typeof el === 'object' && !Array.isArray(el))) {
        return node;
      }
      continue;
    }
    if (node && typeof node === 'object') {
      queue.push(...Object.values(node));
    }
  }
  return [];
}

/** Score how well a row matches the query across its string fields. */
function matchScore(row, queryLc) {
  let best = 0;
  for (const value of Object.values(row)) {
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    const lc = String(value).toLowerCase();
    if (lc === queryLc) return 3;
    if (lc.startsWith(queryLc)) best = Math.max(best, 2);
    else if (lc.includes(queryLc)) best = Math.max(best, 1);
  }
  return best;
}

/** Keep only id-ish and name-ish fields so matches stay compact. */
function compactRow(row) {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    if (value == null || typeof value === 'object') continue;
    if (ID_KEY_RE.test(key) || NAME_KEY_RE.test(key) || key === 'type') out[key] = value;
  }
  // Preserve appId under a stable key when present as app_id.
  if (out.appId == null && row.app_id != null) out.appId = row.app_id;
  return Object.keys(out).length > 0 ? out : row;
}

function rankMatches(rows, query) {
  const queryLc = query.toLowerCase().trim();
  let matches = rows
    .map((row) => ({ row, score: matchScore(row, queryLc) }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((m) => m.row);

  // Server-side search may have matched fields we can't see locally
  // (e.g. partial tokens); trust its result set rather than returning nothing.
  if (matches.length === 0 && rows.length > 0 && rows.length <= MAX_MATCHES) {
    matches = rows;
  }
  return matches;
}

function buildPayload(entity_type, query, matches, source_tool) {
  return {
    success: true,
    entity_type,
    query,
    count: matches.length,
    matches: matches.slice(0, MAX_MATCHES).map(compactRow),
    source_tool,
    hint:
      matches.length === 1
        ? 'Exactly one match — use its id (and appId when present) and proceed without asking the user.'
        : matches.length === 0
          ? 'No match found — tell the user and ask for the correct name.'
          : 'Multiple matches — ask the user which one they mean (show names, never raw IDs).',
  };
}

/**
 * Try global_search first for supported types. Returns matches array or null
 * when the caller should fall back to the domain lookup tool.
 */
async function tryGlobalSearch(entity_type, query) {
  const objectName = GLOBAL_SEARCH_OBJECT_NAMES[entity_type];
  if (!objectName) return null;

  const result = await executeMcpTool('global_search', {
    search: query,
    object_name: objectName,
  });

  if (result && result.success === false) return null;

  const rows = findRows(result);
  if (rows.length === 0) return null;

  return {
    matches: rankMatches(rows, query),
    source_tool: 'global_search',
  };
}

export function registerLookupTools() {
  registerTool(
    'resolve_entity',
    {
      title: 'Resolve Entity',
      description:
        'Universal lookup: resolve a person/customer/contact/product/vendor/tax/department/branch/job/project/task/sales order/warehouse/deal referenced BY NAME into its internal record (with IDs). ' +
        'Prefer this over asking the user for an ID. For common CRM/finance types this uses global search (id + appId in one call). ' +
        'Skip this when [Referenced records] / Known entities already supply the ID. ' +
        `entity_type must be one of: ${ENTITY_TYPES.join(', ')}.`,
      capabilities: { domain: 'lookup', entity: 'any', action: 'list', safety: 'read' },
      inputSchema: {
        entity_type: z.enum(ENTITY_TYPES).describe('What kind of record to resolve'),
        query: z.string().min(1).describe('The name/text the user gave, e.g. "Santiago"'),
      },
    },
    async ({ entity_type, query }) => {
      const globalHit = await tryGlobalSearch(entity_type, query);
      if (globalHit && globalHit.matches.length > 0) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(
              buildPayload(entity_type, query, globalHit.matches, globalHit.source_tool),
              null,
              2,
            ),
          }],
        };
      }

      const lookup = ENTITY_LOOKUPS[entity_type];
      const result = await executeMcpTool(lookup.tool, lookup.args(query));

      if (result && result.success === false) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              entity_type,
              query,
              error: result.error || 'lookup failed',
              source_tool: lookup.tool,
            }),
          }],
        };
      }

      const matches = rankMatches(findRows(result), query);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(
            buildPayload(entity_type, query, matches, lookup.tool),
            null,
            2,
          ),
        }],
      };
    }
  );
}
