import { useMemo, useState } from 'react'
import { Activity, Boxes, Cable, Cpu, ShieldAlert } from 'lucide-react'

import { useAdapters, useDevices, useFaults, useHealth } from '../../api/queries'
import { AsyncState } from '../../components/AsyncState'
import { GlassPanel } from '../../components/GlassPanel'
import { MetricCard } from '../../components/MetricCard'
import { PageHeader } from '../../components/PageHeader'
import { StatusBadge } from '../../components/StatusBadge'
import { useEventStore } from '../../stores/eventStore'
import { attachedDevices } from '../../utils/adapterBindings'
import { humanize } from '../../utils/format'
import { DashboardHealthPanels } from './DashboardHealthPanels'
import { type EventSeverity, getEventSeverity } from './eventSeverity'
import { LiveEventStream } from './LiveEventStream'

export function DashboardPage() {
  const health = useHealth()
  const adapters = useAdapters()
  const devices = useDevices()
  const faults = useFaults()
  const [eventSeverity, setEventSeverity] = useState<EventSeverity | 'all'>('all')
  const [eventSource, setEventSource] = useState('all')
  const [eventType, setEventType] = useState('all')
  const connectionStatus = useEventStore((state) => state.connectionStatus)
  const events = useEventStore((state) => state.events)
  const eventSources = useMemo(
    () => [...new Set(events.map((event) => event.device_id ?? event.scenario_run_id ?? 'system'))].sort(),
    [events],
  )
  const eventTypes = useMemo(
    () => [...new Set(events.map((event) => event.event_type))].sort(),
    [events],
  )
  const visibleEvents = useMemo(
    () => events
      .filter((event) => eventSeverity === 'all' || getEventSeverity(event) === eventSeverity)
      .filter((event) => eventSource === 'all' || (event.device_id ?? event.scenario_run_id ?? 'system') === eventSource)
      .filter((event) => eventType === 'all' || event.event_type === eventType)
      .slice(-12)
      .reverse(),
    [eventSeverity, eventSource, eventType, events],
  )
  const visibleDevices = useMemo(
    () => attachedDevices(devices.data, adapters.data),
    [adapters.data, devices.data],
  )
  const deviceInventoryPending = devices.isPending || adapters.isPending
  const enabledFaults = faults.data?.filter((fault) => fault.enabled).length ?? 0
  const loadedAdapters = adapters.data?.filter((adapter) => adapter.state === 'loaded').length ?? 0

  return (
    <div className="page-stack dashboard-page">
      <PageHeader
        eyebrow="Control Panel / Overview"
        title="System overview"
        description="Authoritative snapshots from REST, live operational context from the domain event stream."
        action={<div className="header-status"><span>Event stream</span><StatusBadge status={connectionStatus} /></div>}
      />
      <div className="metric-grid">
        <MetricCard
          accent="cyan"
          detail={adapters.isPending ? 'Loading topology' : `${adapters.data?.length ?? 0} configured`}
          icon={Cable}
          label="Loaded adapters"
          value={adapters.isPending ? '—' : loadedAdapters}
        />
        <MetricCard accent="violet" detail="Attached runtime models" icon={Boxes} label="Attached devices" value={deviceInventoryPending ? '—' : visibleDevices.length} />
        <MetricCard accent="amber" detail={`${enabledFaults} enabled`} icon={ShieldAlert} label="Fault profiles" value={faults.data?.length ?? '—'} />
        <MetricCard detail="Current session" icon={Activity} label="Domain events" value={events.length} />
      </div>
      <div className="dashboard-command-grid">
        <div className="runtime-snapshot-grid">
          <GlassPanel
            action={<span className="panel-count">{adapters.data?.length ?? 0} total</span>}
            className="runtime-resource-card"
            eyebrow="Runtime snapshot"
            title="Adapters"
          >
            {adapters.isPending && <AsyncState kind="loading" title="Loading adapters" />}
            {adapters.isError && <AsyncState detail={adapters.error.message} kind="error" title="Adapter snapshot unavailable" />}
            {adapters.data?.length === 0 && <AsyncState kind="empty" title="No adapters configured" />}
            <div className="runtime-resource-list">
              {adapters.data?.map((adapter) => (
                <article className="runtime-resource-row" key={adapter.id}>
                  <div className="runtime-resource-icon"><Cable aria-hidden="true" size={16} /></div>
                  <div>
                    <strong>{adapter.name}</strong>
                    <span>{adapter.id} · {humanize(adapter.bus_type)} {adapter.bus_number}</span>
                  </div>
                  <StatusBadge status={adapter.state} />
                </article>
              ))}
            </div>
          </GlassPanel>
          <GlassPanel
            action={<span className="panel-count">{visibleDevices.length} attached</span>}
            className="runtime-resource-card"
            eyebrow="Runtime snapshot"
            title="Devices"
          >
            {deviceInventoryPending && <AsyncState kind="loading" title="Loading devices" />}
            {devices.isError && <AsyncState detail={devices.error.message} kind="error" title="Device snapshot unavailable" />}
            {!deviceInventoryPending && visibleDevices.length === 0 && <AsyncState kind="empty" title="No devices attached" />}
            <div className="runtime-resource-list">
              {visibleDevices.map((device) => (
                <article className="runtime-resource-row" key={device.id}>
                  <div className="runtime-resource-icon"><Cpu aria-hidden="true" size={16} /></div>
                  <div><strong>{device.id}</strong><span>{humanize(device.bus)} bus</span></div>
                  <StatusBadge status={device.state} />
                </article>
              ))}
            </div>
          </GlassPanel>
        </div>
        <DashboardHealthPanels
          adapters={adapters.data}
          healthStatus={health.data?.status}
          systemMetrics={health.data?.system}
        />
      </div>
      <div className="dashboard-grid">
        <GlassPanel
          action={(
            <div className="dashboard-event-filters">
              <select aria-label="Filter events by severity" onChange={(event) => setEventSeverity(event.target.value as EventSeverity | 'all')} value={eventSeverity}>
                <option value="all">All levels</option>
                <option value="info">Info</option>
                <option value="warn">Warning</option>
                <option value="error">Error</option>
              </select>
              <select aria-label="Filter events by source" onChange={(event) => setEventSource(event.target.value)} value={eventSource}>
                <option value="all">All sources</option>
                {eventSources.map((source) => <option key={source} value={source}>{source}</option>)}
              </select>
              <select aria-label="Filter events by type" onChange={(event) => setEventType(event.target.value)} value={eventType}>
                <option value="all">All event types</option>
                {eventTypes.map((type) => <option key={type} value={type}>{humanize(type)}</option>)}
              </select>
            </div>
          )}
          className="dashboard-transactions"
          eyebrow="Domain telemetry"
          title="Live Event Stream"
        >
          {connectionStatus === 'disconnected' && events.length === 0 && (
            <AsyncState detail="The UI will resume from its last event ID." kind="disconnected" title="Event stream disconnected" />
          )}
          {connectionStatus !== 'disconnected' && events.length === 0 && (
            <AsyncState kind="empty" title="Waiting for domain events" />
          )}
          {events.length > 0 && visibleEvents.length === 0 && (
            <AsyncState kind="empty" title="No events match the selected filters" />
          )}
          {visibleEvents.length > 0 && <LiveEventStream events={visibleEvents} />}
        </GlassPanel>
      </div>
    </div>
  )
}
