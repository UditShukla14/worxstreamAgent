/**
 * Attribute Aegis dashboard health from pipeline runs.
 * Findings persist as aegis_policy_* / aegis_rule_* — not agentKey === 'aegis'.
 */

export function stepBelongsToAgent(step, agentKey) {
  const key = String(step?.agentKey || '');
  if (!agentKey) return false;
  return key === agentKey || key.startsWith(`${agentKey}_`);
}

export function runBelongsToAgent(run, agentKey) {
  const pipeline = Array.isArray(run?.pipeline) ? run.pipeline : [];
  if (pipeline.includes(agentKey)) return true;
  return (run?.steps || []).some((step) => stepBelongsToAgent(step, agentKey));
}

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * @param {object[]} weekRuns
 * @param {string} agentKey
 * @param {{ today?: Date }} [options]
 */
export function agentStatFromRuns(weekRuns, agentKey, { today = new Date() } = {}) {
  const attributed = (weekRuns || []).filter((run) => runBelongsToAgent(run, agentKey));
  const todayRuns = attributed.filter((run) => {
    const ts = run.timestamp ? new Date(run.timestamp) : null;
    return ts && ts >= today;
  });
  const passed = attributed.filter((run) => run.status === 'pass').length;
  const withDuration = attributed.filter((run) => Number(run.total_duration_ms || run.totalDurationMs || 0) > 0);
  const last = [...attributed].sort((a, b) => {
    const aTs = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const bTs = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return bTs - aTs;
  })[0];
  const avgDuration = withDuration.length === 0
    ? 0
    : Math.round(
      withDuration.reduce((sum, run) => sum + Number(run.total_duration_ms || run.totalDurationMs || 0), 0)
        / withDuration.length,
    );

  return {
    runsToday: todayRuns.length,
    avgDurationMs: avgDuration,
    lastRunAt: toIso(last?.timestamp),
    passRate: attributed.length === 0 ? 0 : Math.round((passed / attributed.length) * 100),
    status: attributed.some((run) => run.status === 'flagged' || run.status === 'error')
      ? 'degraded'
      : 'healthy',
  };
}
