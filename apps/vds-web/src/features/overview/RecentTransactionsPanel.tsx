import { useQueries } from '@tanstack/react-query'
import { ArrowRight, CircleX } from 'lucide-react'
import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { api } from '../../api/client'
import { queryKeys, useDevices } from '../../api/queries'
import { AsyncState } from '../../components/AsyncState'
import { Panel } from '../../components/Panel'
import { transactionWallDurationUs } from '../../hooks/useSessionTransactions'
import type { LiveTransaction } from '../transactions/transactionModel'
import { transactionHex, transactionOperation, virtualSeconds } from './overviewModel'

const ROWS = 7

/** The newest transactions with decoded operation names. */
export function RecentTransactionsPanel({ transactions }: { transactions: LiveTransaction[] }) {
  const navigate = useNavigate()
  const devices = useDevices()
  const rows = useMemo(
    () => transactions.filter((transaction) => transaction.busType.toLowerCase() !== 'gpio' || (transaction.gpioEdges?.length ?? 0) > 0).slice(0, ROWS),
    [transactions],
  )
  const spiDeviceIds = useMemo(
    () => [...new Set(rows.filter((row) => row.busType.toLowerCase() === 'spi').map((row) => row.deviceId))],
    [rows],
  )
  const commandQueries = useQueries({
    queries: spiDeviceIds.map((deviceId) => ({
      queryKey: queryKeys.deviceCommands(deviceId),
      queryFn: () => api.deviceCommands(deviceId),
      staleTime: 60_000,
    })),
  })
  const commandsByDevice = new Map(spiDeviceIds.map((deviceId, index) => [deviceId, commandQueries[index]?.data]))
  const names = new Map((devices.data ?? []).map((device) => [device.id, device.name ?? device.id]))

  return (
    <Panel
      actions={<Link className="button button-ghost button-sm" to="/transactions">All transactions <ArrowRight aria-hidden="true" size={13} /></Link>}
      className="overview-recent"
      flush
      title="Recent transactions"
    >
      {rows.length === 0
        ? <AsyncState detail="Run your application against a /dev node, or start a scenario." kind="empty" title="No transactions in this session" />
        : (
          <table className="data-table recent-table">
            <thead>
              <tr>
                <th>Time (s)</th>
                <th>Bus</th>
                <th>Device</th>
                <th>Operation</th>
                <th>TX / RX (hex)</th>
                <th className="num">Duration (µs)</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((transaction) => {
                const duration = transactionWallDurationUs(transaction)
                const failed = transaction.status === 'error'
                return (
                  <tr className={`clickable${failed ? ' recent-failed' : ''}`} key={transaction.id} onClick={() => navigate(`/transactions?transaction=${encodeURIComponent(transaction.id)}`)}>
                    <td className="mono">
                      {failed && <CircleX aria-label="Failed" className="recent-fail-icon" size={14} />}
                      {virtualSeconds(transaction.completedVirtualNs ?? transaction.startedVirtualNs)}
                    </td>
                    <td className={`recent-bus bus-${transaction.busType.toLowerCase()}`}>{transaction.busType.toUpperCase()}</td>
                    <td className="recent-device" title={transaction.deviceId}>{names.get(transaction.deviceId) ?? transaction.deviceId}</td>
                    <td>{transactionOperation(transaction, commandsByDevice.get(transaction.deviceId))}</td>
                    <td className="mono recent-hex">TX: {transactionHex(transaction.request, 3)} <span className="dim">/</span> RX: {transactionHex(transaction.response, 3)}</td>
                    <td className="num">{duration === undefined ? '—' : duration.toFixed(0)}</td>
                    <td className={`recent-result ${failed ? 'text-err' : transaction.status === 'success' ? 'text-ok' : 'text-warn'}`}>
                      {failed ? (transaction.errorCode ?? 'ERROR').toUpperCase().replace(/^STATE_COMMAND_REJECTED$/, 'REJECTED') : transaction.status === 'success' ? 'OK' : 'IN FLIGHT'}
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
