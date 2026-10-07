import { Activity, AudioWaveform, Download, LocateFixed, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { useAdapters, useBusTelemetry, useDevices } from '../../api/queries'
import { AsyncState } from '../../components/AsyncState'
import { PageHeader } from '../../components/PageHeader'
import { Panel } from '../../components/Panel'
import { useEventStore } from '../../stores/eventStore'
import { CaptureControls } from './CaptureControls'
import { TelemetryInspector } from './TelemetryInspector'
import { TransactionDetail } from './TransactionDetail'
import { TransactionTable } from './TransactionTable'
import {
  buildLiveTransactions,
  transactionDirection,
  type TransactionDirection,
} from './transactionModel'
import './analyzer.css'

type DirectionFilter = TransactionDirection | 'all'

const KNOWN_BUSES = ['spi', 'i2c', 'gpio', 'uart', 'ethernet']

/**
 * Bus Analyzer: live, paired transaction capture with a per-transaction
 * signal scope, decoded fields, hex dump and per-bus telemetry.
 *
 * `?transaction=<deviceId>:<transactionId>` selects and locks a transaction;
 * without it the selection follows the newest captured transaction.
 */
export function TransactionsPage() {
  const adapters = useAdapters()
  const devices = useDevices()
  const telemetry = useBusTelemetry()
  const events = useEventStore((state) => state.events)
  const connectionStatus = useEventStore((state) => state.connectionStatus)
  const lastEventId = useEventStore((state) => state.lastEventId)
  const [searchParams, setSearchParams] = useSearchParams()
  const lockedId = searchParams.get('transaction')
  const [busFilter, setBusFilter] = useState(() => searchParams.get('bus')?.toLowerCase() ?? 'all')
  const [deviceFilter, setDeviceFilter] = useState('all')
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>('all')
  const [failuresOnly, setFailuresOnly] = useState(() => searchParams.get('result') === 'failed')
  const [pausedAtEventId, setPausedAtEventId] = useState<number | null>(null)
  const [clearedThroughEventId, setClearedThroughEventId] = useState(0)
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
      (transaction.busType.toLowerCase() !== 'gpio' || (transaction.gpioEdges?.length ?? 0) > 0) &&
      (busFilter === 'all' || transaction.busType.toLowerCase() === busFilter) &&
      (deviceFilter === 'all' || transaction.deviceId === deviceFilter) &&
      (directionFilter === 'all' || transactionDirection(transaction) === directionFilter) &&
      (!failuresOnly || transaction.status === 'error'),
    ),
    [busFilter, deviceFilter, directionFilter, failuresOnly, transactions],
  )
  const errorCount = useMemo(
    () => filteredTransactions.reduce((count, transaction) => count + (transaction.status === 'error' ? 1 : 0), 0),
    [filteredTransactions],
  )

  const selectedTransaction = lockedId === null
    ? filteredTransactions[0]
    : filteredTransactions.find((transaction) => transaction.id === lockedId)
  const selectedDeviceId = selectedTransaction?.deviceId ?? (deviceFilter === 'all' ? undefined : deviceFilter)
  const selectedTelemetry = telemetry.data?.buses.find((bus) => bus.device_id === selectedDeviceId)
  const shownTelemetry = selectedTelemetry ?? telemetry.data?.buses[0]
  const selectedGpioAdapter = adapters.data?.find(
    (adapter) =>
      adapter.bus_type === 'gpio' &&
      adapter.bindings.some((binding) => binding.device_id === selectedTransaction?.deviceId),
  )
  const busTypes = useMemo(
    () => [...new Set([...KNOWN_BUSES, ...(devices.data ?? []).map((device) => device.bus.toLowerCase())])],
    [devices.data],
  )

  function setLockedId(id: string | null) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      if (id === null) next.delete('transaction')
      else next.set('transaction', id)
      return next
    }, { replace: true })
  }

  function exportTransactions() {
    const blob = new Blob([JSON.stringify(filteredTransactions, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `vds4e-bus-capture-${Date.now()}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  function clearCapture() {
    setClearedThroughEventId(lastEventId)
    setLockedId(null)
  }

  const analyzerLink = selectedTransaction
    ? `/waveform?transaction=${encodeURIComponent(selectedTransaction.id)}&bus=${encodeURIComponent(selectedTransaction.busType.toLowerCase())}&device=${encodeURIComponent(selectedTransaction.deviceId)}`
    : '/waveform'

  return (
    <div className="page txa-page">
      <PageHeader
        actions={(
          <>
            <button aria-label="Export" className="button button-sm button-ghost" disabled={filteredTransactions.length === 0} onClick={exportTransactions} title="Export the filtered capture as JSON" type="button">
              <Download aria-hidden="true" size={12} /><span className="anl-btn-text">Export</span>
            </button>
            <button aria-label="Clear" className="button button-sm button-ghost" disabled={transactions.length === 0} onClick={clearCapture} title="Discard everything captured so far" type="button">
              <Trash2 aria-hidden="true" size={12} /><span className="anl-btn-text">Clear</span>
            </button>
            <span className="toolbar-separator" />
            <Link aria-label="Logic Analyzer" className="button button-sm" title="Open the Logic Analyzer waveform viewer" to={analyzerLink}>
              <AudioWaveform aria-hidden="true" size={12} /><span className="anl-btn-text">Logic Analyzer</span>
            </Link>
          </>
        )}
        context="Bus Analyzer"
        title="Transactions"
      >
        <CaptureControls
          capturing={capturing}
          connectionStatus={connectionStatus}
          cursor={pausedAtEventId ?? lastEventId}
          onPause={() => setPausedAtEventId(lastEventId)}
          onResume={() => setPausedAtEventId(null)}
        />
        <span className="toolbar-separator" />
        <div className="toolbar anl-filters" role="group" aria-label="Capture filters">
          <select aria-label="Bus" onChange={(event) => setBusFilter(event.target.value)} value={busFilter}>
            <option value="all">All buses</option>
            {busTypes.map((bus) => <option key={bus} value={bus}>{bus.toUpperCase()}</option>)}
          </select>
          <select aria-label="Direction" onChange={(event) => setDirectionFilter(event.target.value as DirectionFilter)} value={directionFilter}>
            <option value="all">Any direction</option>
            <option value="full_duplex">Full duplex</option>
            <option value="tx">TX only</option>
            <option value="rx">RX only</option>
          </select>
          <select aria-label="Device" className="anl-device-select" onChange={(event) => setDeviceFilter(event.target.value)} value={deviceFilter}>
            <option value="all">All devices</option>
            {devices.data?.map((device) => <option key={device.id} value={device.id}>{device.id}</option>)}
          </select>
          <button
            aria-pressed={failuresOnly}
            className="button button-sm"
            onClick={() => setFailuresOnly((current) => !current)}
            title="Show only transactions that completed with an error"
            type="button"
          >
            Failures only
          </button>
        </div>
      </PageHeader>

      <div className="page-body fill txa-body">
        <Panel
          actions={(
            <button
              aria-pressed={lockedId === null}
              className="button button-sm button-ghost"
              onClick={() => setLockedId(null)}
              title="Always select the newest transaction"
              type="button"
            >
              <LocateFixed aria-hidden="true" size={12} /> Follow
            </button>
          )}
          className="txa-list"
          flush
          footer={(
            <>
              <span>{filteredTransactions.length} shown</span>
              {transactions.length !== filteredTransactions.length && <span>{transactions.length} captured</span>}
              {errorCount > 0 && <span className="text-err">{errorCount} failed</span>}
              <span className="toolbar-spacer" />
              <span className={lockedId === null ? 'anl-follow-state live' : 'anl-follow-state'}>
                {lockedId === null ? 'Live tail' : 'Selection locked'}
              </span>
            </>
          )}
          icon={Activity}
          meta={capturing ? 'capturing' : `frozen at #${pausedAtEventId}`}
          title="Capture"
        >
          {connectionStatus === 'disconnected' && events.length === 0 && (
            <AsyncState detail={`Replay cursor #${lastEventId}`} kind="disconnected" title="Capture stream disconnected" />
          )}
          {!(connectionStatus === 'disconnected' && events.length === 0) && filteredTransactions.length === 0 && (
            <AsyncState
              detail={busFilter === 'gpio'
                ? 'Only LOW → HIGH and HIGH → LOW line changes appear here.'
                : 'Open a /dev node from your application, or run a scenario, to generate traffic.'}
              kind="empty"
              title={busFilter === 'gpio' ? 'Waiting for a GPIO edge' : 'Waiting for bus traffic'}
            />
          )}
          {filteredTransactions.length > 0 && (
            <TransactionTable
              onSelect={setLockedId}
              revealId={lockedId}
              selectedId={selectedTransaction?.id}
              transactions={filteredTransactions}
            />
          )}
        </Panel>

        <TelemetryInspector
          error={telemetry.isError}
          fallback={selectedTelemetry === undefined && shownTelemetry !== undefined && selectedDeviceId !== undefined}
          generatedAtWallNs={telemetry.data?.generated_at_wall_ns}
          loading={telemetry.isPending}
          telemetry={shownTelemetry}
          windowSeconds={telemetry.data?.window_seconds ?? 60}
        />

        <TransactionDetail
          gpioControllerIndex={selectedGpioAdapter?.bus_number}
          missingId={selectedTransaction ? null : lockedId}
          onFollowLive={() => setLockedId(null)}
          transaction={selectedTransaction}
        />
      </div>
    </div>
  )
}
