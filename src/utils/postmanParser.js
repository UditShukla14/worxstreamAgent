/**
 * Postman Collection Parser
 * Parses Postman collection JSON and extracts API endpoint definitions
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Extract endpoint path from Postman URL
 * Handles both raw URLs and structured URL objects
 */
function extractEndpointPath(url) {
  if (typeof url === 'string') {
    // Remove {{base_url}} prefix and query params
    let path = url.replace(/{{base_url}}/g, '').split('?')[0];
    // Remove leading/trailing slashes
    path = path.replace(/^\/+|\/+$/g, '');
    // Remove /v1/ prefix if present (we'll add /api/ in httpClient)
    path = path.replace(/^v1\//, '');
    return path;
  }

  if (url && url.path) {
    const pathArray = Array.isArray(url.path) ? url.path : [url.path];
    let fullPath = pathArray.filter(p => p && !p.startsWith('{{')).join('/');
    // Remove /v1/ prefix
    fullPath = fullPath.replace(/^v1\//, '');
    return fullPath;
  }

  return null;
}

/**
 * Extract query parameters from Postman URL
 */
function extractQueryParams(url) {
  const params = [];
  
  if (typeof url === 'string') {
    const queryMatch = url.match(/\?([^#]+)/);
    if (queryMatch) {
      const queryString = queryMatch[1];
      queryString.split('&').forEach(param => {
        const [key, value] = param.split('=');
        if (key) params.push({ key, value: value || '' });
      });
    }
  } else if (url && url.query) {
    params.push(...url.query);
  }

  return params;
}

/**
 * Parse request body to extract schema
 */
function parseRequestBody(body) {
  if (!body || body.mode !== 'raw' || !body.raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(body.raw);
    return parsed;
  } catch (e) {
    // Not valid JSON, return as string
    return body.raw;
  }
}

/**
 * Recursively traverse Postman collection items
 */
function traverseItems(items, parentPath = []) {
  const apis = [];

  if (!Array.isArray(items)) {
    return apis;
  }

  for (const item of items) {
    const currentPath = [...parentPath, item.name || 'Unnamed'];

    if (item.request) {
      // This is an API request
      const method = item.request.method || 'GET';
      const url = item.request.url || '';
      const endpoint = extractEndpointPath(url);
      const queryParams = extractQueryParams(url);
      const body = parseRequestBody(item.request.body);

      if (endpoint) {
        apis.push({
          name: item.name || 'Unnamed',
          method: method.toUpperCase(),
          endpoint,
          queryParams,
          body,
          folderPath: currentPath.slice(0, -1), // Exclude the request name itself
          fullPath: currentPath.join(' > '),
        });
      }
    } else if (item.item) {
      // This is a folder, recurse
      apis.push(...traverseItems(item.item, currentPath));
    }
  }

  return apis;
}

/**
 * Parse Postman collection file
 */
export function parsePostmanCollection(filePath) {
  try {
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const collection = JSON.parse(fileContent);

    if (!collection.item || !Array.isArray(collection.item)) {
      throw new Error('Invalid Postman collection format: missing item array');
    }

    const apis = traverseItems(collection.item);

    return {
      collectionName: collection.info?.name || 'Unknown Collection',
      totalApis: apis.length,
      apis,
    };
  } catch (error) {
    console.error('Error parsing Postman collection:', error.message);
    throw error;
  }
}

/**
 * Group APIs by folder path
 */
export function groupApisByCategory(apis) {
  const grouped = {};

  for (const api of apis) {
    const category = api.folderPath.length > 0 
      ? api.folderPath[0] 
      : 'Uncategorized';
    
    if (!grouped[category]) {
      grouped[category] = [];
    }
    
    grouped[category].push(api);
  }

  return grouped;
}

/**
 * Extract endpoint from existing tool files
 */
export function extractEndpointsFromTools() {
  const toolsDir = path.join(__dirname, '../mcp/tools');
  const toolFiles = fs.readdirSync(toolsDir).filter(f => f.endsWith('.js') && f !== 'index.js');
  
  const endpoints = new Set();

  for (const file of toolFiles) {
    const filePath = path.join(toolsDir, file);
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Extract endpoint patterns from callWorxstreamAPI calls
    const endpointMatches = content.matchAll(/endpoint:\s*['"`]([^'"`]+)['"`]/g);
    for (const match of endpointMatches) {
      endpoints.add(match[1]);
    }
  }

  return Array.from(endpoints);
}

/**
 * Compare Postman APIs with existing tools
 */
export function findMissingApis(postmanApis, existingEndpoints) {
  const missing = [];
  const existingSet = new Set(existingEndpoints.map(e => e.replace(/^\/+/, '')));

  for (const api of postmanApis) {
    const normalizedEndpoint = api.endpoint.replace(/^\/+/, '');
    if (!existingSet.has(normalizedEndpoint)) {
      missing.push(api);
    }
  }

  return missing;
}

/**
 * Generate tool name from API name
 */
export function generateToolName(apiName, method, endpoint) {
  // Clean up the name
  let name = apiName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '');

  // If name is too generic, use endpoint
  if (name.length < 3 || name === 'list' || name === 'show' || name === 'store' || name === 'update' || name === 'delete') {
    const endpointParts = endpoint.split('/').filter(p => p);
    const lastPart = endpointParts[endpointParts.length - 1];
    
    // Map common actions
    const actionMap = {
      'list': 'list',
      'show': 'get',
      'store': 'create',
      'update': 'update',
      'delete': 'delete',
      'create': 'create',
      'get': 'get',
    };

    const action = actionMap[lastPart] || method.toLowerCase();
    const resource = endpointParts[endpointParts.length - 2] || endpointParts[0] || 'item';
    
    name = `${action}_${resource}`;
  }

  return name;
}

