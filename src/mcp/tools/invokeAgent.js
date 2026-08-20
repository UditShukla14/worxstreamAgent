/**
 * Governance-only MCP tools.
 *
 * invoke_agent — master agents call child specialists in-process.
 * get_relevant_policies — live Control Tower catalog (active policies/rules).
 *
 * Do not add these names to any child agent's extraTools.
 */

import { z } from 'zod';
import { registerTool } from '../server.js';
import { callAgent } from '../../agents/router.js';
import { isChildAgentKey, getAgentKeys } from '../../agents/agentDefinitions.js';
import { loadPolicyCatalog } from '../../control/contextBuilder.js';
import { getWorxstreamContext } from '../../config/index.js';

export function registerGovernanceTools() {
  registerTool(
    'invoke_agent',
    {
      title: 'Invoke Child Agent',
      description:
        'Run a specialist (child) agent by key and return its response. Governance masters only. agent_key must be a chat specialist such as estimate, invoice, customer, or product — never another governance agent.',
      inputSchema: {
        agent_key: z.string().describe('Child agent key, e.g. estimate, invoice, customer, product'),
        message: z.string().describe('Instruction for the child agent (read-only work)'),
      },
      capabilities: { domain: 'governance', action: 'other', safety: 'read' },
    },
    async ({ agent_key, message }) => {
      const key = String(agent_key || '').trim();
      if (!isChildAgentKey(key)) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: `invoke_agent only accepts child agent keys. Got "${key}". Allowed: ${getAgentKeys().filter((k) => k !== 'nova').join(', ')}`,
            }),
          }],
        };
      }

      try {
        const result = await callAgent(key, message, {
          fromAgent: 'governance',
          reason: 'invoke_agent',
        });
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              agent: result.agent,
              response: result.response,
              tools_used: result.toolsUsed || [],
              usage: result.usage || {},
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error.message || String(error),
            }),
          }],
        };
      }
    },
  );

  registerTool(
    'get_relevant_policies',
    {
      title: 'Get Live Governance Catalog',
      description:
        'Read the persistent Control Tower catalog for this company: active policies and active rules. The catalog stays loaded until a policy or rule is created, updated, or deleted. Pass event_type so only rules that apply to this event are returned. Do not invent policies from memory.',
      inputSchema: {
        event_type: z.string().optional().describe('Webhook event type, e.g. estimate.created. When set, only matching active rules are returned.'),
      },
      capabilities: { domain: 'governance', action: 'get', safety: 'read' },
    },
    async ({ event_type }) => {
      const { companyId } = getWorxstreamContext();
      const catalog = await loadPolicyCatalog(companyId, event_type);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            source: catalog.loadedAt ? 'catalog_context' : 'live_catalog',
            loadedAt: catalog.loadedAt || null,
            policies: catalog.policies,
            rules: catalog.rules,
          }, null, 2),
        }],
      };
    },
  );
}
