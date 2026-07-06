/**
 * Universal entity resolver — one meta-tool every agent can call to turn a
 * human reference ("Santiago", "Acme Corp", "GST 18%") into internal IDs,
 * without knowing which domain tool owns the lookup. The dispatch table
 * below encodes that knowledge once.
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
};

const ENTITY_TYPES = Object.keys(ENTITY_LOOKUPS);

const MAX_MATCHES = 10;
const ID_KEY_RE = /(^|_)id$|^value$/i;
const NAME_KEY_RE = /name|title|label|email|^text$|^code$/i;

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
    if (typeof value !== 'string') continue;
    const lc = value.toLowerCase();
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
    if (ID_KEY_RE.test(key) || NAME_KEY_RE.test(key)) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : row;
}

export function registerLookupTools() {
  registerTool(
    'resolve_entity',
    {
      title: 'Resolve Entity',
      description:
        'Universal lookup: resolve a person/customer/contact/product/vendor/tax/department/branch/job/project/task referenced BY NAME into its internal record (with IDs). ' +
        'Use this FIRST whenever you need an ID the user only gave a name for, instead of asking the user. ' +
        `entity_type must be one of: ${ENTITY_TYPES.join(', ')}.`,
      capabilities: { domain: 'lookup', entity: 'any', action: 'list', safety: 'read' },
      inputSchema: {
        entity_type: z.enum(ENTITY_TYPES).describe('What kind of record to resolve'),
        query: z.string().min(1).describe('The name/text the user gave, e.g. "Santiago"'),
      },
    },
    async ({ entity_type, query }) => {
      const lookup = ENTITY_LOOKUPS[entity_type];
      const result = await executeMcpTool(lookup.tool, lookup.args(query));

      if (result && result.success === false) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, entity_type, query, error: result.error || 'lookup failed', source_tool: lookup.tool }) }],
        };
      }

      const rows = findRows(result);
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

      const payload = {
        success: true,
        entity_type,
        query,
        count: matches.length,
        matches: matches.slice(0, MAX_MATCHES).map(compactRow),
        hint:
          matches.length === 1
            ? 'Exactly one match — use its id and proceed without asking the user.'
            : matches.length === 0
              ? 'No match found — tell the user and ask for the correct name.'
              : 'Multiple matches — ask the user which one they mean (show names, never raw IDs).',
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
      };
    }
  );
}
