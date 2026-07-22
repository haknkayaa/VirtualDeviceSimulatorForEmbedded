import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import { AsyncState } from './components/AsyncState'
import { AppShell } from './layouts/AppShell'

const DashboardPage = lazy(() => import('./features/dashboard/DashboardPage').then((module) => ({ default: module.DashboardPage })))
const DevicesPage = lazy(() => import('./features/devices/DevicesPage').then((module) => ({ default: module.DevicesPage })))
const TransactionsPage = lazy(() => import('./features/transactions/TransactionsPage').then((module) => ({ default: module.TransactionsPage })))
const ScenariosPage = lazy(() => import('./features/scenarios/ScenariosPage').then((module) => ({ default: module.ScenariosPage })))
const FlowsPage = lazy(() => import('./features/flows/routes/FlowsPage').then((module) => ({ default: module.FlowsPage })))
const FlowEditorPage = lazy(() => import('./features/flows/routes/FlowEditorPage').then((module) => ({ default: module.FlowEditorPage })))

export function App() {
  return (
    <Suspense fallback={<div className="route-loading"><AsyncState kind="loading" title="Loading workspace" /></div>}>
      <Routes>
        <Route element={<AppShell />}>
          <Route element={<DashboardPage />} index />
          <Route element={<DevicesPage />} path="devices" />
          <Route element={<DevicesPage />} path="devices/:deviceId" />
          <Route element={<TransactionsPage />} path="transactions" />
          <Route element={<ScenariosPage />} path="scenarios" />
          <Route element={<FlowsPage />} path="flows" />
          <Route element={<FlowEditorPage />} path="flows/new" />
          <Route element={<FlowEditorPage />} path="flows/:flowId" />
          <Route element={<Navigate replace to="/" />} path="*" />
        </Route>
      </Routes>
    </Suspense>
  )
}
