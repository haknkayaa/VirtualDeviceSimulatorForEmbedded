import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import { AsyncState } from './components/AsyncState'
import { AppShell } from './layouts/AppShell'

const DashboardPage = lazy(() => import('./features/dashboard/DashboardPage').then((module) => ({ default: module.DashboardPage })))
const DevicesPage = lazy(() => import('./features/devices/DevicesPage').then((module) => ({ default: module.DevicesPage })))
const AdaptersPage = lazy(() => import('./features/adapters/AdaptersPage').then((module) => ({ default: module.AdaptersPage })))
const TransactionsPage = lazy(() => import('./features/transactions/TransactionsPage').then((module) => ({ default: module.TransactionsPage })))
const DeviceLibraryPage = lazy(() => import('./features/device-library/DeviceLibraryPage').then((module) => ({ default: module.DeviceLibraryPage })))
const LogsPage = lazy(() => import('./features/logs/LogsPage').then((module) => ({ default: module.LogsPage })))
const ScenarioFlowEditorPage = lazy(() => import('./features/devices/scenario-flows/routes/ScenarioFlowEditorPage').then((module) => ({ default: module.ScenarioFlowEditorPage })))
const DeviceBehaviorEditorPage = lazy(() => import('./features/devices/behavior/routes/DeviceBehaviorEditorPage').then((module) => ({ default: module.DeviceBehaviorEditorPage })))

export function App() {
  return (
    <Suspense fallback={<div className="route-loading"><AsyncState kind="loading" title="Loading workspace" /></div>}>
      <Routes>
        <Route element={<AppShell />}>
          <Route element={<DashboardPage />} index />
          <Route element={<DevicesPage />} path="devices" />
          <Route element={<DevicesPage />} path="devices/:deviceId" />
          <Route element={<DevicesPage />} path="devices/:deviceId/flows" />
          <Route element={<DevicesPage />} path="devices/:deviceId/scenarios" />
          <Route element={<ScenarioFlowEditorPage />} path="devices/:deviceId/scenarios/new" />
          <Route element={<ScenarioFlowEditorPage />} path="devices/:deviceId/scenarios/:flowId" />
          <Route element={<DeviceBehaviorEditorPage />} path="devices/:deviceId/flows/new" />
          <Route element={<DeviceBehaviorEditorPage />} path="devices/:deviceId/flows/:flowId" />
          <Route element={<AdaptersPage />} path="adapters" />
          <Route element={<TransactionsPage />} path="transactions" />
          <Route element={<DeviceLibraryPage />} path="device-library" />
          <Route element={<LogsPage />} path="logs" />
          <Route element={<Navigate replace to="/" />} path="*" />
        </Route>
      </Routes>
    </Suspense>
  )
}
