import { Outlet } from 'react-router-dom'
import { ControlTowerSidebar } from './ControlTowerSidebar'

export function ControlTowerPage() {
  return (
    <div className="ct-root">
      <ControlTowerSidebar />
      <main className="ct-content">
        <Outlet />
      </main>
    </div>
  )
}
