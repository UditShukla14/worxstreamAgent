/**
 * MCP Server - Model Context Protocol Server Instance
 * 
 * Since the MCP SDK doesn't expose internal tool registry,
 * we maintain our own registry for Anthropic API integration.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { normalizeToolCapabilities } from './toolCapabilities.js';
import { afterToolCall, beforeToolCall, onToolError } from './toolPolicyPipeline.js';

// Tool registry - tracks all registered tools
const toolRegistry = new Map();

/** Anthropic tool search tool (BM25) - Claude discovers tools on demand; only this + search results load into context */
const TOOL_SEARCH_BM25 = {
  type: 'tool_search_tool_bm25_20251119',
  name: 'tool_search_tool_bm25',
};

/**
 * Wrapper to register tools and track them in our registry
 */
export function registerTool(name, options, callback) {
  const capabilities = normalizeToolCapabilities(name, options?.capabilities);
  // Store in our registry
  toolRegistry.set(name, {
    name,
    title: options.title,
    description: options.description,
    inputSchema: options.inputSchema,
    capabilities,
    callback,
  });
}

/**
 * Create a fresh SDK McpServer with every registered tool.
 * Each instance can only connect to one transport, so the stateless
 * Streamable HTTP route calls this per request.
 */
export function createMcpServer() {
  const server = new McpServer({
    name: 'worxstream-agent',
    version: '1.0.0',
  });

  for (const [name, tool] of toolRegistry) {
    server.registerTool(
      name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
      tool.callback
    );
  }

  return server;
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
      input_schema: getAnthropicInputSchema(tool),
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
export function getAnthropicToolsForToolSearch(filterToolNames = null) {
  const deferredTools = [];
  for (const [name, tool] of toolRegistry) {
    if (filterToolNames && !filterToolNames.includes(name)) continue;
    deferredTools.push({
      name,
      description: tool.description || tool.title || name,
      input_schema: getAnthropicInputSchema(tool),
      defer_loading: true,
    });
  }
  return [TOOL_SEARCH_BM25, ...deferredTools];
}

/**
 * Execute a tool by name
 */
export async function executeMcpTool(toolName, toolInput, context = {}) {
  console.log(`\n🔧 Executing MCP tool: ${toolName}`);
  console.log('📝 Input:', JSON.stringify(toolInput, null, 2));

  const enrichedContext = { ...context };

  try {
    const tool = toolRegistry.get(toolName);
    
    if (!tool) {
      return {
        success: false,
        error: `Unknown tool: ${toolName}`,
        error_type: 'unknown_tool',
      };
    }

    const normalizedInput = beforeToolCall(toolName, toolInput, enrichedContext);
    const result = await tool.callback(normalizedInput);
    console.log(`✅ Tool ${toolName} completed`);

    // Parse the result content
    const content = result.content?.[0];
    if (content?.type === 'text') {
      try {
        const parsed = JSON.parse(content.text);
        return afterToolCall(toolName, normalizedInput, parsed, enrichedContext);
      } catch {
        return afterToolCall(toolName, normalizedInput, { success: true, data: content.text }, enrichedContext);
      }
    }

    return afterToolCall(toolName, normalizedInput, { success: true, data: result }, enrichedContext);
  } catch (error) {
    console.error(`❌ Tool ${toolName} failed:`, error.message);
    return onToolError(toolName, toolInput, error);
  }
}

const EMPTY_INPUT_SCHEMA = Object.freeze({
  type: 'object',
  properties: {},
  required: [],
});

/**
 * Get the Anthropic input_schema for a registry entry, converting the zod
 * raw shape via zod v4's native toJSONSchema. Memoized on the entry since
 * getAnthropicTools is called every agent turn.
 */
function getAnthropicInputSchema(tool) {
  if (tool.anthropicInputSchema) {
    return tool.anthropicInputSchema;
  }
  tool.anthropicInputSchema = zodShapeToAnthropicSchema(tool.name, tool.inputSchema);
  return tool.anthropicInputSchema;
}

/**
 * Convert a ZodRawShape to a valid Anthropic input_schema
 */
function zodShapeToAnthropicSchema(toolName, shape) {
  if (!shape || Object.keys(shape).length === 0) {
    return EMPTY_INPUT_SCHEMA;
  }

  try {
    const jsonSchema = z.toJSONSchema(z.object(shape), {
      io: 'input',
      unrepresentable: 'any',
    });
    delete jsonSchema.$schema;
    delete jsonSchema.additionalProperties;
    return {
      type: 'object',
      properties: jsonSchema.properties || {},
      required: jsonSchema.required || [],
    };
  } catch (error) {
    console.warn(`⚠️ Failed to convert input schema for tool "${toolName}", falling back to permissive schema:`, error.message);
    return EMPTY_INPUT_SCHEMA;
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

/**
 * Get a snapshot of the tool registry including capability metadata.
 * Used to build dynamic indexes for routing and tool selection.
 */
export function getToolRegistrySnapshot() {
  const out = [];
  for (const [name, tool] of toolRegistry) {
    out.push({
      name,
      title: tool.title,
      description: tool.description,
      capabilities: tool.capabilities,
    });
  }
  return out;
}
