/**
 * Tool index built from MCP registry + capability metadata.
 *
 * This is used to reduce hardcoding (keywords, agent tool lists) by enabling
 * programmatic grouping: by domain/entity/action/safety.
 */
 
import { getToolRegistrySnapshot } from './server.js';
 
/**
 * @typedef {ReturnType<typeof getToolRegistrySnapshot>[number]} ToolSnapshot
 */
 
let cached = null;
let cachedAt = 0;
 
/**
 * Build a tool index from the current registry snapshot.
 *
 * @returns {{
 *  tools: ToolSnapshot[],
 *  byDomain: Record<string, ToolSnapshot[]>,
 *  readTools: ToolSnapshot[],
 *  writeTools: ToolSnapshot[],
 * }}
 */
export function buildToolIndex() {
  const tools = getToolRegistrySnapshot();
  /** @type {Record<string, ToolSnapshot[]>} */
  const byDomain = {};
  /** @type {ToolSnapshot[]} */
  const readTools = [];
  /** @type {ToolSnapshot[]} */
  const writeTools = [];
 
  for (const t of tools) {
    const domain = t?.capabilities?.domain || 'unknown';
    if (!byDomain[domain]) byDomain[domain] = [];
    byDomain[domain].push(t);
 
    const safety = t?.capabilities?.safety || 'mixed';
    if (safety === 'read') readTools.push(t);
    if (safety === 'write') writeTools.push(t);
  }
 
  return { tools, byDomain, readTools, writeTools };
}
 
/**
 * Memoized tool index (rebuilt if registry changes at runtime).
 * Currently registry is built at startup, but this keeps it safe if tools
 * are registered later.
 *
 * @param {{ maxAgeMs?: number }} [opts]
 */
export function getToolIndex(opts = {}) {
  const maxAgeMs = Number.isFinite(opts.maxAgeMs) ? opts.maxAgeMs : 5_000;
  if (!cached || (Date.now() - cachedAt) > maxAgeMs) {
    cached = buildToolIndex();
    cachedAt = Date.now();
  }
  return cached;
}
 
