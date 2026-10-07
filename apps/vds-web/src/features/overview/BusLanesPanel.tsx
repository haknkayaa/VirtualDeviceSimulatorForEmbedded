import { ArrowRight, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { BusTag } from '../../components/BusTag'
import { Panel } from '../../components/Panel'
import type { Adapter } from '../../types/api'
import { formatWallTime } from '../../utils/events'
import type { LiveTransaction } from '../transactions/transactionModel'
import { buildBusLanes, laneLabel, transactionWireSummary } from './overviewModel'

interface BusLanesPanelProps {
  transactions: LiveTransaction[]
  adapters?: Adapter[]
}

function chipTitle(transaction: LiveTransaction) {
  const time = transaction.completedWallNs ?? transaction.startedWallNs
  const result = transaction.status === 'error' ? transaction.errorCode ?? 'error' : transaction.status
  return `${transaction.deviceId} · ${transactionWireSummary(transaction)} · ${result}${time ? ` · ${formatWallTime(time)}` : ''}`
}

/** A miniature logic-analyzer strip: one lane per bus, newest transaction on the right. */
export function BusLanesPanel({ transactions, adapters }: BusLanesPanelProps) {
  const [failuresOnly, setFailuresOnly] = useState(false)
  const visible = useMemo(
    () => transactions.filter((transaction) =>
      (transaction.busType.toLowerCase() !== 'gpio' || (transaction.gpioEdges?.length ?? 0) > 0) &&
      (!failuresOnly || transaction.status === 'error')),
    [failuresOnly, transactions],
  )
  const lanes = useMemo(() => buildBusLanes(visible, adapters), [adapters, visible])
  const failed = transactions.filter((transaction) => transaction.status === 'error').length

  return (
    <Panel
      actions={(
        <>
          <div aria-label="Lane filter" className="segmented" role="group">
            <button aria-pressed={!failuresOnly} onClick={() => setFailuresOnly(false)} type="button">All</button>
            <button aria-pressed={failuresOnly} onClick={() => setFailuresOnly(true)} type="button">Failures only{failed ? ` · ${failed}` : ''}</button>
          </div>
          <Link className="button button-ghost button-sm" to={failuresOnly ? '/transactions?result=failed' : '/transactions'}>
            Transactions <ArrowRight aria-hidden="true" size={13} />
          </Link>
        </>
      )}
      className="overview-lanes"
      flush
      meta={`${transactions.length} in session · newest right`}
      title="Bus activity"
    >
      <div className="lanes">
        {lanes.map((lane) => (
          <div className="lane" key={lane.bus}>
            <Link aria-label={`Open ${lane.bus.toUpperCase()} transactions`} className="lane-bus" to={`/transactions?bus=${lane.bus}`}>
              <BusTag bus={lane.bus} />
            </Link>
            <div className={`lane-track bus-${lane.bus}`}>
              {lane.transactions.length === 0
                ? <span className="lane-silent">{failuresOnly && !lane.silentReason ? 'No failures' : lane.silentReason ?? 'No failures'}</span>
                : lane.transactions.map((transaction) => (
                  <Link
                    className={`lane-chip${transaction.status === 'error' ? ' failed' : ''}`}
                    key={transaction.id}
                    title={chipTitle(transaction)}
                    to={`/transactions?transaction=${encodeURIComponent(transaction.id)}`}
                  >
                    {transaction.status === 'error' && <X aria-label="Failed" size={11} />}
                    {laneLabel(transaction)}
                  </Link>
                ))}
            </div>
            <span className="lane-count">
              {lane.total}{lane.failed ? <span className="text-err"> · {lane.failed} failed</span> : null}
            </span>
          </div>
        ))}
      </div>
    </Panel>
  )
}
