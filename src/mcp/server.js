/**
 * MCP Server - Model Context Protocol Server Instance
 * 
 * Since the MCP SDK doesn't expose its internal tool registry, we maintain a
 * registry for in-process execution and native OpenAI function definitions.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { normalizeToolCapabilities } from './toolCapabilities.js';
import { afterToolCall, beforeToolCall, onToolError } from './toolPolicyPipeline.js';
import { isPublicMcpTool, registerCoworkerMcpSurface } from '../nova/mcpSurface.js';
import { INVALID_TOOL_ARGUMENTS_KEY } from '../llm/toolArguments.js';

// Tool registry - tracks all registered tools
const toolRegistry = new Map();

function omitNullObjectFields(value) {
  if (Array.isArray(value)) return value.map(omitNullObjectFields);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, child]) => child !== null)
      .map(([key, child]) => [key, omitNullObjectFields(child)]),
  );
}

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
 * Create a fresh SDK McpServer for external MCP clients (POST /mcp).
 * Omits governance-only tools; registers coworker resources + prompts.
 * In-process agents still use the full toolRegistry via executeMcpTool.
 */
export function createMcpServer() {
  const server = new McpServer({
    name: 'worxstream-agent',
    version: '1.0.0',
  });

  for (const [name, tool] of toolRegistry) {
    if (!isPublicMcpTool(name, tool.capabilities)) continue;
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

  registerCoworkerMcpSurface(server);

  return server;
}

/**
 * Get registered tools as native OpenAI function definitions.
 * @param {string[]|null} filterToolNames - Optional array of tool names to filter. If null, returns all tools.
 * @returns {Array} OpenAI function tool definitions
 */
export function getOpenAITools(filterToolNames = null, { strict = true } = {}) {
  const tools = [];
  
  for (const [name, tool] of toolRegistry) {
    // If filter is provided, only include matching tools
    if (filterToolNames && !filterToolNames.includes(name)) {
      continue;
    }
    
    tools.push({
      type: 'function',
      function: {
        name,
        description: tool.description || tool.title || name,
        parameters: getOpenAIParameters(tool, strict),
        ...(strict ? { strict: true } : {}),
      },
    });
  }
  
  return tools;
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
    if (normalizedInput?.[INVALID_TOOL_ARGUMENTS_KEY]) {
      return {
        success: false,
        error: normalizedInput[INVALID_TOOL_ARGUMENTS_KEY],
        error_type: 'invalid_tool_arguments',
      };
    }

    // The SDK validates calls coming through /mcp, but agents invoke registry
    // callbacks in-process. Apply the exact same Zod boundary here before a
    // malformed model call can reach a read or write API.
    const schema = z.object(tool.inputSchema || {});
    let validation = schema.safeParse(normalizedInput ?? {});
    // OpenAI strict schemas represent optional properties as nullable required
    // fields. Remove nulls only when the registered Zod schema rejects them.
    if (!validation.success && normalizedInput && typeof normalizedInput === 'object') {
      const withoutNulls = omitNullObjectFields(normalizedInput);
      validation = schema.safeParse(withoutNulls);
    }
    if (!validation.success) {
      return {
        success: false,
        error: `Invalid arguments for ${toolName}`,
        error_type: 'invalid_tool_arguments',
        details: validation.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
          code: issue.code,
        })),
      };
    }

    const validatedInput = validation.data;
    const result = await tool.callback(validatedInput);
    console.log(`✅ Tool ${toolName} completed`);

    // Parse the result content
    const content = result.content?.[0];
    if (content?.type === 'text') {
      try {
        const parsed = JSON.parse(content.text);
        return afterToolCall(toolName, validatedInput, parsed, enrichedContext);
      } catch {
        return afterToolCall(toolName, validatedInput, { success: true, data: content.text }, enrichedContext);
      }
    }

    return afterToolCall(toolName, validatedInput, { success: true, data: result }, enrichedContext);
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
 * Get OpenAI function parameters for a registry entry, converting the Zod
 * raw shape via zod v4's native toJSONSchema. Memoized on the entry since
 * schema once and memoizing it on the registry entry.
 */
function getOpenAIParameters(tool, strict) {
  const cacheKey = strict ? 'openaiStrictParameters' : 'openaiParameters';
  if (tool[cacheKey]) {
    return tool[cacheKey];
  }
  const schema = zodShapeToOpenAISchema(tool.name, tool.inputSchema);
  tool[cacheKey] = strict ? makeStrictOpenAISchema(schema) : schema;
  return tool[cacheKey];
}

function makeStrictOpenAISchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(makeStrictOpenAISchema);
  const out = {};
  for (const [key, value] of Object.entries(schema)) {
    out[key] = makeStrictOpenAISchema(value);
  }
  if (out.type === 'object' && out.properties) {
    const originallyRequired = new Set(out.required || []);
    out.additionalProperties = false;
    for (const [name, property] of Object.entries(out.properties)) {
      if (!originallyRequired.has(name)) {
        out.properties[name] = { anyOf: [property, { type: 'null' }] };
      }
    }
    out.required = Object.keys(out.properties);
  }
  return out;
}

/** Convert a ZodRawShape to OpenAI JSON Schema parameters. */
function zodShapeToOpenAISchema(toolName, shape) {
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
