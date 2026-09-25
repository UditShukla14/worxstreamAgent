/**
 * Shopify tools — MCP wrappers for Sales Channel Shopify APIs.
 * Source of truth: apps/web/src/services/shopifyService.ts + apiEndpoints.ts SHOPIFY.
 *
 * Orders/products/customers use DB-backed list/detail (not live Shopify GraphQL lists).
 * order_id for create-document is the database row id, not the Shopify GID.
 */

import { z } from 'zod';
import { registerTool } from '../server.js';
import { callWorxstreamAPI, normalizeFilter } from '../../services/httpClient.js';
import { getWorxstreamContext } from '../../config/index.js';
import { getMaxListPageSize } from '../../nova/agents/policies/listPolicies.js';

function asText(result) {
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}

function attachListPagination(result, effectivePage, effectiveLimit) {
  if (!result?.success || !result?.data || typeof result.data !== 'object') return result;

  const apiBody = result.data;
  const listPayload = apiBody?.data && typeof apiBody.data === 'object' ? apiBody.data : apiBody;
  const rows = Array.isArray(listPayload?.data) ? listPayload.data : [];
  const pagination = listPayload?.pagination && typeof listPayload.pagination === 'object'
    ? listPayload.pagination
    : null;
  const currentPage = pagination?.currentPage ?? effectivePage;
  const lastPage = pagination?.lastPage;
  const total = pagination?.total;
  const hasMore = Number.isFinite(currentPage) && Number.isFinite(lastPage)
    ? currentPage < lastPage
    : (Number.isFinite(total) ? rows.length < total : false);
  const nextPage = Number.isFinite(currentPage) && Number.isFinite(lastPage) && currentPage < lastPage
    ? currentPage + 1
    : null;

  const enriched = {
    ...listPayload,
    pagination: {
      ...(pagination || {}),
      returned: rows.length,
      has_more: Boolean(hasMore),
      next_page: nextPage,
    },
  };

  if (apiBody?.data && typeof apiBody.data === 'object' && !Array.isArray(apiBody.data)) {
    return { ...result, data: { ...apiBody, data: enriched } };
  }
  return { ...result, data: enriched };
}

function shopifyResourceId(value) {
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  const parts = raw.split('/');
  return parts[parts.length - 1] || raw;
}

export function registerShopifyTools() {
  const orderFilterSchema = z.object({
    search: z.string().optional().describe('Text search (order name, customer, email)'),
    risk_level: z.string().optional().describe('Risk level filter when supported by API'),
    tags: z.array(z.string()).optional().describe('Order tags'),
    advance: z.array(z.object({
      db_attribute: z.string().describe('e.g. created_at_shopify'),
      operator: z.string().describe('e.g. BETWEEN, >=, <='),
      value: z.union([z.string(), z.number(), z.array(z.string()), z.array(z.number())])
        .describe('For BETWEEN use [from, to] as YYYY-MM-DD'),
    })).optional().describe('Advance filters (date ranges, etc.)'),
  }).optional();

  const productFilterSchema = z.object({
    search: z.string().optional().describe('Text search (title, SKU, vendor)'),
    status: z.enum(['ACTIVE', 'DRAFT', 'ARCHIVED', 'UNLISTED']).optional()
      .describe('Shopify product status'),
    tags: z.array(z.string()).optional().describe('Product tags'),
  }).optional();

  // ── Connection ─────────────────────────────────────────────────────
  registerTool(
    'get_shopify_status',
    {
      title: 'Get Shopify Connection Status',
      description: 'Check whether Shopify is connected for this company (shop domain, shop name, status).',
      inputSchema: {},
    },
    async () => {
      const { companyId, userId } = getWorxstreamContext();
      return asText(await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/shopify/status',
        data: { company_id: companyId, user_id: userId },
      }));
    }
  );

  // ── Orders ─────────────────────────────────────────────────────────
  registerTool(
    'list_shopify_orders',
    {
      title: 'List Shopify Orders',
      description:
        'List one page of Shopify orders from the DB-backed Sales Channel list (default page=1, limit=25, hard-capped). '
        + 'Returns pagination.has_more and pagination.next_page — call again for more. Never dump the full tenant set. '
        + 'filter.search is text only. Optional risk_level, tags, and filter.advance for date ranges. '
        + 'Use database row id (not Shopify GID) with get_shopify_order_details / create_shopify_document.',
      inputSchema: {
        limit: z.number().optional().describe('Page size (default 25, max enforced by runtime)'),
        page: z.number().optional().describe('Page number (default: 1). Use next_page from prior response for more.'),
        filter: orderFilterSchema.describe('Filter: search, risk_level, tags, advance'),
      },
    },
    async ({ limit = 25, page = 1, filter } = {}) => {
      const { companyId, userId } = getWorxstreamContext();
      const normalized = normalizeFilter(filter);
      const max = getMaxListPageSize();
      const effectiveLimit = Math.min(Math.max(1, Number(limit) || 25), max);
      const effectivePage = Math.max(1, Math.floor(Number(page) || 1));

      const search = typeof normalized.search === 'string' ? normalized.search.trim() : '';
      const riskLevel = typeof normalized.risk_level === 'string' ? normalized.risk_level.trim() : '';
      const tags = Array.isArray(normalized.tags)
        ? normalized.tags.map((t) => String(t).trim()).filter(Boolean)
        : [];
      const advance = Array.isArray(normalized.advance)
        ? normalized.advance.filter((entry) => entry?.db_attribute && entry?.operator && entry?.value != null)
        : [];

      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/shopify/orders',
        data: {
          company_id: companyId,
          user_id: userId,
          page: effectivePage,
          limit: effectiveLimit,
          filter: {
            ...(search ? { search } : {}),
            ...(riskLevel ? { risk_level: riskLevel } : {}),
            ...(tags.length ? { tags } : {}),
            ...(advance.length ? { advance } : {}),
          },
        },
      });

      return asText(attachListPagination(result, effectivePage, effectiveLimit));
    }
  );

  registerTool(
    'get_shopify_order_details',
    {
      title: 'Get Shopify Order Details',
      description:
        'Get one Shopify order by database row id (from list_shopify_orders). '
        + 'Detail includes line items, addresses, customer, tax, transactions, fulfillments (often nested in rowJson).',
      inputSchema: {
        id: z.union([z.number(), z.string()]).describe('Database order row id (not Shopify GID)'),
      },
    },
    async ({ id }) => {
      const { companyId, userId } = getWorxstreamContext();
      return asText(await callWorxstreamAPI({
        method: 'GET',
        endpoint: `/shopify/orders/${id}`,
        data: { company_id: companyId, user_id: userId },
      }));
    }
  );

  registerTool(
    'update_shopify_order',
    {
      title: 'Refresh Shopify Order',
      description:
        'Re-sync / refresh one Shopify order from Shopify into WorxStream. '
        + 'Pass shopify_order_id (Shopify order id or GID). Confirm with the user first.',
      inputSchema: {
        shopify_order_id: z.union([z.number(), z.string()])
          .describe('Shopify order id or GID (shopify_order_id on the row)'),
      },
    },
    async ({ shopify_order_id }) => {
      const { companyId, userId } = getWorxstreamContext();
      return asText(await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/shopify/orders/update',
        data: {
          company_id: companyId,
          user_id: userId,
          shopify_order_id: String(shopify_order_id),
        },
      }));
    }
  );

  registerTool(
    'create_shopify_document',
    {
      title: 'Create Document from Shopify Order',
      description:
        'Convert a Shopify order into a WorxStream estimate, invoice, or sales_order '
        + '(POST /shopify/orders/create-document). order_id MUST be the database row id from list/detail — not the Shopify GID. '
        + 'On failure the order may gain exceptionsText / exceptionsSku — refresh list after convert. Confirm document_type with the user.',
      inputSchema: {
        order_id: z.number().describe('Database Shopify order row id'),
        document_type: z.enum(['estimate', 'invoice', 'sales_order'])
          .describe('WorxStream document to create'),
      },
    },
    async ({ order_id, document_type }) => {
      const { companyId, userId } = getWorxstreamContext();
      return asText(await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/shopify/orders/create-document',
        data: {
          company_id: companyId,
          user_id: userId,
          order_id,
          document_type,
        },
      }));
    }
  );

  registerTool(
    'generate_shopify_purchase_order',
    {
      title: 'Generate Purchase Order from Shopify Order',
      description:
        'Convert a Shopify order into a purchase order (POST /shopify/orders/generate-po). '
        + 'Pass shopify_order_id (Shopify id/GID). Confirm with the user first.',
      inputSchema: {
        shopify_order_id: z.union([z.number(), z.string()])
          .describe('Shopify order id or GID'),
      },
    },
    async ({ shopify_order_id }) => {
      const { companyId, userId } = getWorxstreamContext();
      return asText(await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/shopify/orders/generate-po',
        data: {
          company_id: companyId,
          user_id: userId,
          shopify_order_id: String(shopify_order_id),
        },
      }));
    }
  );

  // ── Products ───────────────────────────────────────────────────────
  registerTool(
    'list_shopify_products',
    {
      title: 'List Shopify Products',
      description:
        'List one page of Shopify products (default page=1, limit=25, hard-capped). '
        + 'Returns pagination.has_more / next_page. filter.search, optional status (ACTIVE|DRAFT|ARCHIVED|UNLISTED), tags.',
      inputSchema: {
        limit: z.number().optional().describe('Page size (default 25, max enforced by runtime)'),
        page: z.number().optional().describe('Page number (default: 1)'),
        filter: productFilterSchema.describe('Filter: search, status, tags'),
      },
    },
    async ({ limit = 25, page = 1, filter } = {}) => {
      const { companyId, userId } = getWorxstreamContext();
      const normalized = normalizeFilter(filter);
      const max = getMaxListPageSize();
      const effectiveLimit = Math.min(Math.max(1, Number(limit) || 25), max);
      const effectivePage = Math.max(1, Math.floor(Number(page) || 1));

      const search = typeof normalized.search === 'string' ? normalized.search.trim() : '';
      const status = typeof normalized.status === 'string' ? normalized.status.trim() : '';
      const tags = Array.isArray(normalized.tags)
        ? normalized.tags.map((t) => String(t).trim()).filter(Boolean)
        : [];

      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/shopify/products',
        data: {
          company_id: companyId,
          user_id: userId,
          page: effectivePage,
          limit: effectiveLimit,
          filter: {
            ...(search ? { search } : {}),
            ...(status ? { status } : {}),
            ...(tags.length ? { tags } : {}),
          },
        },
      });

      return asText(attachListPagination(result, effectivePage, effectiveLimit));
    }
  );

  registerTool(
    'get_shopify_product_details',
    {
      title: 'Get Shopify Product Details',
      description: 'Get one Shopify product by database row id (from list_shopify_products).',
      inputSchema: {
        id: z.union([z.number(), z.string()]).describe('Database product row id'),
      },
    },
    async ({ id }) => {
      const { companyId, userId } = getWorxstreamContext();
      return asText(await callWorxstreamAPI({
        method: 'GET',
        endpoint: `/shopify/products/${id}`,
        data: { company_id: companyId, user_id: userId },
      }));
    }
  );

  registerTool(
    'update_shopify_product',
    {
      title: 'Update Shopify Product',
      description:
        'Upsert / update a Shopify product (POST /shopify/products). Requires shopify_product_id (GID preferred) and title. '
        + 'Confirm changes with the user before writing.',
      inputSchema: {
        shopify_product_id: z.string().describe('Shopify product GID or numeric id'),
        title: z.string().describe('Product title'),
        descriptionHtml: z.string().optional().describe('HTML description'),
        vendor: z.string().optional(),
        product_type: z.string().optional(),
        category_id: z.string().optional(),
        handle: z.string().optional(),
        status: z.enum(['ACTIVE', 'DRAFT', 'ARCHIVED', 'UNLISTED']).optional(),
        tags: z.array(z.string()).optional(),
      },
    },
    async (input) => {
      const { companyId, userId } = getWorxstreamContext();
      const payload = {
        company_id: companyId,
        user_id: userId,
        shopify_product_id: input.shopify_product_id,
        title: input.title,
      };
      if (input.descriptionHtml != null) payload.descriptionHtml = input.descriptionHtml;
      if (input.vendor != null) payload.vendor = input.vendor;
      if (input.product_type != null) payload.product_type = input.product_type;
      if (input.category_id != null) payload.category_id = input.category_id;
      if (input.handle != null) payload.handle = input.handle;
      if (input.status != null) payload.status = input.status;
      if (input.tags != null) payload.tags = input.tags;

      return asText(await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/shopify/products',
        data: payload,
      }));
    }
  );

  registerTool(
    'sync_shopify_products',
    {
      title: 'Sync Shopify Products',
      description:
        'Queue a full Shopify products sync job (POST /shopify/products/sync). Enqueues only — no toggle state. Confirm first.',
      inputSchema: {},
      capabilities: { action: 'other', safety: 'write' },
    },
    async () => {
      const { companyId, userId } = getWorxstreamContext();
      return asText(await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/shopify/products/sync',
        data: { company_id: companyId, user_id: userId },
      }));
    }
  );

  registerTool(
    'sync_shopify_product_services',
    {
      title: 'Sync Shopify Product Services',
      description:
        'Queue Shopify → WorxStream product-services sync (POST /shopify/product-services/sync). Enqueues only. Confirm first.',
      inputSchema: {},
      capabilities: { action: 'other', safety: 'write' },
    },
    async () => {
      const { companyId, userId } = getWorxstreamContext();
      return asText(await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/shopify/product-services/sync',
        data: { company_id: companyId, user_id: userId },
      }));
    }
  );

  registerTool(
    'manual_sync_shopify_product_services',
    {
      title: 'Manual Sync Shopify Product Services',
      description:
        'Sync selected Shopify product-service rows (POST /shopify/product-services/manual-sync). '
        + 'product_ids are list row id strings (not shopifyProductId). Confirm first.',
      inputSchema: {
        product_ids: z.array(z.string()).min(1)
          .describe('List row id strings from Shopify product-services list'),
      },
      capabilities: { action: 'other', safety: 'write' },
    },
    async ({ product_ids }) => {
      const { companyId, userId } = getWorxstreamContext();
      return asText(await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/shopify/product-services/manual-sync',
        data: {
          company_id: companyId,
          user_id: userId,
          mode: 'multiple',
          product_ids,
        },
      }));
    }
  );

  // ── Customers ──────────────────────────────────────────────────────
  registerTool(
    'list_shopify_customers',
    {
      title: 'List Shopify Customers',
      description:
        'List one page of Shopify customers (default page=1, limit=25, hard-capped). '
        + 'Returns pagination.has_more / next_page. filter.search for name/email.',
      inputSchema: {
        limit: z.number().optional().describe('Page size (default 25, max enforced by runtime)'),
        page: z.number().optional().describe('Page number (default: 1)'),
        filter: z.object({
          search: z.string().optional().describe('Search name/email'),
        }).optional(),
      },
    },
    async ({ limit = 25, page = 1, filter } = {}) => {
      const { companyId, userId } = getWorxstreamContext();
      const normalized = normalizeFilter(filter);
      const max = getMaxListPageSize();
      const effectiveLimit = Math.min(Math.max(1, Number(limit) || 25), max);
      const effectivePage = Math.max(1, Math.floor(Number(page) || 1));
      const search = typeof normalized.search === 'string' ? normalized.search.trim() : '';

      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/shopify/customers',
        data: {
          company_id: companyId,
          user_id: userId,
          page: effectivePage,
          limit: effectiveLimit,
          filter: search ? { search } : {},
        },
      });

      return asText(attachListPagination(result, effectivePage, effectiveLimit));
    }
  );

  registerTool(
    'get_shopify_customer_details',
    {
      title: 'Get Shopify Customer Details',
      description: 'Get one Shopify customer by database row id.',
      inputSchema: {
        id: z.union([z.number(), z.string()]).describe('Database customer row id'),
      },
    },
    async ({ id }) => {
      const { companyId, userId } = getWorxstreamContext();
      return asText(await callWorxstreamAPI({
        method: 'GET',
        endpoint: `/shopify/customers/${id}`,
        data: { company_id: companyId, user_id: userId },
      }));
    }
  );

  // ── Abandoned checkouts ────────────────────────────────────────────
  registerTool(
    'list_shopify_abandoned_checkouts',
    {
      title: 'List Shopify Abandoned Checkouts',
      description:
        'List Shopify abandoned checkouts (cursor pagination via after/before). '
        + 'Default limit 25, hard-capped. Use endCursor as after for the next page when hasNextPage is true.',
      inputSchema: {
        limit: z.number().optional().describe('Page size (default 25, max enforced by runtime)'),
        after: z.string().optional().describe('Cursor for next page (pagination.endCursor)'),
        before: z.string().optional().describe('Cursor for previous page (pagination.startCursor)'),
        filter: z.object({
          search: z.string().optional().describe('Search abandoned checkouts'),
        }).optional(),
      },
    },
    async ({ limit = 25, after, before, filter } = {}) => {
      const { companyId, userId } = getWorxstreamContext();
      const normalized = normalizeFilter(filter);
      const max = getMaxListPageSize();
      const effectiveLimit = Math.min(Math.max(1, Number(limit) || 25), max);
      const search = typeof normalized.search === 'string' ? normalized.search.trim() : '';

      const data = {
        company_id: companyId,
        user_id: userId,
        limit: effectiveLimit,
        filter: search ? { search } : {},
      };
      if (after) data.after = after;
      if (before) data.before = before;

      return asText(await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/shopify/abandoned-checkouts',
        data,
      }));
    }
  );

  registerTool(
    'get_shopify_abandoned_checkout_details',
    {
      title: 'Get Shopify Abandoned Checkout Details',
      description:
        'Get one abandoned checkout. Pass checkout_id as the numeric resource id or full Shopify GID '
        + '(tool strips to the resource id for the API).',
      inputSchema: {
        checkout_id: z.union([z.number(), z.string()])
          .describe('Abandoned checkout id or Shopify GID (checkoutId)'),
      },
    },
    async ({ checkout_id }) => {
      const { companyId, userId } = getWorxstreamContext();
      const id = shopifyResourceId(checkout_id) || String(checkout_id);
      return asText(await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/shopify/abandoned-checkouts/details',
        data: {
          company_id: companyId,
          user_id: userId,
          checkout_id: id,
        },
      }));
    }
  );

  // ── Tax ────────────────────────────────────────────────────────────
  registerTool(
    'calculate_shopify_draft_order_tax',
    {
      title: 'Calculate Shopify Draft Order Tax',
      description:
        'Calculate tax for a shipping address via Shopify draft-order tax API '
        + '(POST /shopify/draft-orders/calculate-tax).',
      inputSchema: {
        shipping_address: z.object({
          first_name: z.string().describe('First name'),
          last_name: z.string().describe('Last name'),
          address1: z.string().describe('Street address line 1'),
          address2: z.string().nullable().optional().describe('Street address line 2'),
          city: z.string().describe('City'),
          province: z.string().describe('Province / state'),
          country: z.string().describe('Country name'),
          countryCodeV2: z.string().describe('ISO country code, e.g. US'),
          zip: z.string().describe('Postal / ZIP code'),
        }).describe('Shipping address for tax calculation'),
      },
      capabilities: { action: 'other', safety: 'read' },
    },
    async ({ shipping_address }) => {
      const { companyId, userId } = getWorxstreamContext();
      return asText(await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/shopify/draft-orders/calculate-tax',
        data: {
          company_id: companyId,
          user_id: userId,
          shipping_address,
        },
      }));
    }
  );
}
