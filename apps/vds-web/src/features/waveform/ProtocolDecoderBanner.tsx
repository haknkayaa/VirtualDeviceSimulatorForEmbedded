import { formatVirtualTime } from '../../utils/format'
import type { ProtocolPacket } from './types'

interface ProtocolDecoderBannerProps {
  packets: ProtocolPacket[]
  timeToX: (timeNs: number) => number
  y: number
  height?: number
  visibleStartNs: number
  visibleEndNs: number
}

/**
 * Decoded protocol cells drawn under a channel trace. Colour encodes the frame
 * kind through CSS (.wfa-pkt-<type>); framing is neutral, data takes the bus
 * colour, ACK/NACK/error use state colours.
 */
export function ProtocolDecoderBanner({
  packets,
  timeToX,
  y,
  height = 14,
  visibleStartNs,
  visibleEndNs,
}: ProtocolDecoderBannerProps) {
  const halfHeight = height / 2
  return (
    <g className="wfa-decoder" transform={`translate(0, ${y})`}>
      {packets.map((packet) => {
        if (packet.endTimeNs < visibleStartNs || packet.startTimeNs > visibleEndNs) return null
        const x1 = Math.max(0, timeToX(packet.startTimeNs))
        const x2 = Math.max(x1 + 4, timeToX(packet.endTimeNs))
        const width = Math.max(10, x2 - x1)
        const bevel = Math.min(4, width / 4)
        const points = [
          `${x1},${halfHeight}`,
          `${x1 + bevel},0`,
          `${x1 + width - bevel},0`,
          `${x1 + width},${halfHeight}`,
          `${x1 + width - bevel},${height}`,
          `${x1 + bevel},${height}`,
        ].join(' ')
        // ~5.6px per glyph at the 9px mono label size: fall back to the hex byte,
        // then to nothing, rather than spilling text over neighbouring cells.
        const fits = (text: string) => text.length * 5.6 <= width - 6
        const label = fits(packet.label) ? packet.label : packet.hex && fits(packet.hex) ? packet.hex : null
        return (
          <g className={`wfa-pkt wfa-pkt-${packet.type}`} key={packet.id}>
            <polygon points={points} />
            {label && <text textAnchor="middle" x={x1 + width / 2} y={halfHeight + 3}>{label}</text>}
            <title>
              {`${packet.label}\nType: ${packet.type.toUpperCase()}\n${packet.detail ? `${packet.detail}\n` : ''}Time: ${formatVirtualTime(packet.startTimeNs)} – ${formatVirtualTime(packet.endTimeNs)} (Δ ${formatVirtualTime(packet.endTimeNs - packet.startTimeNs)})`}
            </title>
          </g>
        )
      })}
    </g>
  )
}
