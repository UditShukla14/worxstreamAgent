/**
 * MCP face for external clients: product tools + coworker resources/prompts.
 * Governance catalog tools stay internal (in-process registry only).
 */

import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getPlaybookForDomain, listPlaybookDomains } from './agents/playbooks.js';
import { getSoulSystemPrompt } from './agents/soul.js';

/** Tool names that must not appear on POST /mcp. */
export function isPublicMcpTool(name, capabilities = {}) {
  const n = String(name || '');
  if (n === 'invoke_agent' || n === 'get_relevant_policies') return false;
  if (capabilities?.domain === 'governance') return false;
  return true;
}

/**
 * Register coworker MCP Resources + Prompts on an SDK server.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 */
export function registerCoworkerMcpSurface(server) {
  server.registerResource(
    'coworker-soul',
    'coworker://soul',
    {
      title: 'Coworker soul',
      description: 'Nova coworker identity and guardrails (SOUL.md)',
      mimeType: 'text/markdown',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'text/markdown',
          text: getSoulSystemPrompt() || 'Soul not loaded.',
        },
      ],
    }),
  );

  server.registerResource(
    'domain-playbook',
    new ResourceTemplate('playbook://{domain}', {
      list: async () => ({
        resources: listPlaybookDomains().map((domain) => ({
          uri: `playbook://${domain}`,
          name: `${domain} playbook`,
          mimeType: 'text/markdown',
        })),
      }),
    }),
    {
      title: 'Domain playbook',
      description: 'SOP playbook for a specialty domain (estimate, invoice, …)',
      mimeType: 'text/markdown',
    },
    async (uri, { domain }) => {
      const text = getPlaybookForDomain(domain);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'text/markdown',
            text: text || `No playbook for domain "${domain}".`,
          },
        ],
      };
    },
  );

  server.registerResource(
    'session-focus',
    'coworker://session-focus',
    {
      title: 'Session focus',
      description:
        'Working-set / session focus is injected per chat turn from Redis ConversationContext. External MCP clients should use the chat API for live working-set.',
      mimeType: 'text/plain',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'text/plain',
          text:
            'Session focus (goal, active task, pending clarification, lastOutcome, toolNotes) is maintained in Redis ConversationContext and injected into coworker turns as [Session focus]. Use /api/agents/stream for live working-set; this MCP resource documents the contract only.',
        },
      ],
    }),
  );

  for (const domain of listPlaybookDomains()) {
    const body = getPlaybookForDomain(domain);
    if (!body) continue;
    server.registerPrompt(
      `playbook_${domain}`,
      {
        title: `${domain} playbook`,
        description: `Load the ${domain} domain SOP for Nova specialists`,
        argsSchema: z.object({}),
      },
      async () => ({
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `[Domain playbook: ${domain}]\n${body}`,
            },
          },
        ],
      }),
    );
  }
}
