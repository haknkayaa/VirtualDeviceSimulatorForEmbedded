import { useCallback, useEffect, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

import { formatVirtualTime } from '../../utils/format'

interface TimingCursorsProps {
  cursorANs: number | null
  cursorBNs: number | null
  onUpdateCursorA: (timeNs: number | null) => void
  onUpdateCursorB: (timeNs: number | null) => void
  timeToX: (timeNs: number) => number
  xToTime: (x: number) => number
  height: number
  width: number
  /** Left edge of the trace area; cursors are not drawn over the label dock. */
  minX?: number
}

function Cursor({
  id,
  timeNs,
  x,
  height,
  onBeginDrag,
}: {
  id: 'A' | 'B'
  timeNs: number
  x: number
  height: number
  onBeginDrag: (cursor: 'A' | 'B', event: ReactPointerEvent<SVGGElement>) => void
}) {
  return (
    <g className={`wfa-cursor wfa-cursor-${id.toLowerCase()}`}>
      <line x1={x} x2={x} y1={0} y2={height} />
      <g
        className="wfa-cursor-flag"
        onPointerDown={(event) => onBeginDrag(id, event)}
        transform={`translate(${x}, 2)`}
      >
        <title>{`Cursor ${id} · drag to move`}</title>
        <path d="M 0 0 L 16 0 L 16 13 L 5 13 L 0 18 Z" />
        <text x="5" y="10">{id}</text>
      </g>
      <text className="wfa-cursor-time" textAnchor="middle" x={x} y={height - 4}>{formatVirtualTime(timeNs)}</text>
    </g>
  )
}

export function TimingCursors({
  cursorANs,
  cursorBNs,
  onUpdateCursorA,
  onUpdateCursorB,
  timeToX,
  xToTime,
  height,
  width,
  minX = 0,
}: TimingCursorsProps) {
  const draggingRef = useRef<'A' | 'B' | null>(null)

  const beginDrag = (cursor: 'A' | 'B', event: ReactPointerEvent<SVGGElement>) => {
    event.stopPropagation()
    event.preventDefault()
    draggingRef.current = cursor
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = useCallback((event: PointerEvent) => {
    if (!draggingRef.current) return
    const container = document.getElementById('waveform-timeline-canvas-container')
    if (!container) return
    const rect = container.getBoundingClientRect()
    const x = Math.max(minX, Math.min(rect.width, event.clientX - rect.left))
    const time = Math.max(0, Math.round(xToTime(x)))
    if (draggingRef.current === 'A') onUpdateCursorA(time)
    else onUpdateCursorB(time)
  }, [minX, xToTime, onUpdateCursorA, onUpdateCursorB])

  const handlePointerUp = useCallback(() => {
    draggingRef.current = null
  }, [])

  useEffect(() => {
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [handlePointerMove, handlePointerUp])

  const xA = cursorANs !== null ? timeToX(cursorANs) : null
  const xB = cursorBNs !== null ? timeToX(cursorBNs) : null
  const inView = (x: number | null): x is number => x !== null && x >= minX && x <= width

  return (
    <g className="wfa-cursors">
      {xA !== null && xB !== null && (
        <rect
          className="wfa-cursor-span"
          height={height}
          width={Math.max(0, Math.min(width, Math.max(xA, xB)) - Math.max(minX, Math.min(xA, xB)))}
          x={Math.max(minX, Math.min(xA, xB))}
          y={0}
        />
      )}
      {inView(xA) && cursorANs !== null && <Cursor height={height} id="A" onBeginDrag={beginDrag} timeNs={cursorANs} x={xA} />}
      {inView(xB) && cursorBNs !== null && <Cursor height={height} id="B" onBeginDrag={beginDrag} timeNs={cursorBNs} x={xB} />}
    </g>
  )
}
