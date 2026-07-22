import { useMemo, useState } from 'react'
import { RotateCw } from 'lucide-react'

import { AsyncState } from '../../components/AsyncState'
import { GlassPanel } from '../../components/GlassPanel'
import { PageHeader } from '../../components/PageHeader'
import { StatusBadge } from '../../components/StatusBadge'
import { VirtualEventList } from '../../components/VirtualEventList'
import { useDevices } from '../../api/queries'
import { useEventStore } from '../../stores/eventStore'
import { eventTypes, type EventType } from '../../types/events'
import { humanize } from '../../utils/format'

export function TransactionsPage() {
  const [eventType, setEventType] = useState<EventType | 'all'>('all')
  const [deviceId, setDeviceId] = useState('all')
  const devices = useDevices()
  const events = useEventStore((state) => state.events)
  const connectionStatus = useEventStore((state) => state.connectionStatus)
  const reconnectAttempt = useEventStore((state) => state.reconnectAttempt)
  const lastEventId = useEventStore((state) => state.lastEventId)
  const filteredEvents = useMemo(
    () =>
      events.filter(
        (event) =>
          (eventType === 'all' || event.event_type === eventType) &&
          (deviceId === 'all' || event.device_id === deviceId),
      ),
    [deviceId, eventType, events],
  )

  return (
    <div className="page-stack transactions-page">
      <PageHeader
        eyebrow="Live observability"
        title="Transactions & events"
        description="A replay-aware timeline from the domain event bus. Select any row to inspect its typed payload."
        action={<div className="stream-summary"><StatusBadge status={connectionStatus} /><span>after_event_id: {lastEventId}</span></div>}
      />
      <GlassPanel className="timeline-panel">
        <div className="filter-bar">
          <label><span>Event type</span><select value={eventType} onChange={(event) => setEventType(event.target.value as EventType | 'all')}>
            <option value="all">All event types</option>
            {eventTypes.map((type) => <option key={type} value={type}>{humanize(type)}</option>)}
          </select></label>
          <label><span>Device</span><select value={deviceId} onChange={(event) => setDeviceId(event.target.value)}>
            <option value="all">All devices</option>
            {devices.data?.map((device) => <option key={device.id} value={device.id}>{device.id}</option>)}
          </select></label>
          <div className="replay-indicator"><RotateCw className={connectionStatus === 'reconnecting' ? 'spin' : ''} size={16} /><div><strong>{connectionStatus === 'reconnecting' ? `Reconnect attempt ${reconnectAttempt}` : 'Replay cursor ready'}</strong><span>Next connection resumes after #{lastEventId}</span></div></div>
        </div>
        {connectionStatus === 'disconnected' && events.length === 0 && <AsyncState detail="Reconnect will resume from the last in-memory event ID." kind="disconnected" title="Live event stream disconnected" />}
        {connectionStatus !== 'disconnected' && filteredEvents.length === 0 && <AsyncState kind="empty" title="No events match these filters" />}
        {filteredEvents.length > 0 && <VirtualEventList events={filteredEvents} />}
      </GlassPanel>
    </div>
  )
}
