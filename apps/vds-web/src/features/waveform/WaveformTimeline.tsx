import {
  Download,
  Maximize2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import type { WheelEvent } from 'react'
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { formatVirtualTime } from '../../utils/format'
import { ProtocolDecoderBanner } from './ProtocolDecoderBanner'
import { TimingCursors } from './TimingCursors'
import type { WaveformChannel } from './types'

interface WaveformTimelineProps {
  channels: WaveformChannel[]
  minTimeNs: number
  maxTimeNs: number
  cursorANs: number | null
  cursorBNs: number | null
  onUpdateCursorA: (timeNs: number | null) => void
  onUpdateCursorB: (timeNs: number | null) => void
}

const CHANNEL_LABEL_WIDTH = 120
const RULER_HEIGHT = 28
const CHANNEL_HEIGHT = 56
const TRACE_AMPLITUDE = 24

export function WaveformTimeline({
  channels,
  minTimeNs,
  maxTimeNs,
  cursorANs,
  cursorBNs,
  onUpdateCursorA,
  onUpdateCursorB,
}: WaveformTimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [containerWidth, setContainerWidth] = useState(800)

  // Viewport time bounds
  const totalDurationNs = Math.max(maxTimeNs - minTimeNs, 1_000)
  const [viewStartNs, setViewStartNs] = useState(minTimeNs)
  const [viewEndNs, setViewEndNs] = useState(minTimeNs + totalDurationNs)

  // Track window resizing
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => setContainerWidth(Math.max(el.clientWidth, 400))
    update()
    if (typeof ResizeObserver === 'undefined') return
    const obs = new ResizeObserver(update)
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  // Reset the viewport when the captured time range changes. Adjusting state
  // during render (instead of in an effect) avoids a cascading extra render.
  const [syncedRange, setSyncedRange] = useState({ minTimeNs, maxTimeNs })
  if (syncedRange.minTimeNs !== minTimeNs || syncedRange.maxTimeNs !== maxTimeNs) {
    setSyncedRange({ minTimeNs, maxTimeNs })
    setViewStartNs(minTimeNs)
    setViewEndNs(Math.max(maxTimeNs, minTimeNs + 1_000))
  }

  const traceAreaWidth = Math.max(containerWidth - CHANNEL_LABEL_WIDTH, 200)
  const visibleDurationNs = Math.max(viewEndNs - viewStartNs, 10)

  // Coordinate mapping
  const timeToX = useCallback(
    (timeNs: number) => {
      const fraction = (timeNs - viewStartNs) / visibleDurationNs
      return CHANNEL_LABEL_WIDTH + fraction * traceAreaWidth
    },
    [viewStartNs, visibleDurationNs, traceAreaWidth],
  )

  const xToTime = useCallback(
    (x: number) => {
      const traceX = Math.max(0, x - CHANNEL_LABEL_WIDTH)
      const fraction = traceX / traceAreaWidth
      return viewStartNs + fraction * visibleDurationNs
    },
    [viewStartNs, visibleDurationNs, traceAreaWidth],
  )

  // Interactive Pan via mouse drag
  const isPanningRef = useRef(false)
  const panStartXRef = useRef(0)
  const panStartViewStartRef = useRef(0)
  const panStartViewEndRef = useRef(0)

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return // Left click only
    isPanningRef.current = true
    panStartXRef.current = e.clientX
    panStartViewStartRef.current = viewStartNs
    panStartViewEndRef.current = viewEndNs
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isPanningRef.current) return
    const dx = e.clientX - panStartXRef.current
    const dt = -(dx / traceAreaWidth) * visibleDurationNs
    const newStart = Math.max(0, panStartViewStartRef.current + dt)
    const newEnd = newStart + (panStartViewEndRef.current - panStartViewStartRef.current)
    setViewStartNs(newStart)
    setViewEndNs(newEnd)
  }

  const handlePointerUp = () => {
    isPanningRef.current = false
  }

  // Zoom handling: mouse wheel
  const handleWheel = (e: WheelEvent<HTMLDivElement>) => {
    e.preventDefault()
    const container = containerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const cursorTime = xToTime(mouseX)

    const zoomFactor = e.deltaY < 0 ? 0.75 : 1.33
    const newDuration = Math.max(10, Math.min(totalDurationNs * 5, visibleDurationNs * zoomFactor))
    const mouseFraction = Math.max(0, Math.min(1, (mouseX - CHANNEL_LABEL_WIDTH) / traceAreaWidth))

    const newStart = Math.max(0, cursorTime - mouseFraction * newDuration)
    const newEnd = newStart + newDuration

    setViewStartNs(newStart)
    setViewEndNs(newEnd)
  }

  // Quick zoom buttons
  const zoomIn = () => {
    const center = (viewStartNs + viewEndNs) / 2
    const newDuration = Math.max(20, visibleDurationNs * 0.6)
    setViewStartNs(Math.max(0, center - newDuration / 2))
    setViewEndNs(center + newDuration / 2)
  }

  const zoomOut = () => {
    const center = (viewStartNs + viewEndNs) / 2
    const newDuration = visibleDurationNs * 1.6
    setViewStartNs(Math.max(0, center - newDuration / 2))
    setViewEndNs(center + newDuration / 2)
  }

  const zoomFit = () => {
    setViewStartNs(minTimeNs)
    setViewEndNs(Math.max(maxTimeNs, minTimeNs + 1_000))
  }

  // Ruler ticks calculation
  const rulerTicks = useMemo(() => {
    const targetTickCount = Math.max(4, Math.floor(traceAreaWidth / 110))
    const rawStep = visibleDurationNs / targetTickCount
    const magnitude = 10 ** Math.floor(Math.log10(rawStep))
    const normalized = rawStep / magnitude
    let step = magnitude
    if (normalized >= 5) step = magnitude * 5
    else if (normalized >= 2) step = magnitude * 2

    const firstTick = Math.ceil(viewStartNs / step) * step
    const ticks: { timeNs: number; x: number; label: string }[] = []

    for (let t = firstTick; t <= viewEndNs; t += step) {
      ticks.push({
        timeNs: t,
        x: timeToX(t),
        label: formatVirtualTime(t),
      })
    }
    return ticks
  }, [visibleDurationNs, viewStartNs, viewEndNs, traceAreaWidth, timeToX])

  const visibleChannels = channels.filter((c) => c.visible)
  const totalSvgHeight = RULER_HEIGHT + visibleChannels.length * CHANNEL_HEIGHT + 16

  // Download snapshot
  const downloadPngSnapshot = () => {
    const svgEl = svgRef.current
    if (!svgEl) return
    const clone = svgEl.cloneNode(true) as SVGSVGElement
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    clone.setAttribute('width', String(containerWidth))
    clone.setAttribute('height', String(totalSvgHeight))

    const blob = new Blob([new XMLSerializer().serializeToString(clone)], {
      type: 'image/svg+xml;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = containerWidth * 2
      canvas.height = totalSvgHeight * 2
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.scale(2, 2)
      ctx.drawImage(img, 0, 0, containerWidth, totalSvgHeight)
      canvas.toBlob((pngBlob) => {
        if (!pngBlob) return
        const a = document.createElement('a')
        a.href = URL.createObjectURL(pngBlob)
        a.download = `vds4e-waveform-${Date.now()}.png`
        a.click()
        URL.revokeObjectURL(a.href)
      }, 'image/png')
      URL.revokeObjectURL(url)
    }
    img.src = url
  }

  return (
    <div className="waveform-timeline-root">
      {/* Waveform Controls Toolbar */}
      <div className="waveform-controls-bar">
        <div className="waveform-zoom-group">
          <button
            className="waveform-tool-btn"
            onClick={zoomIn}
            title="Zoom In (Scroll Up)"
            type="button"
          >
            <ZoomIn size={14} /> Zoom In
          </button>
          <button
            className="waveform-tool-btn"
            onClick={zoomOut}
            title="Zoom Out (Scroll Down)"
            type="button"
          >
            <ZoomOut size={14} /> Zoom Out
          </button>
          <button
            className="waveform-tool-btn"
            onClick={zoomFit}
            title="Fit to Total Capture Range"
            type="button"
          >
            <Maximize2 size={14} /> Fit
          </button>
        </div>

        <div className="waveform-time-window-display">
          <span>Window: <strong>{formatVirtualTime(visibleDurationNs)}</strong></span>
          <span>From: <strong>{formatVirtualTime(viewStartNs)}</strong></span>
          <span>To: <strong>{formatVirtualTime(viewEndNs)}</strong></span>
        </div>

        <div className="waveform-export-group">
          <button
            className="waveform-tool-btn"
            onClick={downloadPngSnapshot}
            title="Download visible waveform as PNG image"
            type="button"
          >
            <Download size={14} /> PNG Snapshot
          </button>
        </div>
      </div>

      {/* Main Waveform Canvas Viewport */}
      <div
        className="waveform-timeline-canvas-container"
        id="waveform-timeline-canvas-container"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
        ref={containerRef}
      >
        <svg
          aria-label="Digital waveform timing diagram"
          className="waveform-timeline-svg"
          height={totalSvgHeight}
          ref={svgRef}
          role="img"
          viewBox={`0 0 ${containerWidth} ${totalSvgHeight}`}
          width={containerWidth}
        >
          {/* Background */}
          <rect
            className="waveform-svg-background"
            fill="#06131e"
            height={totalSvgHeight}
            width={containerWidth}
          />

          {/* Time Grid Lines */}
          <g className="waveform-grid-lines">
            {rulerTicks.map((tick) => (
              <line
                key={`grid-${tick.timeNs}`}
                stroke="rgba(76, 137, 171, 0.15)"
                strokeDasharray="2 3"
                strokeWidth="1"
                x1={tick.x}
                x2={tick.x}
                y1={RULER_HEIGHT}
                y2={totalSvgHeight}
              />
            ))}
          </g>

          {/* Time Ruler at Top */}
          <g className="waveform-time-ruler">
            <rect
              fill="#091b2b"
              height={RULER_HEIGHT}
              stroke="rgba(77, 178, 220, 0.2)"
              strokeWidth="1"
              width={containerWidth}
              x={0}
              y={0}
            />
            {rulerTicks.map((tick) => (
              <g key={`tick-${tick.timeNs}`}>
                <line
                  stroke="#4cb4db"
                  strokeWidth="1.2"
                  x1={tick.x}
                  x2={tick.x}
                  y1={RULER_HEIGHT - 6}
                  y2={RULER_HEIGHT}
                />
                <text
                  fill="#8db4ce"
                  fontSize="9"
                  fontWeight="600"
                  textAnchor="middle"
                  x={tick.x}
                  y={RULER_HEIGHT - 10}
                >
                  {tick.label}
                </text>
              </g>
            ))}
          </g>

          {/* Channel Waveform Rows */}
          <g className="waveform-channels-group" transform={`translate(0, ${RULER_HEIGHT})`}>
            {visibleChannels.map((channel, idx) => {
              const rowY = idx * CHANNEL_HEIGHT
              const highY = rowY + 12
              const lowY = rowY + 12 + TRACE_AMPLITUDE

              // Generate SVG path for square wave
              let pathStr = ''
              if (channel.samples.length > 0) {
                // Find initial value
                let currentY = channel.samples[0].value === 1 ? highY : lowY
                const startX = Math.max(CHANNEL_LABEL_WIDTH, timeToX(channel.samples[0].timeNs))

                pathStr = `M ${startX} ${currentY}`

                for (let i = 1; i < channel.samples.length; i++) {
                  const s = channel.samples[i]
                  const nextX = Math.max(CHANNEL_LABEL_WIDTH, Math.min(containerWidth, timeToX(s.timeNs)))
                  const nextY = s.value === 1 ? highY : lowY

                  // Horizontal line to transition point
                  pathStr += ` L ${nextX} ${currentY}`
                  // Vertical transition
                  if (nextY !== currentY) {
                    pathStr += ` L ${nextX} ${nextY}`
                  }

                  currentY = nextY
                }

                // Extend to right edge of trace area
                pathStr += ` L ${containerWidth} ${currentY}`
              }

              return (
                <g className="waveform-channel-row" key={channel.id}>
                  {/* Row background striping */}
                  <rect
                    fill={idx % 2 === 0 ? 'rgba(8, 26, 40, 0.4)' : 'rgba(4, 16, 26, 0.2)'}
                    height={CHANNEL_HEIGHT}
                    stroke="rgba(77, 178, 220, 0.08)"
                    strokeWidth="1"
                    width={containerWidth}
                    x={0}
                    y={rowY}
                  />

                  {/* Channel Label Sidebar Dock */}
                  <g className="waveform-channel-dock" transform={`translate(0, ${rowY})`}>
                    <rect
                      fill="#071926"
                      height={CHANNEL_HEIGHT}
                      stroke="rgba(77, 178, 220, 0.15)"
                      strokeWidth="1"
                      width={CHANNEL_LABEL_WIDTH}
                      x={0}
                      y={0}
                    />
                    <circle
                      cx="14"
                      cy="22"
                      fill={channel.color}
                      r="4"
                    />
                    <text
                      fill="#ffffff"
                      fontSize="11"
                      fontWeight="700"
                      x="26"
                      y="26"
                    >
                      {channel.name}
                    </text>
                    <text
                      fill="#6488a0"
                      fontSize="8"
                      x="26"
                      y="40"
                    >
                      {`${channel.bus.toUpperCase()} · ${channel.pinType}`}
                    </text>
                  </g>

                  {/* Waveform Trace */}
                  <path
                    d={pathStr}
                    fill="none"
                    stroke={channel.color}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.8"
                  />

                  {/* Decoded Protocol Banner above / within the lane */}
                  {channel.packets.length > 0 && (
                    <ProtocolDecoderBanner
                      height={15}
                      packets={channel.packets}
                      timeToX={timeToX}
                      visibleEndNs={viewEndNs}
                      visibleStartNs={viewStartNs}
                      y={rowY + TRACE_AMPLITUDE + 14}
                    />
                  )}
                </g>
              )
            })}
          </g>

          {/* Interactive Timing Cursors */}
          <TimingCursors
            cursorANs={cursorANs}
            cursorBNs={cursorBNs}
            height={totalSvgHeight}
            onUpdateCursorA={onUpdateCursorA}
            onUpdateCursorB={onUpdateCursorB}
            timeToX={timeToX}
            width={containerWidth}
            xToTime={xToTime}
          />
        </svg>
      </div>
    </div>
  )
}
