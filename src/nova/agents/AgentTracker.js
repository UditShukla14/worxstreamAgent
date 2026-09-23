/**
 * Rex — AgentTracker
 *
 * Singleton that observes every agent invocation in the system:
 *   - Router decisions (which agent was picked, latency)
 *   - Specialist agent runs (duration, tool calls, token usage, status)
 *   - Formatter runs (duration)
 *
 * Provides:
 *   - In-memory dashboard data (aggregate stats + recent activity)
 *   - SSE subscriber list for real-time push to the admin dashboard
 *   - JSONL file logger for persistence
 */

import { appendFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dirname, '../../logs');
const LOG_FILE = join(LOG_DIR, 'rex.jsonl');

const MAX_RECENT = 200;

class AgentTracker {
  constructor() {
    this.activeRequests = new Map();

    // Per-agent aggregate stats
    this.agentStats = {};

    // Global aggregates
    this.global = {
      totalRequests: 0,
      totalToolCalls: 0,
      totalErrors: 0,
      totalTokens: 0,
      totalFormatterCalls: 0,
      startedAt: new Date().toISOString(),
    };

    // Ring buffer of recent completed activities
    this.recentActivity = [];

    // SSE subscribers
    this._subscribers = new Set();

    this._ensureLogDir();
  }

  async _ensureLogDir() {
    try { await mkdir(LOG_DIR, { recursive: true }); } catch { /* exists */ }
  }

  // ── SSE subscription ───────────────────────────────────────────────

  subscribe(callback) {
    this._subscribers.add(callback);
    return () => this._subscribers.delete(callback);
  }

  _broadcast(event) {
    for (const cb of this._subscribers) {
      try { cb(event); } catch { /* subscriber error, ignore */ }
    }
  }

  // ── Logging ────────────────────────────────────────────────────────

  async _log(entry) {
    const line = JSON.stringify({ ...entry, _ts: new Date().toISOString() }) + '\n';
    try { await appendFile(LOG_FILE, line); } catch (err) {
      console.error('Rex: log write error', err.message);
    }
  }

  // ── Request lifecycle ──────────────────────────────────────────────

  /**
   * Call when a user request enters the system (before routing).
   * @returns {string} requestId
   */
  startRequest(requestId, message) {
    const entry = {
      requestId,
      message: message.substring(0, 200),
      startedAt: Date.now(),
      routerDuration: null,
      routerTokens: null,
      agentKey: null,
      agentName: null,
      toolCalls: [],
      status: 'routing',
      error: null,
      rawDuration: null,
      formatterDuration: null,
      totalDuration: null,
      tokens: null,
    };
    this.activeRequests.set(requestId, entry);
    this.global.totalRequests++;

    const event = { type: 'request_started', requestId, message: entry.message };
    this._broadcast(event);
    this._log({ event: 'request_started', ...entry });

    return requestId;
  }

  /**
   * Call after the router resolves agent keys.
   * @param {string} requestId
   * @param {string} agentKey
   * @param {number} routerDurationMs
   * @param {object|null} [routerUsage] - { input_tokens, output_tokens } from Claude router call
   */
  routerResolved(requestId, agentKey, routerDurationMs, routerUsage = null) {
    const entry = this.activeRequests.get(requestId);
    if (!entry) return;

    entry.routerDuration = routerDurationMs;
    entry.agentKey = agentKey;
    entry.status = 'agent_running';
    if (routerUsage) {
      entry.routerTokens = {
        input_tokens: routerUsage.input_tokens || 0,
        output_tokens: routerUsage.output_tokens || 0,
        total_tokens: (routerUsage.input_tokens || 0) + (routerUsage.output_tokens || 0),
      };
      this.global.totalTokens += entry.routerTokens.total_tokens;
    }

    const event = { type: 'router_resolved', requestId, agentKey, routerDuration: routerDurationMs };
    this._broadcast(event);
  }

  /**
   * Call when a tool is invoked during an agent run.
   */
  toolCall(requestId, toolName, durationMs, success) {
    const entry = this.activeRequests.get(requestId);
    if (!entry) return;

    const tc = { tool: toolName, duration: durationMs, success, at: Date.now() };
    entry.toolCalls.push(tc);
    this.global.totalToolCalls++;

    this._ensureAgentStats(entry.agentKey);
    this.agentStats[entry.agentKey].totalToolCalls++;

    const event = { type: 'tool_call', requestId, ...tc };
    this._broadcast(event);
  }

  /**
   * Call when the specialist agent finishes (before formatter).
   */
  agentFinished(requestId, agentName, durationMs, tokens) {
    const entry = this.activeRequests.get(requestId);
    if (!entry) return;

    entry.agentName = agentName;
    entry.rawDuration = durationMs;
    entry.tokens = tokens;
    entry.status = 'formatting';

    if (tokens) {
      this.global.totalTokens += tokens.total_tokens || 0;
    }

    const event = { type: 'agent_finished', requestId, agentName, duration: durationMs };
    this._broadcast(event);
  }

  /**
   * Call when the formatter finishes streaming.
   */
  formatterFinished(requestId, durationMs) {
    const entry = this.activeRequests.get(requestId);
    if (!entry) return;

    entry.formatterDuration = durationMs;
    this.global.totalFormatterCalls++;
  }

  /**
   * Call when the entire request completes (success or error).
   */
  endRequest(requestId, error = null) {
    const entry = this.activeRequests.get(requestId);
    if (!entry) return;

    entry.totalDuration = Date.now() - entry.startedAt;
    entry.status = error ? 'error' : 'completed';
    entry.error = error ? (error.message || String(error)) : null;

    if (error) this.global.totalErrors++;

    // Update per-agent stats
    if (entry.agentKey) {
      this._ensureAgentStats(entry.agentKey);
      const stats = this.agentStats[entry.agentKey];
      stats.totalRequests++;
      stats.totalDuration += entry.totalDuration;
      stats.avgDuration = Math.round(stats.totalDuration / stats.totalRequests);
      if (entry.tokens) stats.totalTokens += entry.tokens.total_tokens || 0;
      if (error) stats.totalErrors++;
      stats.lastActive = new Date().toISOString();
    }

    // Push to recent activity ring buffer
    const completed = { ...entry, startedAt: new Date(entry.startedAt).toISOString() };
    this.recentActivity.push(completed);
    if (this.recentActivity.length > MAX_RECENT) this.recentActivity.shift();

    this.activeRequests.delete(requestId);

    const event = { type: 'request_completed', requestId, ...completed };
    this._broadcast(event);
    this._log({ event: 'request_completed', ...completed });
  }

  // ── Stats helpers ──────────────────────────────────────────────────

  _ensureAgentStats(agentKey) {
    if (!this.agentStats[agentKey]) {
      this.agentStats[agentKey] = {
        agentKey,
        totalRequests: 0,
        totalToolCalls: 0,
        totalDuration: 0,
        avgDuration: 0,
        totalTokens: 0,
        totalErrors: 0,
        lastActive: null,
      };
    }
  }

  // ── Dashboard data ─────────────────────────────────────────────────

  getDashboardData() {
    return {
      global: {
        ...this.global,
        uptime: Date.now() - new Date(this.global.startedAt).getTime(),
        activeRequests: this.activeRequests.size,
        successRate: this.global.totalRequests > 0
          ? Math.round(((this.global.totalRequests - this.global.totalErrors) / this.global.totalRequests) * 100)
          : 100,
      },
      agents: Object.values(this.agentStats).sort((a, b) => b.totalRequests - a.totalRequests),
      activeRequests: Array.from(this.activeRequests.values()).map(e => ({
        requestId: e.requestId,
        message: e.message,
        agentKey: e.agentKey,
        status: e.status,
        elapsed: Date.now() - e.startedAt,
        toolCalls: e.toolCalls.length,
      })),
      recentActivity: this.recentActivity.slice(-50).reverse(),
    };
  }

  getLogs(limit = 50) {
    return this.recentActivity.slice(-limit).reverse();
  }
}

// Singleton
export const rex = new AgentTracker();
