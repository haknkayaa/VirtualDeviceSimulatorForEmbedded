import {
  Activity,
  Circle,
  Download,
  FileCode,
  FileSpreadsheet,
  Pause,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { useDevices } from '../../api/queries'
import { AsyncState } from '../../components/AsyncState'
import { GlassPanel } from '../../components/GlassPanel'
import { StatusBadge } from '../../components/StatusBadge'
import { useEventStore } from '../../stores/eventStore'
import { formatVirtualTime } from '../../utils/format'
import { buildLiveTransactions } from '../transactions/transactionModel'
import { ChannelList } from './ChannelList'
import { formatFrequency } from './frequency'
import { downloadFile, exportToCsv, exportToJson, exportToVcd } from './waveformExport'
import { synthesizeWaveforms } from './waveformSynthesizer'
import { WaveformTimeline } from './WaveformTimeline'

export function WaveformPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialTransactionId = searchParams.get('transaction')
  const initialBus = searchParams.get('bus') ?? 'all'
  const initialDevice = searchParams.get('device') ?? 'all'

  const devices = useDevices()
  const connectionStatus = useEventStore((state) => state.connectionStatus)
  const events = useEventStore((state) => state.events)
  const lastEventId = useEventStore((state) => state.lastEventId)

  // Filters and capture state
  const [busFilter, setBusFilter] = useState<string>(initialBus)
  const [deviceFilter, setDeviceFilter] = useState<string>(initialDevice)
  const [selectedTxnId, setSelectedTxnId] = useState<string | null>(initialTransactionId)
  const [pausedAtEventId, setPausedAtEventId] = useState<number | null>(null)
  const [clearedThroughEventId, setClearedThroughEventId] = useState<number>(0)
  const [sidebarOpen, setSidebarOpen] = useState(true)

  // Timing Cursors state
  const [cursorANs, setCursorANs] = useState<number | null>(null)
  const [cursorBNs, setCursorBNs] = useState<number | null>(null)

  // Channel visibility map
  const [channelVisibility, setChannelVisibility] = useState<Record<string, boolean>>({})

  // Update query params when filters change
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
    return events.filter(
      (e) => e.event_id <= cutoff && e.event_id > clearedThroughEventId,
    )
  }, [events, pausedAtEventId, lastEventId, clearedThroughEventId])

  const transactions = useMemo(
    () => buildLiveTransactions(visibleEvents, devices.data ?? []),
    [visibleEvents, devices.data],
  )

  const filteredTransactions = useMemo(() => {
    return transactions.filter((txn) => {
      if (busFilter !== 'all' && txn.busType.toLowerCase() !== busFilter.toLowerCase()) {
        return false
      }
      if (deviceFilter !== 'all' && txn.deviceId !== deviceFilter) {
        return false
      }
      if (selectedTxnId && txn.id !== selectedTxnId) {
        return false
      }
      return true
    })
  }, [transactions, busFilter, deviceFilter, selectedTxnId])

  // Synthesize digital waveform channels and decoded protocol packets
  const { channels: rawChannels, allPackets, minTimeNs, maxTimeNs } = useMemo(() => {
    return synthesizeWaveforms(filteredTransactions)
  }, [filteredTransactions])

  // Apply channel visibility overrides
  const channels = useMemo(() => {
    return rawChannels.map((c) => ({
      ...c,
      visible: channelVisibility[c.id] ?? true,
    }))
  }, [rawChannels, channelVisibility])

  const handleToggleChannel = (id: string) => {
    setChannelVisibility((prev) => {
      const current = prev[id] ?? true
      return { ...prev, [id]: !current }
    })
  }

  const handleShowAllChannels = () => {
    const updated: Record<string, boolean> = {}
    rawChannels.forEach((c) => {
      updated[c.id] = true
    })
    setChannelVisibility(updated)
  }

  const handleHideAllChannels = () => {
    const updated: Record<string, boolean> = {}
    rawChannels.forEach((c) => {
      updated[c.id] = false
    })
    setChannelVisibility(updated)
  }

  // Delta calculation
  const deltaNs =
    cursorANs !== null && cursorBNs !== null ? Math.abs(cursorBNs - cursorANs) : null

  // Export handlers
  const handleExportVcd = () => {
    const vcd = exportToVcd(channels)
    downloadFile(vcd, `vds4e-waveform-${Date.now()}.vcd`, 'text/plain')
  }

  const handleExportCsv = () => {
    const csv = exportToCsv(channels)
    downloadFile(csv, `vds4e-waveform-${Date.now()}.csv`, 'text/csv')
  }

  const handleExportJson = () => {
    const json = exportToJson(channels, allPackets, {
      busFilter,
      deviceFilter,
      transactionCount: filteredTransactions.length,
    })
    downloadFile(json, `vds4e-waveform-${Date.now()}.json`, 'application/json')
  }

  const handleClearCapture = () => {
    setClearedThroughEventId(lastEventId)
    setSelectedTxnId(null)
    setCursorANs(null)
    setCursorBNs(null)
  }

  return (
    <div className="dashboard-console waveform-analyzer-page">
      {/* Top Capture & Control Bar */}
      <section className="dashboard-capture-bar waveform-header-bar">
        <div className="waveform-header-meta">
          <h1>Logic Analyzer & Waveforms</h1>
          <small>Interactive digital waveforms, protocol decoding, and timing measurements</small>
        </div>

        <div className="dashboard-capture-actions">
          <StatusBadge status={connectionStatus} />

          <button
            className={capturing ? 'capture-active' : ''}
            onClick={() => setPausedAtEventId(null)}
            type="button"
          >
            <Circle fill="currentColor" size={11} />
            {capturing ? 'Capturing' : 'Resume'}
          </button>

          <button
            disabled={!capturing}
            onClick={() => setPausedAtEventId(lastEventId)}
            type="button"
          >
            <Pause size={13} /> Pause
          </button>

          {/* Export Dropdown Group */}
          <div className="waveform-export-dropdown-group">
            <button
              disabled={channels.length === 0}
              onClick={handleExportVcd}
              title="Export standard IEEE 1364 Value Change Dump (VCD) for GTKWave / Sigrok / PulseView"
              type="button"
            >
              <FileCode size={13} /> VCD
            </button>
            <button
              disabled={channels.length === 0}
              onClick={handleExportCsv}
              title="Export waveform transitions and protocol packets to CSV"
              type="button"
            >
              <FileSpreadsheet size={13} /> CSV
            </button>
            <button
              disabled={channels.length === 0}
              onClick={handleExportJson}
              title="Export complete waveform data to JSON"
              type="button"
            >
              <Download size={13} /> JSON
            </button>
          </div>

          <button
            disabled={transactions.length === 0}
            onClick={handleClearCapture}
            type="button"
          >
            <Trash2 size={13} /> Clear
          </button>
        </div>
      </section>

      {/* Filter and Timing Cursors HUD Bar */}
      <div className="waveform-subbar">
        <div className="waveform-filters-row">
          <label className="waveform-filter-label">
            <span>Bus:</span>
            <select
              aria-label="Filter by bus"
              onChange={(e) => setBusFilter(e.target.value)}
              value={busFilter}
            >
              <option value="all">All buses</option>
              <option value="spi">SPI</option>
              <option value="i2c">I2C</option>
              <option value="uart">UART</option>
              <option value="gpio">GPIO</option>
              <option value="can">CAN</option>
            </select>
          </label>

          <label className="waveform-filter-label">
            <span>Device:</span>
            <select
              aria-label="Filter by device"
              onChange={(e) => setDeviceFilter(e.target.value)}
              value={deviceFilter}
            >
              <option value="all">All devices</option>
              {devices.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name ?? d.id}
                </option>
              ))}
            </select>
          </label>

          {selectedTxnId && (
            <button
              className="waveform-pill-reset"
              onClick={() => setSelectedTxnId(null)}
              title="Show all transactions on timeline"
              type="button"
            >
              Locked: #{selectedTxnId} ✕
            </button>
          )}

          <button
            className={`waveform-sidebar-toggle-btn ${sidebarOpen ? 'active' : ''}`}
            onClick={() => setSidebarOpen((v) => !v)}
            title="Toggle channel list sidebar"
            type="button"
          >
            <SlidersHorizontal size={13} /> Channels
          </button>
        </div>

        {/* Delta Timing Measurement HUD */}
        <div className="waveform-timing-hud" role="region" aria-label="Timing cursors measurement">
          <div className="timing-hud-cursor cursor-hud-a">
            <span className="timing-cursor-badge badge-a">A</span>
            <strong>{cursorANs !== null ? formatVirtualTime(cursorANs) : '—'}</strong>
          </div>

          <div className="timing-hud-cursor cursor-hud-b">
            <span className="timing-cursor-badge badge-b">B</span>
            <strong>{cursorBNs !== null ? formatVirtualTime(cursorBNs) : '—'}</strong>
          </div>

          <div className="timing-hud-delta">
            <span>Δt:</span>
            <strong>{deltaNs !== null ? formatVirtualTime(deltaNs) : '—'}</strong>
            <small>({deltaNs !== null ? formatFrequency(deltaNs) : '—'})</small>
          </div>

          {(cursorANs !== null || cursorBNs !== null) && (
            <button
              className="waveform-timing-reset-btn"
              onClick={() => {
                setCursorANs(null)
                setCursorBNs(null)
              }}
              title="Clear timing cursors"
              type="button"
            >
              <RotateCcw size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Main Analyzer Workspace */}
      <div className="waveform-main-workspace">
        {sidebarOpen && (
          <ChannelList
            channels={channels}
            onHideAll={handleHideAllChannels}
            onShowAll={handleShowAllChannels}
            onToggleChannel={handleToggleChannel}
          />
        )}

        <div className="waveform-canvas-pane">
          {channels.length === 0 ? (
            <GlassPanel className="waveform-empty-panel">
              <AsyncState
                detail={
                  busFilter === 'gpio'
                    ? 'Waiting for GPIO state transitions or edge events.'
                    : 'Execute traffic on SPI, I2C, UART, GPIO, or CAN host adapters.'
                }
                kind="empty"
                title={
                  busFilter === 'all'
                    ? 'No bus traffic captured yet'
                    : `No ${busFilter.toUpperCase()} traffic recorded`
                }
              />
            </GlassPanel>
          ) : (
            <WaveformTimeline
              channels={channels}
              cursorANs={cursorANs}
              cursorBNs={cursorBNs}
              maxTimeNs={maxTimeNs}
              minTimeNs={minTimeNs}
              onUpdateCursorA={setCursorANs}
              onUpdateCursorB={setCursorBNs}
            />
          )}
        </div>
      </div>

      {/* Decoded Protocol Packets Table / Inspector */}
      {allPackets.length > 0 && (
        <section className="waveform-packets-section">
          <header className="waveform-packets-header">
            <div>
              <Activity size={14} />
              <strong>Decoded Protocol Packets ({allPackets.length})</strong>
            </div>
            <small>Click any packet to focus timeline cursor</small>
          </header>

          <div className="waveform-packets-table-frame">
            <table className="waveform-packets-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Bus</th>
                  <th>Device</th>
                  <th>Frame Type</th>
                  <th>Decoded Label</th>
                  <th>Hex Byte</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {allPackets.slice(0, 150).map((pkt) => (
                  <tr
                    className="waveform-packet-row"
                    key={pkt.id}
                    onClick={() => {
                      setCursorANs(pkt.startTimeNs)
                      setCursorBNs(pkt.endTimeNs)
                    }}
                    title="Set Timing Cursors A & B to this packet"
                  >
                    <td><time>{formatVirtualTime(pkt.startTimeNs)}</time></td>
                    <td><b className={`console-bus bus-${pkt.bus.toLowerCase()}`}>{pkt.bus.toUpperCase()}</b></td>
                    <td><strong>{pkt.deviceId}</strong></td>
                    <td><span className={`packet-type-pill type-${pkt.type}`}>{pkt.type.toUpperCase()}</span></td>
                    <td><strong className="packet-label-text">{pkt.label}</strong></td>
                    <td><code>{pkt.hex ? `0x${pkt.hex}` : '—'}</code></td>
                    <td><span className="packet-detail-text">{pkt.detail ?? '—'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
