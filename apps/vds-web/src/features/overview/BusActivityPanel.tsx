import { Activity, ArrowRight } from 'lucide-react'
import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { useDevices } from '../../api/queries'
import { AsyncState } from '../../components/AsyncState'
import { BusTag } from '../../components/BusTag'
import { Panel } from '../../components/Panel'
import { useEventStore } from '../../stores/eventStore'
import { formatWallTime } from '../../utils/events'
import { buildLiveTransactions } from '../transactions/transactionModel'
import { transactionWireSummary } from './overviewModel'

const ROWS = 10

export function BusActivityPanel() {
  const navigate = useNavigate()
  const devices = useDevices()
  const events = useEventStore((state) => state.events)
  const transactions = useMemo(
    () => buildLiveTransactions(events, devices.data ?? [])
      .filter((transaction) => transaction.busType.toLowerCase() !== 'gpio' || (transaction.gpioEdges?.length ?? 0) > 0),
    [devices.data, events],
  )
  const recent = transactions.slice(0, ROWS)
  const errors = transactions.filter((transaction) => transaction.status === 'error').length

  return (
    <Panel
      actions={<Link className="button button-ghost button-sm" to="/transactions">Transactions <ArrowRight aria-hidden="true" size={12} /></Link>}
      className="overview-bus"
      flush
      icon={Activity}
      meta={`${transactions.length} captured${errors ? ` · ${errors} failed` : ''}`}
      title="Bus activity"
    >
      {recent.length === 0
        ? <AsyncState detail="Run your application against a /dev node, or start a scenario." kind="empty" title="No bus traffic in this session" />
        : (
          <table className="data-table">
            <thead>
              <tr><th>Time</th><th>Bus</th><th>Device</th><th>Wire</th><th className="num">TX</th><th className="num">RX</th><th>Result</th></tr>
            </thead>
            <tbody>
              {recent.map((transaction) => {
                const time = transaction.completedWallNs ?? transaction.startedWallNs
                return (
                  <tr className="clickable" key={transaction.id} onClick={() => navigate(`/transactions?transaction=${encodeURIComponent(transaction.id)}`)}>
                    <td className="mono dim">{time ? formatWallTime(time) : '—'}</td>
                    <td><BusTag bus={transaction.busType} /></td>
                    <td><strong className="node-device">{transaction.deviceId}</strong></td>
                    <td className="mono wire-cell">{transactionWireSummary(transaction)}</td>
                    <td className="num">{transaction.request.length}</td>
                    <td className="num">{transaction.response.length}</td>
                    <td>
                      <span className={`txn-result txn-${transaction.status}`}>
                        {transaction.status === 'error' ? transaction.errorCode ?? 'error' : transaction.status === 'running' ? 'in flight' : 'ok'}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
    </Panel>
  )
}
