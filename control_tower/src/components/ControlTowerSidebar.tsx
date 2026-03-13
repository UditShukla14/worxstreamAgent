import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  GitBranch,
  BellDot,
  FileText,
  ListChecks,
  Shield,
} from 'lucide-react'
import { MOCK_ALERTS } from '../mock/controlTowerMockData'

const openAlerts = MOCK_ALERTS.filter(a => a.status === 'open').length

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/runs', label: 'Pipeline Runs', icon: GitBranch },
  { to: '/alerts', label: 'Alerts', icon: BellDot, badge: openAlerts > 0 ? openAlerts : undefined },
  { to: '/policies', label: 'Policies', icon: FileText },
  { to: '/rules', label: 'Rules', icon: ListChecks },
]

export function ControlTowerSidebar() {
  return (
    <aside className="ct-sidebar">
      {/* Logo */}
      <div className="ct-sidebar-logo">
        <div className="ct-sidebar-logo-row">
          <div className="ct-sidebar-logo-icon">
            <Shield size={16} />
          </div>
          <div className="ct-sidebar-logo-text">
            <h1>Control Tower</h1>
            <span>Governance</span>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="ct-sidebar-nav">
        {NAV_ITEMS.map(({ to, label, icon: Icon, end, badge }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => `ct-nav-item${isActive ? ' active' : ''}`}
          >
            <Icon size={16} />
            {label}
            {badge !== undefined && (
              <span className="ct-nav-badge">{badge}</span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="ct-sidebar-footer">
        <div>Mock data mode</div>
        <div style={{ marginTop: 2, fontSize: 10 }}>Ready for API connection</div>
      </div>
    </aside>
  )
}
