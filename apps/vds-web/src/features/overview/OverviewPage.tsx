import { Activity, ArrowRight, AudioWaveform, Plus, ScrollText } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { AsyncState } from '../../components/AsyncState'
import { EventTail } from '../../components/EventTail'
import { PageHeader } from '../../components/PageHeader'
import { Panel } from '../../components/Panel'
import { useEventStore } from '../../stores/eventStore'
import { getEventSeverity } from '../../utils/events'
import { BusActivityPanel } from './BusActivityPanel'
import { DeviceNodesPanel } from './DeviceNodesPanel'
import { ProblemsPanel } from './ProblemsPanel'
import { HostPanel, ScenarioRunPanel, SignalActivityPanel } from './SidePanels'
import './overview.css'

const TAIL_LENGTH = 60

function RecentEventsPanel() {
  const events = useEventStore((state) => state.events)
  const connectionStatus = useEventStore((state) => state.connectionStatus)
  const [problemsOnly, setProblemsOnly] = useState(false)
  const visible = useMemo(() => {
    const result = []
    for (let index = events.length - 1; index >= 0 && result.length < TAIL_LENGTH; index -= 1) {
      const event = events[index]
      if (!problemsOnly || getEventSeverity(event) !== 'info') result.push(event)
    }
    return result
  }, [events, problemsOnly])
  return (
    <Panel
      actions={(
        <>
          <div className="segmented" role="group" aria-label="Event severity filter">
            <button aria-pressed={!problemsOnly} onClick={() => setProblemsOnly(false)} type="button">All</button>
            <button aria-pressed={problemsOnly} onClick={() => setProblemsOnly(true)} type="button">Warn + error</button>
          </div>
          <Link className="button button-ghost button-sm" to="/logs">Event log <ArrowRight aria-hidden="true" size={12} /></Link>
        </>
      )}
      className="overview-events"
      flush
      icon={ScrollText}
      meta={`${events.length} retained`}
      title="Recent events"
    >
      {connectionStatus === 'disconnected' && events.length === 0 && (
        <AsyncState detail="The UI resumes from its last event id when the stream returns." kind="disconnected" title="Event stream disconnected" />
      )}
      {connectionStatus !== 'disconnected' && events.length === 0 && <AsyncState kind="empty" title="Waiting for domain events" />}
      {events.length > 0 && visible.length === 0 && <AsyncState kind="empty" title="No warnings or errors in the retained events" />}
      {visible.length > 0 && <EventTail events={visible} />}
    </Panel>
  )
}

/**
 * Workbench overview: is the simulator up, which /dev nodes can my
 * application open, what is broken, and what just happened on the buses.
 */
export function OverviewPage() {
  return (
    <div className="page overview-page">
      <PageHeader
        actions={(
          <>
            <Link className="button button-ghost" to="/adapters?new=1"><Plus aria-hidden="true" size={13} /> Adapter</Link>
            <Link className="button button-ghost" to="/devices?add=1"><Plus aria-hidden="true" size={13} /> Device</Link>
            <span className="toolbar-separator" />
            <Link className="button" to="/transactions"><Activity aria-hidden="true" size={13} /> Transactions</Link>
            <Link className="button" to="/waveform"><AudioWaveform aria-hidden="true" size={13} /> Logic Analyzer</Link>
          </>
        )}
        context="Local simulator workspace"
        title="Overview"
      />
      <div className="page-body overview-grid">
        <div className="overview-main">
          <DeviceNodesPanel />
          <BusActivityPanel />
          <RecentEventsPanel />
        </div>
        <div className="overview-side">
          <ProblemsPanel />
          <ScenarioRunPanel />
          <SignalActivityPanel />
          <HostPanel />
        </div>
      </div>
    </div>
  )
}
