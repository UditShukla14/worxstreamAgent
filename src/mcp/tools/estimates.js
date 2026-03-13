/**
 * Estimates Tools - MCP Tool Definitions
 */

import { z } from 'zod';
import crypto from 'crypto';
import { registerTool } from '../server.js';
import { callWorxstreamAPI, normalizeFilter } from '../../services/httpClient.js';
import { config, getWorxstreamContext } from '../../config/index.js';
import { redisGet, redisSet } from '../../services/redisClient.js';

function inputHash(obj) {
  const json = JSON.stringify(obj);
  return crypto.createHash('sha256').update(json).digest('hex').slice(0, 24);
}

export function registerEstimateTools() {

  const filterSchema = z.object({ search: z.string().optional() }).optional();

  // List estimates
  registerTool(
    'list_estimates',
    {
      title: 'List Estimates',
      description: 'List estimates. Can filter by customer_id, vendor_id, and filter.search.',
      inputSchema: {
        customer_id: z.number().optional().describe('Customer ID'),
        vendor_id: z.number().optional().describe('Vendor ID'),
        take: z.number().optional().describe('Number of results (default: 25)'),
        page: z.number().optional().describe('Page number (default: 1)'),
        sort: z.string().optional().describe('Sort field (default: "created_at")'),
        filter: filterSchema.describe('Filter object, e.g. { "search": "term" }'),
      },
    },
    async ({ customer_id, vendor_id, take = 25, page = 1, sort = 'created_at', filter } = {}) => {
      const { companyId, userId } = getWorxstreamContext();
      const filterObj = normalizeFilter(filter);

      const ttl = Number.isFinite(config.redis?.cacheTtlSeconds) ? config.redis.cacheTtlSeconds : 60;
      const cacheKey = `ws:cache:tool:list_estimates:${companyId}:${userId}:${inputHash({
        customer_id: customer_id ?? null,
        vendor_id: vendor_id ?? null,
        take: take ?? 25,
        page: page ?? 1,
        sort: sort ?? 'created_at',
        filter: filterObj ?? {},
      })}`;

      const cached = ttl > 0 ? await redisGet(cacheKey) : null;
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          return { content: [{ type: 'text', text: JSON.stringify(parsed, null, 2) }] };
        } catch {
          // ignore cache parse failures
        }
      }

      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/master-objects/list',
        data: {
          companyId,
          userId,
          appName: 'estimate',
          customer_id,
          vendor_id,
          page: page ?? 1,
          limit: take ?? 25,
          sort,
          filter: filterObj,
        },
      });

      if (ttl > 0) {
        await redisSet(cacheKey, JSON.stringify(result), { ex: ttl });
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Get estimate details
  registerTool(
    'get_estimate_details',
    {
      title: 'Get Estimate Details',
      description: 'Get estimate details by ID.',
      inputSchema: {
        id: z.number().describe('Estimate ID'),
      },
    },
    async ({ id }) => {
      const { companyId, userId } = getWorxstreamContext();

      const ttl = Number.isFinite(config.redis?.cacheTtlSeconds) ? config.redis.cacheTtlSeconds : 60;
      const cacheKey = `ws:cache:entity:get_estimate_details:${companyId}:${id}`;
      const cached = ttl > 0 ? await redisGet(cacheKey) : null;
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          return { content: [{ type: 'text', text: JSON.stringify(parsed, null, 2) }] };
        } catch {
          // ignore cache parse failures
        }
      }

      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/master-objects/show',
        data: {
          company_id: companyId,
          user_id: userId,
          id,
        },
      });

      if (ttl > 0) {
        await redisSet(cacheKey, JSON.stringify(result), { ex: ttl });
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Create estimate
  registerTool(
    'create_estimate',
    {
      title: 'Create Estimate',
      description: 'Create a new estimate.',
      inputSchema: {
        custom_number: z.string().optional().describe('Custom estimate number'),
        contact_id: z.number().describe('Contact ID'),
        customer_id: z.number().describe('Customer ID'),
        job_name: z.string().optional().describe('Job name'),
        job_location: z.string().optional().describe('Job location'),
        issue_date: z.string().describe('Issue date (YYYY-MM-DD)'),
        valid_until_date: z.string().optional().describe('Valid until date (YYYY-MM-DD)'),
        sub_total: z.number().describe('Subtotal'),
        grand_total: z.number().describe('Grand total'),
        currency: z.string().optional().describe('Currency code (default: USD)'),
        notes: z.string().optional().describe('Notes'),
      },
    },
    async (input) => {
      const { companyId, userId } = getWorxstreamContext();
      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/master-objects/store',
        data: {
          company_id: companyId,
          user_id: userId,
          app_name: 'estimate',
          custom_number: input.custom_number,
          contact_id: input.contact_id,
          customer_id: input.customer_id,
          job_name: input.job_name,
          job_location: input.job_location,
          issue_date: input.issue_date,
          valid_until_date: input.valid_until_date,
          sub_total: input.sub_total,
          discount_total: 0,
          discount_source: '1',
          object_tax_percentage: 0,
          object_tax_amount: 0,
          credit_card_tax_percentage: 0,
          grand_total: input.grand_total,
          gross_profit_total: 0,
          gross_profit_percentage: 0,
          currency: input.currency || 'USD',
          notes: input.notes,
          sections: [],
        },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
