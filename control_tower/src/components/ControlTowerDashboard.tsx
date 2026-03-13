import { Activity, CheckCircle, BellDot, GitBranch } from 'lucide-react'
import {
  MOCK_KPI,
  MOCK_RUNS,
  MOCK_AGENT_STATS,
  MOCK_EVENT_DISTRIBUTION,
  EVENT_TYPE_LABELS,
  formatTs,
  formatDuration,
  type RunStatus,
  type MasterAgentStat,
} from '../mock/controlTowerMockData'

// ── KPI Cards ─────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  icon,
  color,
}: {
  label: string
  value: string | number
  icon: React.ReactNode
  color: 'blue' | 'green' | 'amber' | 'purple'
}) {
  return (
    <div className="ct-kpi-card">
      <div className={`ct-kpi-icon ${color}`}>{icon}</div>
      <div className="ct-kpi-body">
        <div className="ct-kpi-value">{value}</div>
        <div className="ct-kpi-label">{label}</div>
      </div>
    </div>
  )
}

// ── Activity Feed ─────────────────────────────────────────────

const STATUS_PIPELINE_LABELS: Record<RunStatus, string> = {
  pass: 'Passed',
  flagged: 'Flagged',
  error: 'Error',
}

function ActivityFeed() {
  const recent = [...MOCK_RUNS].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  ).slice(0, 10)

  return (
    <div className="ct-section">
      <div className="ct-section-header">
        <h3>Recent Pipeline Runs</h3>
        <span style={{ fontSize: 11, color: 'var(--ct-text-muted)' }}>Last 10</span>
      </div>
      <div className="ct-section-body" style={{ padding: '0 20px' }}>
        <div className="ct-activity-list">
          {recent.map(run => (
            <div className="ct-activity-item" key={run.runId}>
              <div className={`ct-activity-dot ${run.status}`} />
              <div className="ct-activity-body">
                <div className="ct-activity-title">
                  {EVENT_TYPE_LABELS[run.eventType]} — {run.entityLabel}
                </div>
                <div className="ct-activity-meta">
                  {run.pipeline.length} agent{run.pipeline.length !== 1 ? 's' : ''} &middot;{' '}
                  {formatDuration(run.totalDurationMs)} &middot;{' '}
                  <span
                    style={{
                      color:
                        run.status === 'pass'
                          ? 'var(--ct-green)'
                          : run.status === 'flagged'
                          ? 'var(--ct-amber)'
                          : 'var(--ct-red)',
                    }}
                  >
                    {STATUS_PIPELINE_LABELS[run.status]}
                  </span>
                </div>
              </div>
              <div className="ct-activity-time">{formatTs(run.timestamp)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Agent Health ──────────────────────────────────────────────

function AgentHealthGrid() {
  return (
    <div className="ct-agent-health-grid">
      {MOCK_AGENT_STATS.map((agent: MasterAgentStat) => (
        <div className="ct-agent-card" key={agent.key}>
          <div className="ct-agent-card-header">
            <span className="ct-agent-card-name">{agent.name}</span>
            <span className={`ct-badge ${agent.status}`}>{agent.status}</span>
          </div>
          <div className="ct-agent-card-desc">{agent.description}</div>
          <div className="ct-agent-card-stats">
            <div className="ct-agent-stat">
              <div className="ct-agent-stat-val">{agent.runsToday}</div>
              <div className="ct-agent-stat-lbl">Runs today</div>
            </div>
            <div className="ct-agent-stat">
              <div className="ct-agent-stat-val">{agent.passRate}%</div>
              <div className="ct-agent-stat-lbl">Pass rate</div>
            </div>
            <div className="ct-agent-stat">
              <div className="ct-agent-stat-val">{formatDuration(agent.avgDurationMs)}</div>
              <div className="ct-agent-stat-lbl">Avg duration</div>
            </div>
            <div className="ct-agent-stat">
              <div className="ct-agent-stat-val">{formatTs(agent.lastRunAt)}</div>
              <div className="ct-agent-stat-lbl">Last run</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Event Distribution ────────────────────────────────────────

function EventDistribution() {
  return (
    <div className="ct-section">
      <div className="ct-section-header">
        <h3>Event Distribution</h3>
        <span style={{ fontSize: 11, color: 'var(--ct-text-muted)' }}>Last 7 days</span>
      </div>
      <div className="ct-section-body">
        <div className="ct-dist-list">
          {MOCK_EVENT_DISTRIBUTION.map(row => (
            <div className="ct-dist-row" key={row.eventType}>
              <div className="ct-dist-label-row">
                <span>{EVENT_TYPE_LABELS[row.eventType]}</span>
                <span>
                  {row.count} run{row.count !== 1 ? 's' : ''} &middot; {row.pct}%
                </span>
              </div>
              <div className="ct-dist-bar-track">
                <div className="ct-dist-bar-fill" style={{ width: `${row.pct}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Dashboard ─────────────────────────────────────────────────

export function ControlTowerDashboard() {
  return (
    <>
      <div className="ct-page-header">
        <h2>Governance Dashboard</h2>
        <p>Real-time overview of all pipeline activity, alerts, and agent health.</p>
      </div>

      <div className="ct-page-body">
        {/* KPI cards */}
        <div className="ct-kpi-grid">
          <KpiCard
            label="Runs Today"
            value={MOCK_KPI.runsToday}
            icon={<Activity size={18} />}
            color="blue"
          />
          <KpiCard
            label="Pass Rate (7d)"
            value={`${MOCK_KPI.passRate}%`}
            icon={<CheckCircle size={18} />}
            color="green"
          />
          <KpiCard
            label="Open Alerts"
            value={MOCK_KPI.openAlerts}
            icon={<BellDot size={18} />}
            color="amber"
          />
          <KpiCard
            label="Active Pipelines"
            value={MOCK_KPI.activePipelines}
            icon={<GitBranch size={18} />}
            color="purple"
          />
        </div>

        {/* Agent health */}
        <div style={{ marginBottom: 8 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--ct-text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: 12,
            }}
          >
            Master Agent Health
          </div>
          <AgentHealthGrid />
        </div>

        {/* Bottom: activity feed + event distribution */}
        <div className="ct-dash-grid">
          <ActivityFeed />
          <EventDistribution />
        </div>
      </div>
    </>
  )
}
