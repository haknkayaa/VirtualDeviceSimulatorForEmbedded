import { useMemo } from 'react'
import { Activity, Boxes, Cpu, Radio, ShieldAlert } from 'lucide-react'

import { useDevices, useFaults, useHealth, useRun } from '../../api/queries'
import { AsyncState } from '../../components/AsyncState'
import { BrandLogo } from '../../components/BrandLogo'
import { GlassPanel } from '../../components/GlassPanel'
import { MetricCard } from '../../components/MetricCard'
import { PageHeader } from '../../components/PageHeader'
import { StatusBadge } from '../../components/StatusBadge'
import { VirtualEventList } from '../../components/VirtualEventList'
import { useEventStore } from '../../stores/eventStore'
import { useRunStore } from '../../stores/runStore'
import { humanize } from '../../utils/format'

export function DashboardPage() {
  const health = useHealth()
  const devices = useDevices()
  const faults = useFaults()
  const activeRunId = useRunStore((state) => state.activeRunId)
  const activeRun = useRun(activeRunId)
  const connectionStatus = useEventStore((state) => state.connectionStatus)
  const events = useEventStore((state) => state.events)
  const recentTransactions = useMemo(
    () => events.filter((event) => event.event_type === 'transaction_completed').slice(-8),
    [events],
  )
  const enabledFaults = faults.data?.filter((fault) => fault.enabled).length ?? 0

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Control plane / Overview"
        title="System overview"
        description="Authoritative snapshots from REST, live operational context from the domain event stream."
        action={<div className="header-status"><span>Event stream</span><StatusBadge status={connectionStatus} /></div>}
      />
      <div className="dashboard-command-grid">
        <GlassPanel className="runtime-map-panel" eyebrow="Runtime snapshot" title="Device map" action={<span className="panel-count">{devices.data?.length ?? 0} loaded</span>}>
          {devices.isPending && <AsyncState kind="loading" title="Loading devices" />}
          {devices.isError && <AsyncState detail={devices.error.message} kind="error" title="Device snapshot unavailable" />}
          {devices.data?.length === 0 && <AsyncState kind="empty" title="No devices loaded" />}
          <div className="runtime-device-grid">
            {devices.data?.map((device) => (
              <article className="runtime-device-card" key={device.id}>
                <div className="runtime-device-icon"><Cpu aria-hidden="true" size={18} /></div>
                <div><strong>{device.id}</strong><span>{humanize(device.bus)} bus</span></div>
                <StatusBadge status={device.state} />
              </article>
            ))}
          </div>
        </GlassPanel>
        <div className="dashboard-side-stack">
          <GlassPanel className="dashboard-run-panel" eyebrow="Orchestration" title="Running scenario">
            <BrandLogo className="panel-brand-watermark" decorative />
            {!activeRunId && <AsyncState detail="Start a scenario to track it here." kind="empty" title="No active run" />}
            {activeRun.isError && <AsyncState detail={activeRun.error.message} kind="error" title="Run status unavailable" />}
            {activeRun.data && (
              <div className="run-overview">
                <div><span>Run ID</span><strong>{activeRun.data.run_id}</strong></div>
                <div><span>Scenario</span><strong>{activeRun.data.scenario_id}</strong></div>
                <div><span>Status</span><StatusBadge status={activeRun.data.status} /></div>
              </div>
            )}
          </GlassPanel>
          <GlassPanel className="stream-health-panel" eyebrow="Live telemetry" title="Event stream" action={<StatusBadge status={connectionStatus} />}>
            <div className="stream-health-stats">
              <div><span>Retained events</span><strong>{events.length.toLocaleString()}</strong></div>
              <div><span>Transactions</span><strong>{recentTransactions.length}</strong></div>
              <div><span>Enabled faults</span><strong>{enabledFaults}</strong></div>
            </div>
          </GlassPanel>
        </div>
      </div>
      <div className="metric-grid">
        <MetricCard accent="cyan" detail={health.isError ? 'API unavailable' : 'Control API'} icon={Radio} label="Server health" value={health.data?.status ?? 'checking'} />
        <MetricCard accent="violet" detail="Loaded runtime models" icon={Boxes} label="Active devices" value={devices.data?.length ?? '—'} />
        <MetricCard accent="amber" detail={`${enabledFaults} enabled`} icon={ShieldAlert} label="Fault profiles" value={faults.data?.length ?? '—'} />
        <MetricCard detail="Current session" icon={Activity} label="Domain events" value={events.length} />
      </div>
      <div className="dashboard-grid">
        <GlassPanel className="dashboard-transactions" eyebrow="Data plane telemetry" title="Recent transactions">
          {connectionStatus === 'disconnected' && recentTransactions.length === 0 && (
            <AsyncState detail="The UI will resume from its last event ID." kind="disconnected" title="Event stream disconnected" />
          )}
          {connectionStatus !== 'disconnected' && recentTransactions.length === 0 && (
            <AsyncState kind="empty" title="Waiting for transaction events" />
          )}
          {recentTransactions.length > 0 && <VirtualEventList compact events={recentTransactions} />}
        </GlassPanel>
      </div>
    </div>
  )
}
