import { Activity, Download, FileCode, FileSpreadsheet, ListTree, PanelLeft, RotateCcw, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { useDevices } from '../../api/queries'
import { AsyncState } from '../../components/AsyncState'
import { PageHeader } from '../../components/PageHeader'
import { Panel } from '../../components/Panel'
import { useEventStore } from '../../stores/eventStore'
import { formatVirtualTime } from '../../utils/format'
import { CaptureControls } from '../transactions/CaptureControls'
import { buildLiveTransactions } from '../transactions/transactionModel'
import { ChannelList } from './ChannelList'
import { formatFrequency } from './frequency'
import { PacketTable } from './PacketTable'
import type { ProtocolPacket } from './types'
import { downloadFile, exportToCsv, exportToJson, exportToVcd } from './waveformExport'
import { synthesizeWaveforms } from './waveformSynthesizer'
import { WaveformTimeline } from './WaveformTimeline'
import '../transactions/analyzer.css'
import './waveform.css'

const BUS_OPTIONS = ['spi', 'i2c', 'uart', 'gpio', 'can']

function TimingHud({
  cursorANs,
  cursorBNs,
  onReset,
}: {
  cursorANs: number | null
  cursorBNs: number | null
  onReset: () => void
}) {
  const deltaNs = cursorANs !== null && cursorBNs !== null ? Math.abs(cursorBNs - cursorANs) : null
  return (
    <div aria-label="Timing cursors measurement" className="wfa-hud" role="region">
      <span className="timing-hud-cursor wfa-hud-a"><b>A</b><strong>{cursorANs !== null ? formatVirtualTime(cursorANs) : '—'}</strong></span>
      <span className="timing-hud-cursor wfa-hud-b"><b>B</b><strong>{cursorBNs !== null ? formatVirtualTime(cursorBNs) : '—'}</strong></span>
      <span className="timing-hud-delta">
        <span>Δt</span>
        <strong>{deltaNs !== null ? formatVirtualTime(deltaNs) : '—'}</strong>
        <small>{deltaNs !== null ? formatFrequency(deltaNs) : '—'}</small>
      </span>
      <button
        aria-label="Clear timing cursors"
        className="icon-button sm"
        disabled={cursorANs === null && cursorBNs === null}
        onClick={onReset}
        title="Clear timing cursors"
        type="button"
      >
        <RotateCcw aria-hidden="true" size={12} />
      </button>
    </div>
  )
}

/**
 * Logic Analyzer: synthesised digital channels for captured bus transactions,
 * inline protocol decode, A/B timing cursors and a decoded-frame table.
 * Query params: `transaction` (lock to one transaction), `bus`, `device`.
 */
export function WaveformPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialTransactionId = searchParams.get('transaction')
  const initialBus = searchParams.get('bus') ?? 'all'
  const initialDevice = searchParams.get('device') ?? 'all'

  const devices = useDevices()
  const connectionStatus = useEventStore((state) => state.connectionStatus)
  const events = useEventStore((state) => state.events)
  const lastEventId = useEventStore((state) => state.lastEventId)

  const [busFilter, setBusFilter] = useState<string>(initialBus)
  const [deviceFilter, setDeviceFilter] = useState<string>(initialDevice)
  const [selectedTxnId, setSelectedTxnId] = useState<string | null>(initialTransactionId)
  const [pausedAtEventId, setPausedAtEventId] = useState<number | null>(null)
  const [clearedThroughEventId, setClearedThroughEventId] = useState<number>(0)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [cursorANs, setCursorANs] = useState<number | null>(null)
  const [cursorBNs, setCursorBNs] = useState<number | null>(null)
  const [channelVisibility, setChannelVisibility] = useState<Record<string, boolean>>({})
  const [focus, setFocus] = useState<{ startNs: number; endNs: number; seq: number } | null>(null)

  // Mirror filters into the URL so the current view can be shared or reloaded.
  useEffect(() => {
    const params = new URLSearchParams()
    if (busFilter !== 'all') params.set('bus', busFilter)
    if (deviceFilter !== 'all') params.set('device', deviceFilter)
    if (selectedTxnId) params.set('transaction', selectedTxnId)
    setSearchParams(params, { replace: true })
  }, [busFilter, deviceFilter, selectedTxnId, setSearchParams])

  const capturing = pausedAtEventId === null
  const visibleEvents = useMemo(() => {
    const cutoff = pausedAtEventId ?? lastEventId
    return events.filter((event) => event.event_id <= cutoff && event.event_id > clearedThroughEventId)
  }, [events, pausedAtEventId, lastEventId, clearedThroughEventId])

  const transactions = useMemo(
    () => buildLiveTransactions(visibleEvents, devices.data ?? []),
    [visibleEvents, devices.data],
  )

  const filteredTransactions = useMemo(() => transactions.filter((transaction) =>
    (busFilter === 'all' || transaction.busType.toLowerCase() === busFilter.toLowerCase()) &&
    (deviceFilter === 'all' || transaction.deviceId === deviceFilter) &&
    (!selectedTxnId || transaction.id === selectedTxnId),
  ), [transactions, busFilter, deviceFilter, selectedTxnId])

  const { channels: rawChannels, allPackets, minTimeNs, maxTimeNs } = useMemo(
    () => synthesizeWaveforms(filteredTransactions),
    [filteredTransactions],
  )

  const channels = useMemo(
    () => rawChannels.map((channel) => ({ ...channel, visible: channelVisibility[channel.id] ?? true })),
    [rawChannels, channelVisibility],
  )

  const setAllChannels = (visible: boolean) => {
    setChannelVisibility(Object.fromEntries(rawChannels.map((channel) => [channel.id, visible])))
  }

  const handleToggleChannel = (id: string) => {
    setChannelVisibility((previous) => ({ ...previous, [id]: !(previous[id] ?? true) }))
  }

  const handleExportVcd = () => downloadFile(exportToVcd(channels), `vds4e-waveform-${Date.now()}.vcd`, 'text/plain')
  const handleExportCsv = () => downloadFile(exportToCsv(channels), `vds4e-waveform-${Date.now()}.csv`, 'text/csv')
  const handleExportJson = () => {
    const json = exportToJson(channels, allPackets, {
      busFilter,
      deviceFilter,
      transactionCount: filteredTransactions.length,
    })
    downloadFile(json, `vds4e-waveform-${Date.now()}.json`, 'application/json')
  }

  const resetCursors = () => {
    setCursorANs(null)
    setCursorBNs(null)
  }

  const handleClearCapture = () => {
    setClearedThroughEventId(lastEventId)
    setSelectedTxnId(null)
    resetCursors()
  }

  const selectPacket = (packet: ProtocolPacket) => {
    setCursorANs(packet.startTimeNs)
    setCursorBNs(packet.endTimeNs)
    setFocus((previous) => ({ startNs: packet.startTimeNs, endNs: packet.endTimeNs, seq: (previous?.seq ?? 0) + 1 }))
  }

  const channelToggle = (
    <button
      aria-label="Toggle channel list"
      aria-pressed={sidebarOpen}
      className="icon-button sm"
      onClick={() => setSidebarOpen((open) => !open)}
      title="Toggle channel list"
      type="button"
    >
      <PanelLeft aria-hidden="true" size={13} />
    </button>
  )
  const hud = <TimingHud cursorANs={cursorANs} cursorBNs={cursorBNs} onReset={resetCursors} />
  const visibleChannelCount = channels.filter((channel) => channel.visible).length

  return (
    <div className="page wfa-page">
      <PageHeader
        actions={(
          <>
            <div className="button-group" role="group" aria-label="Export waveform">
              <button className="button button-sm" disabled={channels.length === 0} onClick={handleExportVcd} title="Export IEEE 1364 Value Change Dump for GTKWave / sigrok / PulseView" type="button">
                <FileCode aria-hidden="true" size={12} /> VCD
              </button>
              <button className="button button-sm" disabled={channels.length === 0} onClick={handleExportCsv} title="Export waveform transitions and protocol packets to CSV" type="button">
                <FileSpreadsheet aria-hidden="true" size={12} /> CSV
              </button>
              <button className="button button-sm" disabled={channels.length === 0} onClick={handleExportJson} title="Export complete waveform data to JSON" type="button">
                <Download aria-hidden="true" size={12} /> JSON
              </button>
            </div>
            <button aria-label="Clear" className="button button-sm button-ghost" disabled={transactions.length === 0} onClick={handleClearCapture} title="Discard everything captured so far" type="button">
              <Trash2 aria-hidden="true" size={12} /><span className="anl-btn-text">Clear</span>
            </button>
            <span className="toolbar-separator" />
            <Link
              aria-label="Transactions"
              className="button button-sm"
              title="Open the Bus Analyzer transaction list"
              to={selectedTxnId ? `/transactions?transaction=${encodeURIComponent(selectedTxnId)}` : '/transactions'}
            >
              <Activity aria-hidden="true" size={12} /><span className="anl-btn-text">Transactions</span>
            </Link>
          </>
        )}
        title="Logic Analyzer"
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
          <select aria-label="Filter by bus" onChange={(event) => setBusFilter(event.target.value)} value={busFilter}>
            <option value="all">All buses</option>
            {BUS_OPTIONS.map((bus) => <option key={bus} value={bus}>{bus.toUpperCase()}</option>)}
          </select>
          <select aria-label="Filter by device" className="anl-device-select" onChange={(event) => setDeviceFilter(event.target.value)} value={deviceFilter}>
            <option value="all">All devices</option>
            {devices.data?.map((device) => <option key={device.id} value={device.id}>{device.name ?? device.id}</option>)}
          </select>
          {selectedTxnId && (
            <span className="chip mono wfa-lock" title="The timeline shows only this transaction">
              txn {selectedTxnId}
              <button aria-label="Show all transactions" className="icon-button sm" onClick={() => setSelectedTxnId(null)} title="Show all transactions" type="button">
                <X aria-hidden="true" size={11} />
              </button>
            </span>
          )}
        </div>
      </PageHeader>

      <div className="page-body fill wfa-body">
        <section aria-label="Waveform workspace" className={`panel wfa-workspace${sidebarOpen ? '' : ' no-channels'}`}>
          {sidebarOpen && (
            <ChannelList
              channels={channels}
              onHideAll={() => setAllChannels(false)}
              onShowAll={() => setAllChannels(true)}
              onToggleChannel={handleToggleChannel}
            />
          )}
          <div className="wfa-main">
            {channels.length === 0 ? (
              <>
                <div className="wfa-strip" role="toolbar" aria-label="Timeline view">
                  {channelToggle}
                  <span className="toolbar-spacer" />
                  {hud}
                </div>
                <AsyncState
                  centered
                  detail={busFilter === 'gpio'
                    ? 'Waiting for GPIO state transitions or edge events.'
                    : 'Drive traffic through an SPI, I2C, UART, GPIO or CAN host adapter, or run a scenario.'}
                  kind="empty"
                  title={busFilter === 'all' ? 'No bus traffic captured yet' : `No ${busFilter.toUpperCase()} traffic recorded`}
                />
              </>
            ) : visibleChannelCount === 0 ? (
              <>
                <div className="wfa-strip" role="toolbar" aria-label="Timeline view">
                  {channelToggle}
                  <span className="toolbar-spacer" />
                  {hud}
                </div>
                <AsyncState centered detail="Use the channel list to show at least one signal." kind="empty" title="All channels are hidden" />
              </>
            ) : (
              <WaveformTimeline
                channels={channels}
                cursorANs={cursorANs}
                cursorBNs={cursorBNs}
                focus={focus}
                maxTimeNs={maxTimeNs}
                minTimeNs={minTimeNs}
                onUpdateCursorA={setCursorANs}
                onUpdateCursorB={setCursorBNs}
                toolbarEnd={hud}
                toolbarStart={channelToggle}
              />
            )}
          </div>
        </section>

        <Panel
          className="wfa-packets-panel"
          flush
          icon={ListTree}
          meta={`${allPackets.length} frames · ${filteredTransactions.length} transactions`}
          title="Decoded packets"
        >
          {allPackets.length === 0
            ? <AsyncState kind="empty" title="No decoded frames" />
            : (
              <PacketTable
                isSelected={(packet) => packet.startTimeNs === cursorANs && packet.endTimeNs === cursorBNs}
                onSelect={selectPacket}
                packets={allPackets}
              />
            )}
        </Panel>
      </div>
    </div>
  )
}
