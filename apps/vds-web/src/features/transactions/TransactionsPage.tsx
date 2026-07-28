import { useEffect, useMemo, useState } from 'react'
import {
  buildStyles,
  CircularProgressbarWithChildren,
} from 'react-circular-progressbar'
import 'react-circular-progressbar/dist/styles.css'
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

function axisValue(value: number) {
  if (value >= 100) return value.toFixed(0)
  if (value >= 10) return value.toFixed(1)
  return value.toFixed(2)
}

function Sparkline({
  axisUnit,
  color,
  points,
  windowSeconds,
}: {
  axisUnit: string
  color: string
  points: number[]
  windowSeconds: number
}) {
  const chartPoints = points.length === 1 ? [points[0], points[0]] : points
  const max = Math.max(...chartPoints, 1)
  const plotStartX = 0
  const plotEndX = 140
  const plotTopY = 10
  const plotBottomY = 90
  const yTicks = Array.from({ length: 5 }, (_, index) => ({
    value: max * (1 - index / 4),
    y: plotTopY + (index / 4) * (plotBottomY - plotTopY),
  }))
  const xTicks = Array.from({ length: 10 }, (_, index) => ({
    label: index === 9 ? 'now' : `-${Math.round(windowSeconds * (1 - index / 9))}s`,
    x: plotStartX + (index / 9) * (plotEndX - plotStartX),
  }))
  const path = chartPoints.map((point, index) => `${plotStartX + (index / Math.max(chartPoints.length - 1, 1)) * (plotEndX - plotStartX)},${plotBottomY - (point / max) * (plotBottomY - plotTopY)}`).join(' ')
  return <div aria-hidden="true" className="dashboard-chart-frame">
    <svg className="dashboard-sparkline" preserveAspectRatio="none" viewBox="0 0 140 90">
      <g className="dashboard-chart-grid">
        {yTicks.map(({ y }) =>
          <line className={y === plotBottomY ? 'dashboard-chart-axis-line' : undefined} key={`horizontal-${y}`} x1={plotStartX} x2={plotEndX} y1={y} y2={y} />,
        )}
        {xTicks.map(({ x }) =>
          <line className={x === plotStartX ? 'dashboard-chart-axis-line' : undefined} key={`vertical-${x}`} x1={x} x2={x} y1={plotTopY} y2={plotBottomY} />,
        )}
      </g>
      <polyline fill="none" points={path} stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
    <div className="dashboard-chart-y-axis">
      {yTicks.map(({ value, y }) =>
        <span key={`y-label-${y}`} style={{ top: `${(y / 90) * 100}%` }}>{`${axisValue(value)} ${axisUnit}`}</span>,
      )}
    </div>
    <div className="dashboard-chart-x-axis">
      {xTicks.map(({ label, x }) =>
        <span key={`x-label-${x}`} style={{ left: `${(x / plotEndX) * 100}%` }}>{label}</span>,
      )}
    </div>
  </div>
}

function Dial({ value, label, color }: { value?: number; label: string; color: string }) {
  const displayValue = value === undefined ? '—' : `${value.toFixed(1)}%`
  return <div
    aria-label={`${label}: ${displayValue}`}
    aria-valuemax={100}
    aria-valuemin={0}
    aria-valuenow={value}
    className="health-dial"
    role="meter"
  >
    <CircularProgressbarWithChildren
      strokeWidth={8}
      styles={buildStyles({
        pathColor: color,
        trailColor: 'rgba(255, 255, 255, 0.08)',
        strokeLinecap: 'round',
      })}
      value={value ?? 0}
    >
      <strong>{displayValue}</strong>
      <span>{label}</span>
    </CircularProgressbarWithChildren>
  </div>
}

function MetricChart({
  label,
  value,
  unit,
  color,
  points,
  deviceLabel,
  windowSeconds,
}: {
  label: string
  value: string
  unit: string
  color: string
  points: number[]
  deviceLabel: string
  windowSeconds: number
}) {
  return <section className="dashboard-chart-card">
    <header><div><span>{label}</span><strong>{value}<small>{unit}</small></strong></div><span className="metric-device-label">{deviceLabel}</span></header>
    {points.length > 0
      ? <Sparkline axisUnit={unit.trim()} color={color} points={points} windowSeconds={windowSeconds} />
      : <div className="dashboard-sparkline-empty">Waiting for telemetry</div>}
    <footer><span style={{ color }}>● Live API</span><span>{windowSeconds}s window</span><span>{points.length} samples</span></footer>
  </section>
}

interface TelemetrySample {
  generatedAtWallNs: number
  throughputBytesPerSecond: number
  latencyP95Us: number
}

function useTelemetryHistory(
  deviceId: string | undefined,
  generatedAtWallNs: number | undefined,
  throughputBytesPerSecond: number | undefined,
  latencyP95Us: number | undefined,
) {
  const [history, setHistory] = useState<Record<string, TelemetrySample[]>>({})

  useEffect(() => {
    if (
      deviceId === undefined ||
      generatedAtWallNs === undefined ||
      throughputBytesPerSecond === undefined ||
      latencyP95Us === undefined
    ) return

    const updateId = window.setTimeout(() => {
      setHistory((current) => {
        const deviceHistory = current[deviceId] ?? []
        if (deviceHistory.at(-1)?.generatedAtWallNs === generatedAtWallNs) return current
        return {
          ...current,
          [deviceId]: [
            ...deviceHistory,
            { generatedAtWallNs, throughputBytesPerSecond, latencyP95Us },
          ].slice(-30),
        }
      })
    }, 0)

    return () => window.clearTimeout(updateId)
  }, [deviceId, generatedAtWallNs, latencyP95Us, throughputBytesPerSecond])

  return deviceId === undefined ? [] : history[deviceId] ?? []
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
  const selectedGpioAdapter = adapters.data?.find(
    (adapter) =>
      adapter.bus_type === 'gpio' &&
      adapter.bindings.some((binding) => binding.device_id === selectedTransaction?.deviceId),
  )
  const discoveredBusTypes = useMemo(
    () => [...new Set((devices.data ?? []).map((device) => device.bus.toLowerCase()))].sort(),
    [devices.data],
  )
  const busTypes = ['gpio', 'spi', 'i2c', 'uart', 'ethernet'].filter(
    (bus) => discoveredBusTypes.includes(bus) || ['gpio', 'spi', 'i2c', 'uart', 'ethernet'].includes(bus),
  )
  const hasCompletedTransactions = (selectedTelemetry?.transactions_total ?? 0) > 0
  const throughputBytesPerSecond = selectedTelemetry
    ? selectedTelemetry.throughput.tx_bytes_per_second + selectedTelemetry.throughput.rx_bytes_per_second
    : undefined
  const throughput = throughputRate(throughputBytesPerSecond)
  const successRate = hasCompletedTransactions && selectedTelemetry
    ? Math.max(0, Math.min(100, (1 - selectedTelemetry.errors.rate) * 100))
    : undefined
  const telemetryHistory = useTelemetryHistory(
    selectedTelemetry?.device_id,
    telemetry.data?.generated_at_wall_ns,
    throughputBytesPerSecond,
    selectedTelemetry?.latency.wall_p95_us,
  )
  const healthColor = selectedTelemetry?.health === 'unhealthy'
    ? '#ff6b7a'
    : selectedTelemetry?.health === 'degraded'
      ? '#f2b84b'
      : '#53d98c'
  const telemetryWindowSeconds = telemetry.data?.window_seconds ?? 60
  const selectedDeviceLabel = selectedTelemetry
    ? `${selectedTelemetry.bus_type.toUpperCase()} · ${selectedTelemetry.device_id}`
    : 'No device'
  const throughputChartScale = throughput.unit === ' KB/s' ? 1000 : 1

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

    <main className={`dashboard-console-grid${selectedTransaction?.busType.toLowerCase() === 'gpio' ? ' gpio-timing-expanded' : ''}`}>
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
        {selectedTransaction && supportsSignalScope(selectedTransaction.busType) && <BusSignalScope
          gpioControllerIndex={selectedGpioAdapter?.bus_number}
          transaction={selectedTransaction}
        />}
        {selectedTransaction && !supportsSignalScope(selectedTransaction.busType) && <AsyncState detail="Ethernet payload remains available in the hex viewer below." kind="empty" title="No electrical timing scope for Ethernet" />}
      </GlassPanel>

      <aside className="dashboard-health-rail">
        <GlassPanel>
          <header className="console-panel-header"><div><span>Bus Health Summary</span><small>Runtime telemetry</small></div><Gauge size={15} /></header>
          <div className="health-summary-content">
            <Dial color={healthColor} label="Success rate" value={successRate} />
            <div className="health-kpis">
              <p><span>●</span> Error Rate <b>{hasCompletedTransactions && selectedTelemetry ? `${(selectedTelemetry.errors.rate * 100).toFixed(2)}%` : '—'}</b></p>
              <p><span>●</span> Total Throughput <b>{`${throughput.value}${throughput.unit}`}</b></p>
              <p><span>●</span> Latency (p95) <b>{hasCompletedTransactions && selectedTelemetry ? `${selectedTelemetry.latency.wall_p95_us.toFixed(0)} µs` : '—'}</b></p>
            </div>
          </div>
        </GlassPanel>
        <MetricChart
          color="#48cfe7"
          deviceLabel={selectedDeviceLabel}
          label="TOTAL THROUGHPUT (LIVE)"
          points={telemetryHistory.map((sample) => sample.throughputBytesPerSecond / throughputChartScale)}
          unit={throughput.unit}
          value={throughput.value}
          windowSeconds={telemetryWindowSeconds}
        />
        <MetricChart
          color="#a77bff"
          deviceLabel={selectedDeviceLabel}
          label="LATENCY P95 (LIVE)"
          points={telemetryHistory.map((sample) => sample.latencyP95Us)}
          unit=" µs"
          value={hasCompletedTransactions && selectedTelemetry ? selectedTelemetry.latency.wall_p95_us.toFixed(0) : '—'}
          windowSeconds={telemetryWindowSeconds}
        />
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
            </div>
            <TransactionHexViewer request={selectedTransaction.request} response={selectedTransaction.response} />
          </div>
        )}
      </GlassPanel>
    </main>

  </div>
}
