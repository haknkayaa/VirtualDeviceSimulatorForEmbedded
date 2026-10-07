import { useCallback, useEffect, useRef } from 'react'
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
}

export function formatFrequency(deltaNs: number): string {
  if (deltaNs <= 0) return '—'
  const freqHz = 1e9 / deltaNs

  if (freqHz >= 1e9 - 1e-3) return `${(freqHz / 1e9).toFixed(2)} GHz`
  if (freqHz >= 1e6 - 1e-3) return `${(freqHz / 1e6).toFixed(2)} MHz`
  if (freqHz >= 1e3 - 1e-3) return `${(freqHz / 1e3).toFixed(2)} kHz`
  return `${freqHz.toFixed(1)} Hz`
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
}: TimingCursorsProps) {
  const draggingRef = useRef<'A' | 'B' | null>(null)

  const handlePointerDown = (cursor: 'A' | 'B') => (e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    draggingRef.current = cursor
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }

  const handlePointerMove = useCallback((e: PointerEvent) => {
    if (!draggingRef.current) return
    const container = document.getElementById('waveform-timeline-canvas-container')
    if (!container) return
    const rect = container.getBoundingClientRect()
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left))
    const time = Math.max(0, Math.round(xToTime(x)))

    if (draggingRef.current === 'A') {
      onUpdateCursorA(time)
    } else if (draggingRef.current === 'B') {
      onUpdateCursorB(time)
    }
  }, [xToTime, onUpdateCursorA, onUpdateCursorB])

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

  return (
    <g className="waveform-timing-cursors">
      {/* Delta measurement region highlight if both cursors placed */}
      {xA !== null && xB !== null && (
        <rect
          className="waveform-cursor-delta-fill"
          fill="rgba(42, 203, 212, 0.08)"
          height={height}
          stroke="rgba(42, 203, 212, 0.2)"
          strokeDasharray="3 3"
          width={Math.abs(xB - xA)}
          x={Math.min(xA, xB)}
          y={0}
        />
      )}

      {/* Cursor A (Cyan) */}
      {xA !== null && xA >= 0 && xA <= width && (
        <g className="waveform-cursor waveform-cursor-a">
          <line
            stroke="#2acbd4"
            strokeWidth="1.5"
            x1={xA}
            x2={xA}
            y1={0}
            y2={height}
          />
          {/* Flag handle at top */}
          <g
            className="cursor-flag cursor-flag-a"
            onPointerDown={handlePointerDown('A')}
            style={{ cursor: 'ew-resize' }}
            transform={`translate(${xA}, 4)`}
          >
            <path
              d="M 0 0 L 28 0 L 28 14 L 6 14 L 0 20 Z"
              fill="#2acbd4"
            />
            <text
              fill="#06131e"
              fontSize="9"
              fontWeight="800"
              x="8"
              y="11"
            >
              A
            </text>
          </g>
          {/* Virtual time label */}
          <text
            className="cursor-time-label"
            fill="#2acbd4"
            fontSize="9"
            fontWeight="700"
            textAnchor="middle"
            x={xA}
            y={height - 6}
          >
            {formatVirtualTime(cursorANs!)}
          </text>
        </g>
      )}

      {/* Cursor B (Amber) */}
      {xB !== null && xB >= 0 && xB <= width && (
        <g className="waveform-cursor waveform-cursor-b">
          <line
            stroke="#f2a93b"
            strokeWidth="1.5"
            x1={xB}
            x2={xB}
            y1={0}
            y2={height}
          />
          {/* Flag handle at top */}
          <g
            className="cursor-flag cursor-flag-b"
            onPointerDown={handlePointerDown('B')}
            style={{ cursor: 'ew-resize' }}
            transform={`translate(${xB}, 4)`}
          >
            <path
              d="M 0 0 L 28 0 L 28 14 L 6 14 L 0 20 Z"
              fill="#f2a93b"
            />
            <text
              fill="#06131e"
              fontSize="9"
              fontWeight="800"
              x="8"
              y="11"
            >
              B
            </text>
          </g>
          {/* Virtual time label */}
          <text
            className="cursor-time-label"
            fill="#f2a93b"
            fontSize="9"
            fontWeight="700"
            textAnchor="middle"
            x={xB}
            y={height - 6}
          >
            {formatVirtualTime(cursorBNs!)}
          </text>
        </g>
      )}
    </g>
  )
}
