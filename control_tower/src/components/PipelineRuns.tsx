import { useState } from 'react'
import { X, ChevronDown, ChevronRight } from 'lucide-react'
import {
  MOCK_RUNS,
  EVENT_TYPE_LABELS,
  ALL_EVENT_TYPES,
  formatTs,
  formatDuration,
  type PipelineRun,
  type RunStatus,
  type AgentStep,
  type EventType,
} from '../mock/controlTowerMockData'

// ── Status badge ──────────────────────────────────────────────

function StatusBadge({ status }: { status: RunStatus }) {
  const labels: Record<RunStatus, string> = {
    pass: 'Pass',
    flagged: 'Flagged',
    error: 'Error',
  }
  return <span className={`ct-badge ${status}`}>{labels[status]}</span>
}

// ── Agent step accordion ──────────────────────────────────────

function AgentStep({ step }: { step: AgentStep }) {
  const [open, setOpen] = useState(true)

  return (
    <div className="ct-step">
      <div className="ct-step-header" onClick={() => setOpen(o => !o)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="ct-step-name">{step.agentName}</span>
        <span className={`ct-badge ${step.verdict}`}>{step.verdict}</span>
        <span className="ct-step-meta">{formatDuration(step.durationMs)}</span>
      </div>

      {open && (
        <div className="ct-step-body">
          <div className="ct-step-response">{step.responseExcerpt}</div>

          {step.toolsUsed.length > 0 && (
            <div>
              <div
                style={{
                  fontSize: 10,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  color: 'var(--ct-text-muted)',
                  marginBottom: 6,
                  fontWeight: 600,
                }}
              >
                Tools called
              </div>
              <div className="ct-tool-list">
                {step.toolsUsed.map((t, i) => (
                  <div className="ct-tool-item" key={i}>
                    <div className={`ct-tool-dot ${t.success ? 'success' : 'fail'}`} />
                    <span className="ct-tool-name">{t.name}</span>
                    <span style={{ color: 'var(--ct-text-muted)', fontSize: 11 }}>
                      ({Object.entries(t.input)
                        .map(([k, v]) => `${k}: ${v}`)
                        .join(', ')})
                    </span>
                    <span className="ct-tool-dur">{t.durationMs}ms</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Run Detail Drawer ─────────────────────────────────────────

function RunDrawer({ run, onClose }: { run: PipelineRun; onClose: () => void }) {
  return (
    <>
      <div className="ct-drawer-overlay" onClick={onClose} />
      <div className="ct-drawer">
        <div className="ct-drawer-header">
          <div>
            <h3>{EVENT_TYPE_LABELS[run.eventType]} — {run.entityLabel}</h3>
            <p>Run ID: {run.runId} &middot; {formatTs(run.timestamp)}</p>
          </div>
          <button className="ct-drawer-close" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <div className="ct-drawer-body">
          {/* Meta */}
          <div className="ct-info-grid">
            <div className="ct-info-cell">
              <div className="ct-info-label">Event ID</div>
              <div className="ct-info-value" style={{ fontSize: 12, fontFamily: 'monospace' }}>
                {run.eventId}
              </div>
            </div>
            <div className="ct-info-cell">
              <div className="ct-info-label">Status</div>
              <div className="ct-info-value">
                <StatusBadge status={run.status} />
              </div>
            </div>
            <div className="ct-info-cell">
              <div className="ct-info-label">Company ID</div>
              <div className="ct-info-value">{run.companyId}</div>
            </div>
            <div className="ct-info-cell">
              <div className="ct-info-label">Timestamp</div>
              <div className="ct-info-value" style={{ fontSize: 11 }}>
                {new Date(run.timestamp).toLocaleString()}
              </div>
            </div>
          </div>

          {/* Pipeline steps */}
          <div>
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--ct-text-secondary)',
                marginBottom: 10,
              }}
            >
              Pipeline Steps ({run.steps.length} / {run.pipeline.length} agents)
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {run.steps.map(step => (
                <AgentStep key={step.agentKey} step={step} />
              ))}
            </div>
          </div>
        </div>

        <div className="ct-drawer-footer">
          <span style={{ fontSize: 12, color: 'var(--ct-text-muted)' }}>
            Total: {formatDuration(run.totalDurationMs)} &middot; {run.totalTokens.toLocaleString()} tokens
          </span>
          <div style={{ flex: 1 }} />
          <button className="ct-btn ct-btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </>
  )
}

// ── Pipeline Runs view ────────────────────────────────────────

export function PipelineRuns() {
  const [selectedRun, setSelectedRun] = useState<PipelineRun | null>(null)
  const [filterEvent, setFilterEvent] = useState<EventType | 'all'>('all')
  const [filterStatus, setFilterStatus] = useState<RunStatus | 'all'>('all')

  const filtered = MOCK_RUNS.filter(r => {
    if (filterEvent !== 'all' && r.eventType !== filterEvent) return false
    if (filterStatus !== 'all' && r.status !== filterStatus) return false
    return true
  }).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

  return (
    <>
      <div className="ct-page-header">
        <h2>Pipeline Runs</h2>
        <p>Audit log of every governance pipeline execution triggered by Worxstream events.</p>
      </div>

      <div className="ct-page-body">
        {/* Filters */}
        <div className="ct-filters">
          <select
            className="ct-select"
            value={filterEvent}
            onChange={e => setFilterEvent(e.target.value as EventType | 'all')}
          >
            <option value="all">All event types</option>
            {ALL_EVENT_TYPES.map(et => (
              <option key={et} value={et}>
                {EVENT_TYPE_LABELS[et]}
              </option>
            ))}
          </select>

          <select
            className="ct-select"
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value as RunStatus | 'all')}
          >
            <option value="all">All statuses</option>
            <option value="pass">Pass</option>
            <option value="flagged">Flagged</option>
            <option value="error">Error</option>
          </select>

          <div className="ct-filters-spacer" />
          <span style={{ fontSize: 12, color: 'var(--ct-text-muted)' }}>
            {filtered.length} run{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Table */}
        <div className="ct-section">
          <div className="ct-table-wrap">
            <table className="ct-table">
              <thead>
                <tr>
                  <th>Run ID</th>
                  <th>Event Type</th>
                  <th>Entity</th>
                  <th>Pipeline</th>
                  <th>Status</th>
                  <th>Duration</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="ct-empty">
                      No runs match the current filters.
                    </td>
                  </tr>
                ) : (
                  filtered.map(run => (
                    <tr
                      key={run.runId}
                      onClick={() => setSelectedRun(run)}
                      className={selectedRun?.runId === run.runId ? 'selected' : ''}
                    >
                      <td>
                        <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--ct-text-muted)' }}>
                          {run.runId}
                        </span>
                      </td>
                      <td>
                        <span className="ct-badge event">{run.eventType}</span>
                      </td>
                      <td className="primary">{run.entityLabel}</td>
                      <td style={{ color: 'var(--ct-text-muted)', fontSize: 12 }}>
                        {run.pipeline.join(' → ')}
                      </td>
                      <td>
                        <StatusBadge status={run.status} />
                      </td>
                      <td>{formatDuration(run.totalDurationMs)}</td>
                      <td>{formatTs(run.timestamp)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Detail drawer */}
      {selectedRun && (
        <RunDrawer run={selectedRun} onClose={() => setSelectedRun(null)} />
      )}
    </>
  )
}
