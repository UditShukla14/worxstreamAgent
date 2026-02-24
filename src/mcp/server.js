/**
 * MCP Server - Model Context Protocol Server Instance
 * 
 * Since the MCP SDK doesn't expose internal tool registry,
 * we maintain our own registry for Anthropic API integration.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// Tool registry - tracks all registered tools
const toolRegistry = new Map();

/** Anthropic tool search tool (BM25) - Claude discovers tools on demand; only this + search results load into context */
const TOOL_SEARCH_BM25 = {
  type: 'tool_search_tool_bm25_20251119',
  name: 'tool_search_tool_bm25',
};

// Create the MCP server instance
const mcpServer = new McpServer({
  name: 'worxstream-agent',
  version: '1.0.0',
});

/**
 * Wrapper to register tools and track them in our registry
 */
export function registerTool(name, options, callback) {
  // Store in our registry
  toolRegistry.set(name, {
    name,
    title: options.title,
    description: options.description,
    inputSchema: options.inputSchema,
    callback,
  });

  // Also register with MCP server
  mcpServer.registerTool(name, options, callback);
}

/**
 * Get all registered tools for Anthropic API
 * @param {string[]|null} filterToolNames - Optional array of tool names to filter. If null, returns all tools.
 * @returns {Array} Array of tool definitions for Anthropic API
 */
export function getAnthropicTools(filterToolNames = null) {
  const tools = [];
  
  for (const [name, tool] of toolRegistry) {
    // If filter is provided, only include matching tools
    if (filterToolNames && !filterToolNames.includes(name)) {
      continue;
    }
    
    tools.push({
      name,
      description: tool.description || tool.title || name,
      input_schema: tool.inputSchema ? zodSchemaToJsonSchema(tool.inputSchema) : {
        type: 'object',
        properties: {},
        required: [],
      },
    });
  }
  
  return tools;
}

/**
 * Get tools in tool-search format: search tool + all MCP tools with defer_loading.
 * Claude only sees the search tool initially; when it searches, the API returns 3–5 relevant tools.
 * Use this for on-demand tool loading (no static keyword/phrase matching).
 * @returns {Array} Tools array for Messages API with tool search + defer_loading
 */
export function getAnthropicToolsForToolSearch() {
  const deferredTools = [];
  for (const [name, tool] of toolRegistry) {
    deferredTools.push({
      name,
      description: tool.description || tool.title || name,
      input_schema: tool.inputSchema ? zodSchemaToJsonSchema(tool.inputSchema) : {
        type: 'object',
        properties: {},
        required: [],
      },
      defer_loading: true,
    });
  }
  return [TOOL_SEARCH_BM25, ...deferredTools];
}

/**
 * Execute a tool by name
 */
export async function executeMcpTool(toolName, toolInput) {
  console.log(`\n🔧 Executing MCP tool: ${toolName}`);
  console.log('📝 Input:', JSON.stringify(toolInput, null, 2));

  try {
    const tool = toolRegistry.get(toolName);
    
    if (!tool) {
      return { success: false, error: `Unknown tool: ${toolName}` };
    }

    const result = await tool.callback(toolInput);
    console.log(`✅ Tool ${toolName} completed`);

    // Parse the result content
    const content = result.content?.[0];
    if (content?.type === 'text') {
      try {
        return JSON.parse(content.text);
      } catch {
        return { success: true, data: content.text };
      }
    }

    return { success: true, data: result };
  } catch (error) {
    console.error(`❌ Tool ${toolName} failed:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Convert Zod schema to JSON Schema for Anthropic
 */
function zodSchemaToJsonSchema(zodSchema) {
  const properties = {};
  const required = [];

  for (const [key, schema] of Object.entries(zodSchema)) {
    const schemaType = getZodType(schema);
    properties[key] = {
      type: schemaType.type,
      description: schema.description || key,
    };
    
    if (schemaType.items) {
      properties[key].items = schemaType.items;
    }
    
    if (!schema.isOptional?.()) {
      required.push(key);
    }
  }

  return {
    type: 'object',
    properties,
    required,
  };
}

/**
 * Get the JSON Schema type from a Zod schema
 */
function getZodType(schema) {
  const typeName = schema._def?.typeName;
  
  switch (typeName) {
    case 'ZodString':
      return { type: 'string' };
    case 'ZodNumber':
      return { type: 'number' };
    case 'ZodBoolean':
      return { type: 'boolean' };
    case 'ZodArray':
      return { type: 'array', items: { type: 'string' } };
    case 'ZodOptional':
      return getZodType(schema._def.innerType);
    default:
      return { type: 'string' };
  }
}

/**
 * Get available tool names
 */
export function getAvailableTools() {
  return Array.from(toolRegistry.keys());
}

/**
 * Get tool count
 */
export function getToolCount() {
  return toolRegistry.size;
}

export { mcpServer };
