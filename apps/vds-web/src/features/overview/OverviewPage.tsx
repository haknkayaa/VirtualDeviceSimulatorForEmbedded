import { Activity, AudioWaveform, Plus } from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router-dom'

import { useAdapters, useDevices } from '../../api/queries'
import { PageHeader } from '../../components/PageHeader'
import { useEventStore } from '../../stores/eventStore'
import { buildLiveTransactions } from '../transactions/transactionModel'
import { BringUpPanel } from './BringUpPanel'
import { BusLanesPanel } from './BusLanesPanel'
import { DeviceNodesPanel } from './DeviceNodesPanel'
import { buildBringUp } from './overviewModel'
import { AttentionPanel, ScenarioRunPanel } from './SidePanels'
import './overview.css'

/**
 * Workbench overview. Answers, in order: can my application open its device
 * nodes (and if not, the one fix), which node maps to which virtual device,
 * what needs attention, and is traffic flowing on each bus.
 */
export function OverviewPage() {
  const adapters = useAdapters()
  const devices = useDevices()
  const events = useEventStore((state) => state.events)
  const transactions = useMemo(() => buildLiveTransactions(events, devices.data ?? []), [devices.data, events])
  const bringUp = useMemo(() => buildBringUp(adapters.data, transactions), [adapters.data, transactions])

  return (
    <div className="page overview-page">
      <PageHeader
        actions={(
          <>
            <Link className="button button-ghost" to="/adapters?new=1"><Plus aria-hidden="true" size={14} /> Adapter</Link>
            <Link className="button button-ghost" to="/devices?add=1"><Plus aria-hidden="true" size={14} /> Device</Link>
            <span className="toolbar-separator" />
            <Link className="button" to="/transactions"><Activity aria-hidden="true" size={14} /> Transactions</Link>
            <Link className="button" to="/waveform"><AudioWaveform aria-hidden="true" size={14} /> Logic Analyzer</Link>
          </>
        )}
        title="Overview"
      />
      <div className="page-body overview-body">
        {adapters.data && <BringUpPanel state={bringUp} />}
        <div className="overview-columns">
          <DeviceNodesPanel />
          <div className="overview-side">
            <AttentionPanel />
            <ScenarioRunPanel />
          </div>
        </div>
        <BusLanesPanel adapters={adapters.data} transactions={transactions} />
      </div>
    </div>
  )
}
