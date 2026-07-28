import { useMemo, useState, type CSSProperties } from 'react'
import {
  Circle,
  Download,
  Gauge,
  Pause,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react'

import { useAdapters, useBusTelemetry, useDevices } from '../../api/queries'
import { AsyncState } from '../../components/AsyncState'
import { GlassPanel } from '../../components/GlassPanel'
import { StatusBadge } from '../../components/StatusBadge'
import { useEventStore } from '../../stores/eventStore'
import { BusSignalScope } from './BusSignalScope'
import { supportsSignalScope } from './signalScopeSupport'
import { TransactionHexViewer } from './TransactionHexViewer'
import {
  buildLiveTransactions,
  transactionDirection,
  type LiveTransaction,
  type TransactionDirection,
} from './transactionModel'

type DirectionFilter = TransactionDirection | 'all'

function Sparkline({ color, points }: { color: string; points: number[] }) {
  const max = Math.max(...points, 1)
  const path = points.map((point, index) => `${(index / Math.max(points.length - 1, 1)) * 100},${38 - (point / max) * 29}`).join(' ')
  return <svg aria-hidden="true" className="dashboard-sparkline" preserveAspectRatio="none" viewBox="0 0 100 40"><polyline fill="none" points={path} stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" /></svg>
}

function Dial({ value, label, color }: { value: string; label: string; color: string }) {
  return <div className="health-dial" style={{ '--dial-color': color } as CSSProperties}><div><strong>{value}</strong><span>{label}</span></div></div>
}

function MetricChart({
  label,
  value,
  unit,
  color,
  points,
}: {
  label: string
  value: string
  unit: string
  color: string
  points: number[]
}) {
  return <section className="dashboard-chart-card">
    <header><div><span>{label}</span><strong>{value}<small>{unit}</small></strong></div><select aria-label={`${label} bus`} defaultValue="all"><option value="all">All buses</option></select></header>
    <Sparkline color={color} points={points} />
    <footer><span style={{ color }}>● SPI</span><span>● I2C</span><span>● UART</span></footer>
  </section>
}

function transactionTimestamp(transaction: LiveTransaction) {
  const nanoseconds = transaction.completedWallNs ?? transaction.startedWallNs
  if (nanoseconds === undefined) return '—'
  return new Date(nanoseconds / 1_000_000).toLocaleTimeString([], {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  })
}

function transactionSummary(transaction: LiveTransaction) {
  if (transaction.response.length > 0) {
    const first = transaction.response[0]?.toString(16).padStart(2, '0').toUpperCase()
    return `READ 0x${first} (${transaction.response.length} B)`
  }
  return `WRITE ${transaction.request.length} B`
}

function throughputRate(bytesPerSecond?: number) {
  if (bytesPerSecond === undefined) return { value: '—', unit: '' }
  if (bytesPerSecond < 1000) return { value: bytesPerSecond.toFixed(2), unit: ' B/s' }
  return { value: (bytesPerSecond / 1000).toFixed(1), unit: ' KB/s' }
}

export function TransactionsPage() {
  const adapters = useAdapters()
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
      (busFilter === 'all' || transaction.busType.toLowerCase() === busFilter) &&
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
  const discoveredBusTypes = useMemo(
    () => [...new Set((devices.data ?? []).map((device) => device.bus.toLowerCase()))].sort(),
    [devices.data],
  )
  const busTypes = ['gpio', 'spi', 'i2c', 'uart', 'ethernet'].filter(
    (bus) => discoveredBusTypes.includes(bus) || ['gpio', 'spi', 'i2c', 'uart', 'ethernet'].includes(bus),
  )
  const chartBase = transactions.slice(0, 18).map((transaction) => transaction.request.length + transaction.response.length).reverse()
  const points = chartBase.length > 2 ? chartBase : [18, 26, 21, 34, 25, 42, 31, 48, 35, 52, 45, 60]
  const throughput = throughputRate(selectedTelemetry?.throughput.tx_bytes_per_second)

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

  function selectTransaction(id: string) {
    setSelectedTransactionId(id)
    setAutoFollow(false)
  }

  return <div className="dashboard-console transactions-console">
    <section className="dashboard-capture-bar">
      <div><h1>Bus Analyzer</h1><small>Live transaction and protocol analysis</small></div>
      <div className="dashboard-capture-actions">
        <StatusBadge status={connectionStatus} />
        <button
          className={capturing ? 'capture-active' : ''}
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
          <Pause size={13} /> Pause
        </button>
        <button disabled={filteredTransactions.length === 0} onClick={exportTransactions} type="button"><Download size={13} /> Export</button>
        <button disabled={transactions.length === 0} onClick={clearCapture} type="button"><Trash2 size={13} /> Clear</button>
      </div>
    </section>

    <main className="dashboard-console-grid">
      <GlassPanel className="dashboard-live-panel">
        <header className="console-panel-header">
          <div><span>LIVE TRANSACTIONS</span><small><i className="live-dot" /> {capturing ? 'Live' : 'Paused'}</small></div>
          <button aria-label="Filter transactions"><SlidersHorizontal size={14} /></button>
        </header>
        <div className="console-analyzer-filters">
          <label><span>Bus</span><select value={busFilter} onChange={(event) => setBusFilter(event.target.value)}><option value="all">All buses</option>{busTypes.map((bus) => <option key={bus} value={bus}>{bus.toUpperCase()}</option>)}</select></label>
          <label><span>Direction</span><select value={directionFilter} onChange={(event) => setDirectionFilter(event.target.value as DirectionFilter)}><option value="all">All</option><option value="full_duplex">Full duplex</option><option value="tx">TX only</option><option value="rx">RX only</option></select></label>
          <label><span>Device</span><select value={deviceFilter} onChange={(event) => setDeviceFilter(event.target.value)}><option value="all">All devices</option>{devices.data?.map((device) => <option key={device.id} value={device.id}>{device.id}</option>)}</select></label>
        </div>
        <div className="console-filter-row"><span>Time</span><span>Bus</span><span>Device</span><span>Summary</span><span>Status</span></div>
        {connectionStatus === 'disconnected' && events.length === 0 && <AsyncState detail={`Replay cursor #${lastEventId}`} kind="disconnected" title="Capture stream disconnected" />}
        {connectionStatus !== 'disconnected' && filteredTransactions.length === 0 && <AsyncState detail="Transactions from every workspace device will appear here." kind="empty" title="Waiting for bus traffic" />}
        <div className="console-transaction-list">
          {filteredTransactions.slice(0, 100).map((transaction) => <button
            className={`console-transaction-row${selectedTransaction?.id === transaction.id ? ' active' : ''}`}
            key={transaction.id}
            onClick={() => selectTransaction(transaction.id)}
            type="button"
          >
            <time>{transactionTimestamp(transaction)}</time>
            <b className={`console-bus bus-${transaction.busType.toLowerCase()}`}>{transaction.busType.toUpperCase()}</b>
            <strong>{transaction.deviceId}</strong>
            <span>{transactionSummary(transaction)}</span>
            <em className={`row-status ${transaction.status}`}>{transaction.status === 'error' ? 'ERROR' : transaction.status === 'running' ? 'LIVE' : 'OK'}</em>
          </button>)}
        </div>
        <footer className="console-list-footer"><span>{filteredTransactions.length} transactions</span><span>{autoFollow ? 'Live tail' : 'Selection locked'}</span></footer>
      </GlassPanel>

      <GlassPanel className="dashboard-scope-panel">
        <header className="console-panel-header">
          <div><span>{selectedTransaction ? `${selectedTransaction.busType.toUpperCase()} · ${selectedTransaction.deviceId}` : 'NO DEVICE'}</span><small>{selectedTransaction ? `${selectedTransaction.deviceId} · #${selectedTransaction.transactionId}` : 'Select a transaction'}</small></div>
          <StatusBadge status={selectedTransaction?.status ?? connectionStatus} />
        </header>
        {!selectedTransaction && <AsyncState kind="empty" title="No signal captured yet" />}
        {selectedTransaction && supportsSignalScope(selectedTransaction.busType) && <BusSignalScope transaction={selectedTransaction} />}
        {selectedTransaction && !supportsSignalScope(selectedTransaction.busType) && <AsyncState detail="Ethernet payload remains available in the hex viewer below." kind="empty" title="No electrical timing scope for Ethernet" />}
      </GlassPanel>

      <aside className="dashboard-health-rail">
        <GlassPanel>
          <header className="console-panel-header"><div><span>Bus Health Summary</span><small>Runtime telemetry</small></div><Gauge size={15} /></header>
          <div className="health-summary-content">
            <Dial color="#53d98c" label="Health Score" value={selectedTelemetry ? '98' : '—'} />
            <div className="health-kpis">
              <p><span>●</span> Error Rate <b>{selectedTelemetry ? `${(selectedTelemetry.errors.rate * 100).toFixed(2)}%` : '—'}</b></p>
              <p><span>●</span> Throughput <b>{`${throughput.value}${throughput.unit}`}</b></p>
              <p><span>●</span> Latency (p95) <b>{selectedTelemetry ? `${selectedTelemetry.latency.wall_p95_us.toFixed(0)} µs` : '—'}</b></p>
            </div>
          </div>
        </GlassPanel>
        <MetricChart label="THROUGHPUT (LIVE)" value={throughput.value} unit={throughput.unit} color="#48cfe7" points={points} />
        <MetricChart label="LATENCY (LIVE)" value={selectedTelemetry ? selectedTelemetry.latency.wall_avg_us.toFixed(0) : '—'} unit=" µs" color="#a77bff" points={points.map((point) => Math.max(4, 72 - point))} />
      </aside>

      <GlassPanel className="dashboard-selected-panel">
        <header className="console-panel-header">
          <div><span>SELECTED TRANSACTION</span><small>{selectedTransaction ? `${selectedTransaction.deviceId} · ${selectedTransaction.busType.toUpperCase()} · #${selectedTransaction.transactionId}` : 'Select a live transaction'}</small></div>
          {selectedTransaction && <StatusBadge status={selectedTransaction.status} />}
        </header>
        {!selectedTransaction && <AsyncState kind="empty" title="No transaction selected" />}
        {selectedTransaction && (
          <div className="selected-transaction-grid">
            <div className="selected-meta">
              <span>Operation<strong>{selectedTransaction.response.length ? 'READ' : 'WRITE'}</strong></span>
              <span>Request<strong>{selectedTransaction.request.length} Bytes</strong></span>
              <span>Response<strong>{selectedTransaction.response.length} Bytes</strong></span>
              <span>Devices<strong>{devices.data?.length ?? 0}</strong></span>
              <span>Adapters<strong>{adapters.data?.length ?? 0}</strong></span>
            </div>
            <TransactionHexViewer request={selectedTransaction.request} response={selectedTransaction.response} />
          </div>
        )}
      </GlassPanel>
    </main>

  </div>
}
