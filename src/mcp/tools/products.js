/**
 * Products & Services Tools - MCP Tool Definitions
 */

import { z } from 'zod';
import { registerTool } from '../server.js';
import { callWorxstreamAPI } from '../../services/httpClient.js';
import { config } from '../../config/index.js';

export function registerProductTools() {
  const companyId = config.worxstream.defaultCompanyId;
  const userId = config.worxstream.defaultUserId;

  // ============================================
  // PRODUCT CATEGORIES
  // ============================================

  registerTool(
    'list_product_categories',
    {
      title: 'List Product Categories',
      description: 'Get all product categories.',
      inputSchema: {},
    },
    async () => {
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/master/product/categories',
        data: { company_id: companyId, user_id: userId },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'create_product_category',
    {
      title: 'Create Product Category',
      description: 'Create a product category.',
      inputSchema: {
        title: z.string().describe('Category title'),
        description: z.string().optional().describe('Description'),
        is_active: z.boolean().optional().describe('Is active'),
        sort_order: z.number().optional().describe('Sort order'),
      },
    },
    async (input) => {
      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/master/product/create-category',
        data: {
          company_id: companyId,
          user_id: userId,
          title: input.title,
          description: input.description || '',
          is_active: true,
          sort_order: input.sort_order || 1,
          image: '',
        },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'update_product_category',
    {
      title: 'Update Product Category',
      description: 'Update a product category.',
      inputSchema: {
        id: z.number().describe('Category ID'),
        title: z.string().optional().describe('Category title'),
        description: z.string().optional().describe('Description'),
        is_active: z.boolean().optional().describe('Is active'),
      },
    },
    async (input) => {
      const result = await callWorxstreamAPI({
        method: 'PUT',
        endpoint: '/master/product/update-category',
        data: { company_id: companyId, user_id: userId, ...input },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // ============================================
  // PRODUCT SUB-CATEGORIES
  // ============================================

  registerTool(
    'list_product_subcategories',
    {
      title: 'List Product Subcategories',
      description: 'Get subcategories for a category.',
      inputSchema: {
        category_id: z.number().describe('Parent category ID'),
      },
    },
    async ({ category_id }) => {
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/master/product/subcategories',
        data: { company_id: companyId, user_id: userId, category_id },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'create_product_subcategory',
    {
      title: 'Create Product Subcategory',
      description: 'Create a product subcategory.',
      inputSchema: {
        category_id: z.number().describe('Parent category ID'),
        title: z.string().describe('Subcategory title'),
        description: z.string().optional().describe('Description'),
        is_active: z.boolean().optional().describe('Is active'),
      },
    },
    async (input) => {
      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/master/product/create-subcategory',
        data: { 
          company_id: companyId, 
          user_id: userId, 
          ...input,
          is_active: true,
        },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'update_product_subcategory',
    {
      title: 'Update Product Subcategory',
      description: 'Update a product subcategory.',
      inputSchema: {
        id: z.number().describe('Subcategory ID'),
        category_id: z.number().optional().describe('Parent category ID'),
        title: z.string().optional().describe('Subcategory title'),
        description: z.string().optional().describe('Description'),
        is_active: z.boolean().optional().describe('Is active'),
        sort_order: z.number().optional().describe('Sort order'),
        image: z.string().optional().describe('Image'),
      },
    },
    async (input) => {
      const result = await callWorxstreamAPI({
        method: 'PUT',
        endpoint: '/master/product/update-subcategory',
        data: { company_id: companyId, user_id: userId, ...input },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'bulk_action_product_service',
    {
      title: 'Bulk Action Product Service',
      description: 'Perform bulk actions on products/services.',
      inputSchema: {
        ids: z.array(z.number()).describe('Array of product/service IDs'),
        description: z.string().optional().describe('Description'),
        margin: z.number().optional().describe('Margin'),
        is_active: z.boolean().optional().describe('Is active'),
        is_delete: z.boolean().optional().describe('Is delete'),
      },
    },
    async (input) => {
      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/master/product/bulk-action-product-service',
        data: { company_id: companyId, user_id: userId, ...input },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'quick_update_product_service',
    {
      title: 'Quick Update Product Service',
      description: 'Quick update a SINGLE attribute/field of a product or service. Use this when updating only one field (e.g., sales_price, cost_price, title). For multiple field updates, use update_product instead.',
      inputSchema: {
        id: z.number().describe('Product/service ID'),
        db_attribute: z.string().describe('Database attribute name (e.g., "sales_price", "cost_price")'),
        value: z.union([z.string(), z.number(), z.boolean()]).describe('New value'),
      },
    },
    async (input) => {
      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/master/product/quick-update-product-service',
        data: { company_id: companyId, user_id: userId, ...input },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // ============================================
  // PRODUCTS & SERVICES
  // ============================================

  registerTool(
    'list_products',
    {
      title: 'List Products',
      description: 'Get all products and services. Search with filter. Type can be "product" or "service".',
      inputSchema: {
        type: z.string().optional().describe('Type: "product" or "service" (default: "product")'),
        search: z.string().optional().describe('Search keyword'),
        take: z.number().optional().describe('Number of results (default: 100)'),
        page: z.number().optional().describe('Page number'),
      },
    },
    async ({ type = 'product', search, take = 100, page = 1 }) => {
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/master/product/product-service-list',
        data: {
          company_id: companyId,
          user_id: userId,
          type,
          take,
          page,
          filter: { search: search || '' },
        },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'get_product_details',
    {
      title: 'Get Product Details',
      description: 'Get product/service details.',
      inputSchema: {
        id: z.number().describe('Product ID'),
      },
    },
    async ({ id }) => {
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/master/product/product-service-details',
        data: { company_id: companyId, user_id: userId, id },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'create_product',
    {
      title: 'Create Product',
      description: 'Create a product or service.',
      inputSchema: {
        type: z.string().optional().describe('"product" or "service"'),
        title: z.string().describe('Product title'),
        description: z.string().optional().describe('Description'),
        qty: z.number().optional().describe('Quantity'),
        cost_price: z.number().optional().describe('Cost price'),
        sales_price: z.number().optional().describe('Sales price'),
        map_price: z.number().optional().describe('MAP price'),
        margin: z.number().optional().describe('Margin'),
        category_id: z.number().optional().describe('Category ID'),
        sub_category_id: z.number().optional().describe('Subcategory ID'),
        brand: z.string().optional().describe('Brand name'),
        vendor_id: z.number().optional().describe('Vendor ID'),
        product_number: z.string().optional().describe('Product number/SKU'),
        model_number: z.string().optional().describe('Model number'),
        tags: z.array(z.string()).optional().describe('Tags'),
        is_active: z.boolean().optional().describe('Is active'),
        is_taxable: z.boolean().optional().describe('Is taxable'),
      },
    },
    async (input) => {
      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/master/product/create-product-service',
        data: {
          company_id: companyId,
          user_id: userId,
          type: input.type || 'product',
          title: input.title,
          description: input.description || '',
          qty: input.qty || 1,
          cost_price: input.cost_price,
          sales_price: input.sales_price,
          map_price: input.map_price,
          margin: input.margin,
          category_id: input.category_id,
          sub_category_id: input.sub_category_id,
          brand: input.brand,
          vendor_id: input.vendor_id,
          product_number: input.product_number,
          model_number: input.model_number,
          tags: Array.isArray(input.tags) ? input.tags : [],
          is_active: true,
          is_taxable: input.is_taxable !== false,
          image: '',
        },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'update_product',
    {
      title: 'Update Product',
      description: 'Update a product or service with multiple fields. For updating a single field/attribute, use quick_update_product_service instead.',
      inputSchema: {
        id: z.number().describe('Product ID'),
        title: z.string().optional().describe('Product title'),
        description: z.string().optional().describe('Description'),
        cost_price: z.number().optional().describe('Cost price'),
        sales_price: z.number().optional().describe('Sales price'),
        is_active: z.boolean().optional().describe('Is active'),
      },
    },
    async (input) => {
      const result = await callWorxstreamAPI({
        method: 'PUT',
        endpoint: '/master/product/update-product-service',
        data: { company_id: companyId, user_id: userId, ...input },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'delete_product',
    {
      title: 'Delete Product',
      description: 'Delete a product or service.',
      inputSchema: {
        id: z.number().describe('Product ID'),
      },
    },
    async ({ id }) => {
      const result = await callWorxstreamAPI({
        method: 'DELETE',
        endpoint: '/master/product/delete-product-service',
        data: { company_id: companyId, user_id: userId, id },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'clone_product',
    {
      title: 'Clone Product',
      description: 'Clone/duplicate a product.',
      inputSchema: {
        id: z.number().describe('Product ID to clone'),
      },
    },
    async ({ id }) => {
      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/master/product/clone-product-service',
        data: { company_id: companyId, user_id: userId, id },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  registerTool(
    'get_products_dropdown',
    {
      title: 'Get Products Dropdown',
      description: 'Get products for dropdown selection.',
      inputSchema: {
        search: z.string().optional().describe('Search term'),
      },
    },
    async ({ search }) => {
      const result = await callWorxstreamAPI({
        method: 'GET',
        endpoint: '/master/product/product-service-dropdowns',
        data: { company_id: companyId, user_id: userId, search: search || '' },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
