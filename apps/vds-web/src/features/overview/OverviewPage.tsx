import { Plus } from 'lucide-react'
import { Link } from 'react-router-dom'

import { SignalConnectionsPanel } from '../../components/SignalConnectionsPanel'
import { useSessionTransactions } from '../../hooks/useSessionTransactions'
import { AttentionPanel } from './AttentionPanel'
import { BusTimelinePanel } from './BusTimelinePanel'
import { LiveDevicePath } from './LiveDevicePath'
import { RecentTransactionsPanel } from './RecentTransactionsPanel'
import { RunScenarioMenu } from './RunScenarioMenu'
import { ScenarioRunPanel } from './ScenarioRunPanel'
import './overview.css'

/**
 * Workbench overview: the live path from the application under test through
 * the Linux device ABI to each virtual device, the running scenario, what
 * needs attention, and the newest bus traffic.
 */
export function OverviewPage() {
  const transactions = useSessionTransactions()
  return (
    <div className="page overview-page">
      <div className="page-body overview-body">
        <header className="overview-hero">
          <div>
            <h1>Overview</h1>
            <p>Local simulation · development workspace</p>
          </div>
          <div className="overview-hero-actions">
            <Link className="button button-lg" to="/adapters?new=1"><Plus aria-hidden="true" size={16} /> Adapter</Link>
            <Link className="button button-lg" to="/devices?add=1"><Plus aria-hidden="true" size={16} /> Device</Link>
            <RunScenarioMenu />
          </div>
        </header>
        <div className="overview-top">
          <LiveDevicePath transactions={transactions} />
          <div className="overview-side">
            <ScenarioRunPanel />
            <AttentionPanel transactions={transactions} />
          </div>
        </div>
        <div className="overview-bottom">
          <RecentTransactionsPanel transactions={transactions} />
          <BusTimelinePanel transactions={transactions} />
        </div>
        <SignalConnectionsPanel />
      </div>
    </div>
  )
}
