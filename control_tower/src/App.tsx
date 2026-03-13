import { Routes, Route, Navigate } from 'react-router-dom'
import { ControlTowerPage } from './components/ControlTowerPage'
import { ControlTowerDashboard } from './components/ControlTowerDashboard'
import { PipelineRuns } from './components/PipelineRuns'
import { AlertsView } from './components/AlertsView'
import { PoliciesView } from './components/PoliciesView'
import { RulesView } from './components/RulesView'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<ControlTowerPage />}>
        <Route index element={<ControlTowerDashboard />} />
        <Route path="runs" element={<PipelineRuns />} />
        <Route path="alerts" element={<AlertsView />} />
        <Route path="policies" element={<PoliciesView />} />
        <Route path="rules" element={<RulesView />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
