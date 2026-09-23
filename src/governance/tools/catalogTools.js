/**
 * Governance-only MCP tools (Control Tower).
 *
 * get_relevant_policies — live catalog snapshot.
 * invoke_agent was removed: Aegis must not spawn Nova chat specialists.
 */

import { z } from 'zod';
import { registerTool } from '../../mcp/server.js';
import { loadPolicyCatalog } from '../pipeline/contextBuilder.js';
import { getWorxstreamContext } from '../../config/index.js';

export function registerGovernanceTools() {
  registerTool(
    'get_relevant_policies',
    {
      title: 'Get Live Governance Catalog',
      description:
        'Read the persistent Control Tower catalog for this company: active policies and active rules. The catalog stays loaded until a policy or rule is created, updated, or deleted. Pass event_type so only rules that apply to this event are returned. Do not invent policies from memory.',
      inputSchema: {
        event_type: z
          .string()
          .optional()
          .describe('Webhook event type, e.g. estimate.created. When set, only matching active rules are returned.'),
      },
      capabilities: { domain: 'governance', action: 'get', safety: 'read' },
    },
    async ({ event_type }) => {
      const { companyId } = getWorxstreamContext();
      const catalog = await loadPolicyCatalog(companyId, event_type);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                source: catalog.loadedAt ? 'catalog_context' : 'live_catalog',
                loadedAt: catalog.loadedAt || null,
                policies: catalog.policies,
                rules: catalog.rules,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
