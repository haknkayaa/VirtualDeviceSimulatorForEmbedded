import { useMemo } from 'react'
import { Activity, Boxes, Cpu, PlayCircle, ShieldAlert } from 'lucide-react'

import { useDevices, useFaults, useHealth, useRun } from '../../api/queries'
import { AsyncState } from '../../components/AsyncState'
import { GlassPanel } from '../../components/GlassPanel'
import { MetricCard } from '../../components/MetricCard'
import { PageHeader } from '../../components/PageHeader'
import { StatusBadge } from '../../components/StatusBadge'
import { useEventStore } from '../../stores/eventStore'
import { useRunStore } from '../../stores/runStore'
import { humanize } from '../../utils/format'
import { DashboardHealthPanels } from './DashboardHealthPanels'
import { LiveEventStream } from './LiveEventStream'

export function DashboardPage() {
  const health = useHealth()
  const devices = useDevices()
  const faults = useFaults()
  const activeRunId = useRunStore((state) => state.activeRunId)
  const activeRun = useRun(activeRunId)
  const connectionStatus = useEventStore((state) => state.connectionStatus)
  const events = useEventStore((state) => state.events)
  const recentEvents = useMemo(
    () => events.slice(-12).reverse(),
    [events],
  )
  const enabledFaults = faults.data?.filter((fault) => fault.enabled).length ?? 0

  return (
    <div className="page-stack dashboard-page">
      <PageHeader
        eyebrow="Control plane / Overview"
        title="System overview"
        description="Authoritative snapshots from REST, live operational context from the domain event stream."
        action={<div className="header-status"><span>Event stream</span><StatusBadge status={connectionStatus} /></div>}
      />
      <div className="metric-grid">
        <MetricCard
          accent="cyan"
          detail={activeRun.data?.scenario_id ?? (activeRun.isError ? 'Status unavailable' : 'Orchestration')}
          icon={PlayCircle}
          label="Scenario run"
          value={activeRun.data?.status ?? (activeRunId ? 'checking' : 'idle')}
        />
        <MetricCard accent="violet" detail="Loaded runtime models" icon={Boxes} label="Active devices" value={devices.data?.length ?? '—'} />
        <MetricCard accent="amber" detail={`${enabledFaults} enabled`} icon={ShieldAlert} label="Fault profiles" value={faults.data?.length ?? '—'} />
        <MetricCard detail="Current session" icon={Activity} label="Domain events" value={events.length} />
      </div>
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
        <DashboardHealthPanels
          healthStatus={health.data?.status}
          systemMetrics={health.data?.system}
        />
      </div>
      <div className="dashboard-grid">
        <GlassPanel className="dashboard-transactions" eyebrow="Domain telemetry" title="Live Event Stream">
          {connectionStatus === 'disconnected' && recentEvents.length === 0 && (
            <AsyncState detail="The UI will resume from its last event ID." kind="disconnected" title="Event stream disconnected" />
          )}
          {connectionStatus !== 'disconnected' && recentEvents.length === 0 && (
            <AsyncState kind="empty" title="Waiting for domain events" />
          )}
          {recentEvents.length > 0 && <LiveEventStream events={recentEvents} />}
        </GlassPanel>
      </div>
    </div>
  )
}
