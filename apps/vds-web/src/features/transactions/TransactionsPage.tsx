import { useMemo, useState } from 'react'
import { Circle, Download, Pause, Radio, Trash2 } from 'lucide-react'

import { AsyncState } from '../../components/AsyncState'
import { GlassPanel } from '../../components/GlassPanel'
import { StatusBadge } from '../../components/StatusBadge'
import { useBusTelemetry, useDevices } from '../../api/queries'
import { useEventStore } from '../../stores/eventStore'
import { BusSignalScope } from './BusSignalScope'
import { BusTelemetrySidebar } from './BusTelemetrySidebar'
import { LiveTransactionTable } from './LiveTransactionList'
import { TransactionHexViewer } from './TransactionHexViewer'
import {
  buildLiveTransactions,
  transactionDirection,
  type TransactionDirection,
} from './transactionModel'

type DirectionFilter = TransactionDirection | 'all'

export function TransactionsPage() {
  const devices = useDevices()
  const telemetry = useBusTelemetry()
  const events = useEventStore((state) => state.events)
  const connectionStatus = useEventStore((state) => state.connectionStatus)
  const lastEventId = useEventStore((state) => state.lastEventId)
  const [busFilter, setBusFilter] = useState('all')
  const [deviceFilter, setDeviceFilter] = useState('all')
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>('all')
  const [selectedTransactionId, setSelectedTransactionId] = useState<string | null>(null)
  const [pausedAtEventId, setPausedAtEventId] = useState<number | null>(null)
  const [clearedThroughEventId, setClearedThroughEventId] = useState(0)
  const [autoFollow, setAutoFollow] = useState(true)
  const capturing = pausedAtEventId === null
  const visibleEvents = useMemo(
    () => events.filter(
      (event) =>
        event.event_id > clearedThroughEventId &&
        (pausedAtEventId === null || event.event_id <= pausedAtEventId),
    ),
    [clearedThroughEventId, events, pausedAtEventId],
  )
  const transactions = useMemo(
    () => buildLiveTransactions(visibleEvents, devices.data ?? []),
    [devices.data, visibleEvents],
  )
  const filteredTransactions = useMemo(
    () => transactions.filter((transaction) =>
      (busFilter === 'all' || transaction.busType === busFilter) &&
      (deviceFilter === 'all' || transaction.deviceId === deviceFilter) &&
      (directionFilter === 'all' || transactionDirection(transaction) === directionFilter),
    ),
    [busFilter, deviceFilter, directionFilter, transactions],
  )
  const selectedTransaction = autoFollow
    ? filteredTransactions[0]
    : filteredTransactions.find((transaction) => transaction.id === selectedTransactionId) ??
      filteredTransactions[0]
  const selectedTelemetry = telemetry.data?.buses.find(
    (bus) => bus.device_id === selectedTransaction?.deviceId,
  ) ?? telemetry.data?.buses[0]
  const busTypes = useMemo(
    () => [...new Set((devices.data ?? []).map((device) => device.bus))].sort(),
    [devices.data],
  )

  function exportTransactions() {
    const blob = new Blob([JSON.stringify(filteredTransactions, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `vds4e-bus-capture-${Date.now()}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  function clearCapture() {
    setClearedThroughEventId(lastEventId)
    setSelectedTransactionId(null)
    setAutoFollow(true)
  }

  return (
    <div className="page-stack transactions-page bus-analyzer-page">
      <GlassPanel className="bus-analyzer-header">
        <div className="bus-analyzer-title">
          <span><Radio size={18} /></span>
          <div><small>Real-time workspace capture</small><h1>Bus Analyzer</h1></div>
          <div className="bus-analyzer-types">
            {busTypes.map((bus) => <i className={`transaction-bus-badge bus-${bus.toLowerCase()}`} key={bus}>{bus}</i>)}
          </div>
        </div>
        <div className="bus-analyzer-actions">
          <StatusBadge status={connectionStatus} />
          <button
            className={capturing ? 'active' : ''}
            onClick={() => {
              setPausedAtEventId(null)
              setAutoFollow(true)
            }}
            type="button"
          >
            <Circle fill="currentColor" size={11} /> Start Capture
          </button>
          <button
            disabled={!capturing}
            onClick={() => {
              setPausedAtEventId(lastEventId)
              setAutoFollow(false)
            }}
            type="button"
          >
            <Pause size={14} /> Pause
          </button>
          <button disabled={filteredTransactions.length === 0} onClick={exportTransactions} type="button">
            <Download size={14} /> Export
          </button>
          <button disabled={transactions.length === 0} onClick={clearCapture} type="button">
            <Trash2 size={14} /> Clear
          </button>
        </div>
      </GlassPanel>

      <div className="bus-analyzer-columns">
        <GlassPanel className="bus-analyzer-live">
          <div className="analyzer-column-heading">
            <div><strong>Live Transactions</strong><small>All workspace devices · newest first</small></div>
            <span>{filteredTransactions.length}</span>
          </div>
          <div className="transaction-filter-row">
            <label>
              <span>Bus</span>
              <select value={busFilter} onChange={(event) => setBusFilter(event.target.value)}>
                <option value="all">All buses</option>
                {busTypes.map((bus) => <option key={bus} value={bus}>{bus.toUpperCase()}</option>)}
              </select>
            </label>
            <label>
              <span>Direction</span>
              <select value={directionFilter} onChange={(event) => setDirectionFilter(event.target.value as DirectionFilter)}>
                <option value="all">All directions</option>
                <option value="full_duplex">Full duplex</option>
                <option value="tx">TX only</option>
                <option value="rx">RX only</option>
              </select>
            </label>
            <label>
              <span>Device</span>
              <select value={deviceFilter} onChange={(event) => setDeviceFilter(event.target.value)}>
                <option value="all">All devices</option>
                {devices.data?.map((device) => <option key={device.id} value={device.id}>{device.id}</option>)}
              </select>
            </label>
          </div>
          {connectionStatus === 'disconnected' && events.length === 0 && (
            <AsyncState detail={`Replay cursor #${lastEventId}`} kind="disconnected" title="Capture stream disconnected" />
          )}
          {connectionStatus !== 'disconnected' && filteredTransactions.length === 0 && (
            <AsyncState detail="Transactions from every workspace device will appear here." kind="empty" title="Waiting for bus traffic" />
          )}
          {filteredTransactions.length > 0 && (
            <LiveTransactionTable
              onSelect={(id) => {
                setSelectedTransactionId(id)
                setAutoFollow(false)
              }}
              selectedId={selectedTransaction?.id ?? null}
              transactions={filteredTransactions}
            />
          )}
        </GlassPanel>

        <GlassPanel className="bus-analyzer-detail">
          <div className="analyzer-column-heading">
            <div><strong>Transaction Details</strong><small>{selectedTransaction ? `${selectedTransaction.deviceId} · #${selectedTransaction.transactionId}` : 'Select a transaction'}</small></div>
            {selectedTransaction && <i className={`transaction-status-badge status-${selectedTransaction.status}`}>{selectedTransaction.errorCode ?? selectedTransaction.status}</i>}
          </div>
          {!selectedTransaction && <AsyncState kind="empty" title="No transaction selected" />}
          {selectedTransaction && (
            <div className="transaction-detail-stack">
              <BusSignalScope transaction={selectedTransaction} />
              <TransactionHexViewer request={selectedTransaction.request} response={selectedTransaction.response} />
            </div>
          )}
        </GlassPanel>

        <BusTelemetrySidebar
          error={telemetry.isError}
          loading={telemetry.isLoading}
          telemetry={selectedTelemetry}
        />
      </div>
    </div>
  )
}
