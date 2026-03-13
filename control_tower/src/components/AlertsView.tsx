import { useState } from 'react'
import { X, CheckCircle, AlertTriangle, AlertCircle, Info } from 'lucide-react'
import {
  MOCK_ALERTS,
  EVENT_TYPE_LABELS,
  formatTs,
  type Alert,
  type AlertSeverity,
  type AlertStatus,
} from '../mock/controlTowerMockData'

// ── Severity icon ─────────────────────────────────────────────

function SeverityIcon({ severity }: { severity: AlertSeverity }) {
  if (severity === 'critical') return <AlertCircle size={14} />
  if (severity === 'warning') return <AlertTriangle size={14} />
  return <Info size={14} />
}

// ── Alert Detail Drawer ───────────────────────────────────────

function AlertDrawer({
  alert,
  onClose,
  onResolve,
}: {
  alert: Alert
  onClose: () => void
  onResolve: (id: string) => void
}) {
  return (
    <>
      <div className="ct-drawer-overlay" onClick={onClose} />
      <div className="ct-drawer">
        <div className="ct-drawer-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span className={`ct-badge ${alert.severity}`}>
                <SeverityIcon severity={alert.severity} />
                {alert.severity.charAt(0).toUpperCase() + alert.severity.slice(1)}
              </span>
              <span className={`ct-badge ${alert.status}`}>
                {alert.status.charAt(0).toUpperCase() + alert.status.slice(1)}
              </span>
            </div>
            <h3>{alert.message}</h3>
            <p>
              {EVENT_TYPE_LABELS[alert.eventType]} &middot; {formatTs(alert.timestamp)}
            </p>
          </div>
          <button className="ct-drawer-close" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <div className="ct-drawer-body">
          {/* Detail */}
          <div className="ct-detail-block">
            <div className="ct-detail-block-label">Alert Detail</div>
            <div className="ct-detail-block-content">{alert.detail}</div>
          </div>

          {/* Info grid */}
          <div className="ct-info-grid">
            <div className="ct-info-cell">
              <div className="ct-info-label">Triggered By</div>
              <div className="ct-info-value">{alert.triggeredBy}</div>
            </div>
            <div className="ct-info-cell">
              <div className="ct-info-label">Related Entity</div>
              <div className="ct-info-value">{alert.relatedEntity}</div>
            </div>
            <div className="ct-info-cell">
              <div className="ct-info-label">Policy Violated</div>
              <div className="ct-info-value">{alert.policyViolated}</div>
            </div>
            <div className="ct-info-cell">
              <div className="ct-info-label">Event Type</div>
              <div className="ct-info-value">
                <span className="ct-badge event">{alert.eventType}</span>
              </div>
            </div>
          </div>

          {/* Agent response */}
          <div className="ct-detail-block">
            <div className="ct-detail-block-label">Agent Response Excerpt</div>
            <div className="ct-detail-block-content mono">{alert.agentResponseExcerpt}</div>
          </div>

          {/* Suggested action */}
          <div className="ct-detail-block">
            <div className="ct-detail-block-label">Suggested Action</div>
            <div className="ct-detail-block-content">{alert.suggestedAction}</div>
          </div>
        </div>

        <div className="ct-drawer-footer">
          <span style={{ fontSize: 12, color: 'var(--ct-text-muted)' }}>
            Alert ID: {alert.alertId}
          </span>
          <div style={{ flex: 1 }} />
          <button className="ct-btn ct-btn-ghost" onClick={onClose}>
            Close
          </button>
          {alert.status === 'open' && (
            <button
              className="ct-btn ct-btn-success"
              onClick={() => {
                onResolve(alert.alertId)
                onClose()
              }}
            >
              <CheckCircle size={14} />
              Mark Resolved
            </button>
          )}
        </div>
      </div>
    </>
  )
}

// ── Alerts View ───────────────────────────────────────────────

export function AlertsView() {
  const [alerts, setAlerts] = useState(MOCK_ALERTS)
  const [selected, setSelected] = useState<Alert | null>(null)
  const [filterSeverity, setFilterSeverity] = useState<AlertSeverity | 'all'>('all')
  const [filterStatus, setFilterStatus] = useState<AlertStatus | 'all'>('all')

  function handleResolve(alertId: string) {
    setAlerts(prev =>
      prev.map(a => (a.alertId === alertId ? { ...a, status: 'resolved' as AlertStatus } : a))
    )
  }

  const filtered = alerts
    .filter(a => {
      if (filterSeverity !== 'all' && a.severity !== filterSeverity) return false
      if (filterStatus !== 'all' && a.status !== filterStatus) return false
      return true
    })
    .sort((a, b) => {
      // open before resolved, then by timestamp
      if (a.status !== b.status) return a.status === 'open' ? -1 : 1
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    })

  const openCount = alerts.filter(a => a.status === 'open').length

  return (
    <>
      <div className="ct-page-header">
        <h2>Alerts</h2>
        <p>
          {openCount} open alert{openCount !== 1 ? 's' : ''} requiring attention.
        </p>
      </div>

      <div className="ct-page-body">
        {/* Filters */}
        <div className="ct-filters">
          <select
            className="ct-select"
            value={filterSeverity}
            onChange={e => setFilterSeverity(e.target.value as AlertSeverity | 'all')}
          >
            <option value="all">All severities</option>
            <option value="critical">Critical</option>
            <option value="warning">Warning</option>
            <option value="info">Info</option>
          </select>

          <select
            className="ct-select"
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value as AlertStatus | 'all')}
          >
            <option value="all">All statuses</option>
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
          </select>

          <div className="ct-filters-spacer" />
          <span style={{ fontSize: 12, color: 'var(--ct-text-muted)' }}>
            {filtered.length} alert{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Table */}
        <div className="ct-section">
          <div className="ct-table-wrap">
            <table className="ct-table">
              <thead>
                <tr>
                  <th>Severity</th>
                  <th>Message</th>
                  <th>Triggered By</th>
                  <th>Entity</th>
                  <th>Event</th>
                  <th>Status</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="ct-empty">
                      No alerts match the current filters.
                    </td>
                  </tr>
                ) : (
                  filtered.map(alert => (
                    <tr
                      key={alert.alertId}
                      onClick={() => setSelected(alert)}
                      className={selected?.alertId === alert.alertId ? 'selected' : ''}
                    >
                      <td>
                        <span className={`ct-badge ${alert.severity}`}>
                          <SeverityIcon severity={alert.severity} />
                          {alert.severity.charAt(0).toUpperCase() + alert.severity.slice(1)}
                        </span>
                      </td>
                      <td className="primary" style={{ maxWidth: 280 }}>
                        <span
                          style={{
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                          }}
                        >
                          {alert.message}
                        </span>
                      </td>
                      <td style={{ fontSize: 12 }}>{alert.triggeredBy}</td>
                      <td style={{ fontSize: 12 }}>{alert.relatedEntity}</td>
                      <td>
                        <span className="ct-badge event">{alert.eventType}</span>
                      </td>
                      <td>
                        <span className={`ct-badge ${alert.status}`}>
                          {alert.status.charAt(0).toUpperCase() + alert.status.slice(1)}
                        </span>
                      </td>
                      <td>{formatTs(alert.timestamp)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {selected && (
        <AlertDrawer
          alert={selected}
          onClose={() => setSelected(null)}
          onResolve={handleResolve}
        />
      )}
    </>
  )
}
