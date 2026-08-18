/**
 * Governance-only MCP tools.
 *
 * invoke_agent — master agents call child specialists in-process.
 * get_relevant_policies — optional mid-run retrieval (same RAG as the pipeline).
 *
 * Do not add these names to any child agent's extraTools.
 */

import { z } from 'zod';
import { registerTool } from '../server.js';
import { callAgent } from '../../agents/router.js';
import { isChildAgentKey, getAgentKeys } from '../../agents/agentDefinitions.js';
import { retrieveRelevantChunks } from '../../control/rag.js';
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
      title: 'Get Relevant Policies',
      description:
        'Retrieve the most relevant company policy/rule chunks for a short query. Use when the injected policy block is not enough.',
      inputSchema: {
        query: z.string().describe('Short retrieval query, e.g. "credit hold overdue invoices"'),
      },
      capabilities: { domain: 'governance', action: 'get', safety: 'read' },
    },
    async ({ query }) => {
      const { companyId } = getWorxstreamContext();
      const chunks = await retrieveRelevantChunks(companyId, query, { topK: 5 });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            count: chunks.length,
            chunks: chunks.map((c) => ({
              name: c.name,
              type: c.document_type,
              text: c.text,
              score: c.score,
            })),
          }, null, 2),
        }],
      };
    },
  );
}
