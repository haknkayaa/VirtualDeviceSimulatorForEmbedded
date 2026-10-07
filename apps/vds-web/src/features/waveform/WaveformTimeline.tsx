import { Download, Maximize2, ZoomIn, ZoomOut } from 'lucide-react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { formatVirtualTime } from '../../utils/format'
import { downloadSvgRegionAsPng } from '../transactions/svgSnapshot'
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
  /** Bring a time span into view (e.g. a packet picked in the table); `seq` re-triggers. */
  focus?: { startNs: number; endNs: number; seq: number } | null
  /** Toolbar content before the zoom controls (e.g. the channel-pane toggle). */
  toolbarStart?: ReactNode
  /** Toolbar content after the zoom/window readouts (e.g. the cursor HUD). */
  toolbarEnd?: ReactNode
}

const CHANNEL_LABEL_WIDTH = 132
const RULER_HEIGHT = 24
const CHANNEL_HEIGHT = 48
const TRACE_TOP = 8
const TRACE_AMPLITUDE = 18
const BANNER_OFFSET = TRACE_TOP + TRACE_AMPLITUDE + 4
const BANNER_HEIGHT = 13
const CLICK_SLOP_PX = 3

export function WaveformTimeline({
  channels,
  minTimeNs,
  maxTimeNs,
  cursorANs,
  cursorBNs,
  onUpdateCursorA,
  onUpdateCursorB,
  focus,
  toolbarStart,
  toolbarEnd,
}: WaveformTimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [containerWidth, setContainerWidth] = useState(800)

  // Viewport time bounds
  const totalDurationNs = Math.max(maxTimeNs - minTimeNs, 1_000)
  const [viewStartNs, setViewStartNs] = useState(minTimeNs)
  const [viewEndNs, setViewEndNs] = useState(minTimeNs + totalDurationNs)

  useLayoutEffect(() => {
    const element = containerRef.current
    if (!element) return
    const update = () => setContainerWidth(Math.max(element.clientWidth, 400))
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // Reset the viewport when the captured time range changes. Adjusting state
  // during render (instead of in an effect) avoids a cascading extra render.
  const [syncedRange, setSyncedRange] = useState({ minTimeNs, maxTimeNs })
  if (syncedRange.minTimeNs !== minTimeNs || syncedRange.maxTimeNs !== maxTimeNs) {
    setSyncedRange({ minTimeNs, maxTimeNs })
    setViewStartNs(minTimeNs)
    setViewEndNs(Math.max(maxTimeNs, minTimeNs + 1_000))
  }

  // Zoom onto a focused span (packet selection) once per request, with context
  // on both sides so neighbouring frames stay visible.
  const [appliedFocusSeq, setAppliedFocusSeq] = useState<number | null>(null)
  if (focus && focus.seq !== appliedFocusSeq) {
    setAppliedFocusSeq(focus.seq)
    const span = Math.max(focus.endNs - focus.startNs, 10)
    const windowNs = Math.max(span * 10, 2_000)
    const center = (focus.startNs + focus.endNs) / 2
    const start = Math.max(0, center - windowNs / 2)
    setViewStartNs(start)
    setViewEndNs(start + windowNs)
  }

  const traceAreaWidth = Math.max(containerWidth - CHANNEL_LABEL_WIDTH, 200)
  const visibleDurationNs = Math.max(viewEndNs - viewStartNs, 10)

  const timeToX = useCallback(
    (timeNs: number) => CHANNEL_LABEL_WIDTH + ((timeNs - viewStartNs) / visibleDurationNs) * traceAreaWidth,
    [viewStartNs, visibleDurationNs, traceAreaWidth],
  )

  const xToTime = useCallback(
    (x: number) => viewStartNs + (Math.max(0, x - CHANNEL_LABEL_WIDTH) / traceAreaWidth) * visibleDurationNs,
    [viewStartNs, visibleDurationNs, traceAreaWidth],
  )

  // Drag to pan; a click without movement places cursor A (Shift: cursor B).
  const panRef = useRef<{ x: number; start: number; end: number; moved: boolean } | null>(null)

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    panRef.current = { x: event.clientX, start: viewStartNs, end: viewEndNs, moved: false }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pan = panRef.current
    if (!pan) return
    const dx = event.clientX - pan.x
    if (!pan.moved && Math.abs(dx) < CLICK_SLOP_PX) return
    pan.moved = true
    const dt = -(dx / traceAreaWidth) * visibleDurationNs
    const newStart = Math.max(0, pan.start + dt)
    setViewStartNs(newStart)
    setViewEndNs(newStart + (pan.end - pan.start))
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pan = panRef.current
    panRef.current = null
    if (!pan || pan.moved) return
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left
    if (x < CHANNEL_LABEL_WIDTH) return
    const time = Math.max(0, Math.round(xToTime(x)))
    if (event.shiftKey) onUpdateCursorB(time)
    else onUpdateCursorA(time)
  }

  const handleWheel = (event: WheelEvent) => {
    const container = containerRef.current
    if (!container) return
    event.preventDefault()
    if (event.shiftKey) {
      // Shift+wheel scrolls through channels instead of zooming time.
      container.scrollTop += event.deltaY || event.deltaX
      return
    }
    const rect = container.getBoundingClientRect()
    const mouseX = event.clientX - rect.left
    const cursorTime = xToTime(mouseX)
    const zoomFactor = event.deltaY < 0 ? 0.75 : 1.33
    const newDuration = Math.max(10, Math.min(totalDurationNs * 5, visibleDurationNs * zoomFactor))
    const mouseFraction = Math.max(0, Math.min(1, (mouseX - CHANNEL_LABEL_WIDTH) / traceAreaWidth))
    const newStart = Math.max(0, cursorTime - mouseFraction * newDuration)
    setViewStartNs(newStart)
    setViewEndNs(newStart + newDuration)
  }

  // React registers wheel listeners as passive; zooming must cancel the native
  // scroll, so attach a non-passive listener that calls the latest handler.
  const wheelHandlerRef = useRef(handleWheel)
  useLayoutEffect(() => {
    wheelHandlerRef.current = handleWheel
  })
  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const listener = (event: WheelEvent) => wheelHandlerRef.current(event)
    element.addEventListener('wheel', listener, { passive: false })
    return () => element.removeEventListener('wheel', listener)
  }, [])

  const zoomBy = (factor: number) => {
    const center = (viewStartNs + viewEndNs) / 2
    const newDuration = Math.max(20, visibleDurationNs * factor)
    setViewStartNs(Math.max(0, center - newDuration / 2))
    setViewEndNs(center + newDuration / 2)
  }

  const zoomFit = () => {
    setViewStartNs(minTimeNs)
    setViewEndNs(Math.max(maxTimeNs, minTimeNs + 1_000))
  }

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
      ticks.push({ timeNs: t, x: timeToX(t), label: formatVirtualTime(t) })
    }
    return ticks
  }, [visibleDurationNs, viewStartNs, viewEndNs, traceAreaWidth, timeToX])

  const visibleChannels = channels.filter((channel) => channel.visible)
  const totalSvgHeight = RULER_HEIGHT + visibleChannels.length * CHANNEL_HEIGHT + 14

  const downloadPngSnapshot = () => {
    const svg = svgRef.current
    if (!svg) return
    downloadSvgRegionAsPng(svg, { x: 0, width: containerWidth, height: totalSvgHeight }, `vds4e-waveform-${Date.now()}.png`)
  }

  return (
    <div className="wfa-timeline">
      <div className="wfa-strip" role="toolbar" aria-label="Timeline view">
        {toolbarStart}
        <div className="button-group">
          <button aria-label="Zoom in" className="button button-sm" onClick={() => zoomBy(0.6)} title="Zoom in (wheel up)" type="button"><ZoomIn aria-hidden="true" size={12} /></button>
          <button aria-label="Zoom out" className="button button-sm" onClick={() => zoomBy(1.6)} title="Zoom out (wheel down)" type="button"><ZoomOut aria-hidden="true" size={12} /></button>
          <button className="button button-sm" onClick={zoomFit} title="Fit the whole capture" type="button"><Maximize2 aria-hidden="true" size={12} /> Fit</button>
        </div>
        <dl className="wfa-window">
          <div><dt>Window</dt><dd>{formatVirtualTime(visibleDurationNs)}</dd></div>
          <div><dt>From</dt><dd>{formatVirtualTime(viewStartNs)}</dd></div>
          <div><dt>To</dt><dd>{formatVirtualTime(viewEndNs)}</dd></div>
        </dl>
        <span className="toolbar-spacer" />
        {toolbarEnd}
        <button aria-label="Download visible waveform as PNG" className="icon-button sm" onClick={downloadPngSnapshot} title="Download visible waveform as PNG" type="button">
          <Download aria-hidden="true" size={13} />
        </button>
      </div>

      <div
        className="wfa-canvas"
        id="waveform-timeline-canvas-container"
        onPointerCancel={() => { panRef.current = null }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        ref={containerRef}
        title="Click: cursor A · Shift+click: cursor B · Drag: pan · Wheel: zoom · Shift+wheel: scroll"
      >
        <svg
          aria-label="Digital waveform timing diagram"
          className="wfa-svg"
          height={totalSvgHeight}
          ref={svgRef}
          role="img"
          viewBox={`0 0 ${containerWidth} ${totalSvgHeight}`}
          width={containerWidth}
        >
          <rect className="wfa-bg" height={totalSvgHeight} width={containerWidth} />

          <g className="wfa-grid">
            {rulerTicks.map((tick) => (
              <line key={`grid-${tick.timeNs}`} x1={tick.x} x2={tick.x} y1={RULER_HEIGHT} y2={totalSvgHeight} />
            ))}
          </g>

          <g className="wfa-channels" transform={`translate(0, ${RULER_HEIGHT})`}>
            {visibleChannels.map((channel, index) => {
              const rowY = index * CHANNEL_HEIGHT
              const highY = rowY + TRACE_TOP
              const lowY = highY + TRACE_AMPLITUDE

              let trace = ''
              let highFill = ''
              if (channel.samples.length > 0) {
                let currentY = channel.samples[0].value === 1 ? highY : lowY
                let segmentStart = Math.max(CHANNEL_LABEL_WIDTH, timeToX(channel.samples[0].timeNs))
                trace = `M ${segmentStart} ${currentY}`
                for (let sampleIndex = 1; sampleIndex < channel.samples.length; sampleIndex += 1) {
                  const sample = channel.samples[sampleIndex]
                  const nextX = Math.max(CHANNEL_LABEL_WIDTH, Math.min(containerWidth, timeToX(sample.timeNs)))
                  const nextY = sample.value === 1 ? highY : lowY
                  trace += ` L ${nextX} ${currentY}`
                  if (nextY !== currentY) {
                    if (currentY === highY && nextX > segmentStart) {
                      highFill += `M ${segmentStart} ${highY} H ${nextX} V ${lowY} H ${segmentStart} Z `
                    }
                    trace += ` L ${nextX} ${nextY}`
                    segmentStart = nextX
                  }
                  currentY = nextY
                }
                trace += ` L ${containerWidth} ${currentY}`
                if (currentY === highY && containerWidth > segmentStart) {
                  highFill += `M ${segmentStart} ${highY} H ${containerWidth} V ${lowY} H ${segmentStart} Z`
                }
              }

              return (
                <g className={`wfa-row bus-${channel.bus.toLowerCase()}`} key={channel.id}>
                  <rect className={index % 2 === 0 ? 'wfa-row-bg' : 'wfa-row-bg alt'} height={CHANNEL_HEIGHT} width={containerWidth} y={rowY} />
                  <line className="wfa-row-rule" x1={0} x2={containerWidth} y1={rowY + CHANNEL_HEIGHT} y2={rowY + CHANNEL_HEIGHT} />
                  {highFill && <path className="wfa-high" d={highFill} />}
                  <path className="wfa-trace" d={trace} />
                  {channel.packets.length > 0 && (
                    <ProtocolDecoderBanner
                      height={BANNER_HEIGHT}
                      packets={channel.packets}
                      timeToX={timeToX}
                      visibleEndNs={viewEndNs}
                      visibleStartNs={viewStartNs}
                      y={rowY + BANNER_OFFSET}
                    />
                  )}
                  <g className="wfa-dock" transform={`translate(0, ${rowY})`}>
                    <rect className="wfa-dock-bg" height={CHANNEL_HEIGHT} width={CHANNEL_LABEL_WIDTH} />
                    <rect className="wfa-dock-mark" height={CHANNEL_HEIGHT - 12} width={2} x={0} y={6} />
                    <text className="wfa-dock-name" x={10} y={20}>{channel.name}</text>
                    <text className="wfa-dock-meta" x={10} y={34}>{`${channel.bus.toUpperCase()} · ${channel.pinType}`}</text>
                  </g>
                </g>
              )
            })}
          </g>

          <g className="wfa-ruler">
            <rect className="wfa-ruler-bg" height={RULER_HEIGHT} width={containerWidth} />
            <rect className="wfa-ruler-corner" height={RULER_HEIGHT} width={CHANNEL_LABEL_WIDTH} />
            <text className="wfa-ruler-unit" x={10} y={RULER_HEIGHT - 8}>virtual time</text>
            {rulerTicks.map((tick) => (
              <g key={`tick-${tick.timeNs}`}>
                <line x1={tick.x} x2={tick.x} y1={RULER_HEIGHT - 5} y2={RULER_HEIGHT} />
                {tick.x > CHANNEL_LABEL_WIDTH + 24 && <text x={tick.x} y={RULER_HEIGHT - 9}>{tick.label}</text>}
              </g>
            ))}
          </g>

          <TimingCursors
            cursorANs={cursorANs}
            cursorBNs={cursorBNs}
            height={totalSvgHeight}
            minX={CHANNEL_LABEL_WIDTH}
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
