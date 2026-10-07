import { Pause, Play } from 'lucide-react'

import type { EventConnectionStatus } from '../../types/events'

interface CaptureControlsProps {
  capturing: boolean
  connectionStatus: EventConnectionStatus
  /** Event id the capture currently ends at (live cursor or pause point). */
  cursor: number
  onResume: () => void
  onPause: () => void
}

/**
 * Shared capture state + run/pause control used by the Bus Analyzer and the
 * Logic Analyzer so both behave like one instrument family.
 */
export function CaptureControls({ capturing, connectionStatus, cursor, onResume, onPause }: CaptureControlsProps) {
  const streaming = connectionStatus === 'connected'
  const state = !capturing ? 'paused' : streaming ? 'live' : 'waiting'
  const label = state === 'paused' ? 'Paused' : state === 'live' ? 'Live' : 'No stream'
  return (
    <div className="anl-capture">
      <span className={`anl-capture-state ${state}`} title={`Capture ${label.toLowerCase()} at event #${cursor}`}>
        <span className={`status-dot ${state === 'live' ? 'live' : state === 'waiting' ? 'warn' : ''}`} />
        <span className="anl-capture-label">{label}</span>
        <span className="anl-capture-cursor">#{cursor}</span>
      </span>
      <div className="button-group">
        <button className="button button-sm" disabled={capturing} onClick={onResume} title="Resume live capture" type="button">
          <Play aria-hidden="true" size={12} /> Resume
        </button>
        <button className="button button-sm" disabled={!capturing} onClick={onPause} title="Freeze the capture at the current event" type="button">
          <Pause aria-hidden="true" size={12} /> Pause
        </button>
      </div>
    </div>
  )
}
