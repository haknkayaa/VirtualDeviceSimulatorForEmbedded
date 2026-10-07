import { useState } from 'react'
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

function packetColors(type: ProtocolPacket['type']): {
  fill: string
  stroke: string
  text: string
} {
  switch (type) {
    case 'start':
    case 'ack':
      return { fill: 'rgba(80, 216, 149, 0.22)', stroke: '#50d890', text: '#a7f3d0' }
    case 'stop':
    case 'nack':
    case 'error':
      return { fill: 'rgba(255, 118, 117, 0.22)', stroke: '#ff7675', text: '#fecaca' }
    case 'address':
      return { fill: 'rgba(162, 155, 254, 0.22)', stroke: '#a29bfe', text: '#e0e7ff' }
    case 'data':
      return { fill: 'rgba(75, 159, 245, 0.22)', stroke: '#4b9ff5', text: '#bfdbfe' }
    case 'control':
    case 'edge':
    default:
      return { fill: 'rgba(242, 169, 59, 0.22)', stroke: '#f2a93b', text: '#fde68a' }
  }
}

export function ProtocolDecoderBanner({
  packets,
  timeToX,
  y,
  height = 18,
  visibleStartNs,
  visibleEndNs,
}: ProtocolDecoderBannerProps) {
  const [hoveredPacket, setHoveredPacket] = useState<ProtocolPacket | null>(null)

  // Filter packets visible in the viewport
  const visiblePackets = packets.filter(
    (p) => p.endTimeNs >= visibleStartNs && p.startTimeNs <= visibleEndNs,
  )

  return (
    <g className="protocol-decoder-banner" transform={`translate(0, ${y})`}>
      {visiblePackets.map((pkt) => {
        const x1 = Math.max(0, timeToX(pkt.startTimeNs))
        const x2 = Math.max(x1 + 4, timeToX(pkt.endTimeNs))
        const width = Math.max(12, x2 - x1)
        const colors = packetColors(pkt.type)
        const bevel = Math.min(4, width / 4)
        const halfH = height / 2

        // Hexagon / capsule polygon points
        const points = [
          `${x1},${halfH}`,
          `${x1 + bevel},0`,
          `${x1 + width - bevel},0`,
          `${x1 + width},${halfH}`,
          `${x1 + width - bevel},${height}`,
          `${x1 + bevel},${height}`,
        ].join(' ')

        const isHovered = hoveredPacket?.id === pkt.id

        return (
          <g
            className="protocol-packet-cell"
            key={pkt.id}
            onPointerEnter={() => setHoveredPacket(pkt)}
            onPointerLeave={() => setHoveredPacket(null)}
            style={{ cursor: 'pointer' }}
          >
            <polygon
              fill={colors.fill}
              filter={isHovered ? 'brightness(1.4)' : undefined}
              points={points}
              stroke={colors.stroke}
              strokeWidth={isHovered ? '1.5' : '1'}
            />
            {width > 22 && (
              <text
                fill={colors.text}
                fontSize="9"
                fontWeight="700"
                textAnchor="middle"
                x={x1 + width / 2}
                y={halfH + 3.5}
              >
                {width < 45 && pkt.hex ? pkt.hex : pkt.label}
              </text>
            )}
            <title>
              {`${pkt.label}\nType: ${pkt.type.toUpperCase()}\n${pkt.detail ? `${pkt.detail}\n` : ''}Time: ${formatVirtualTime(pkt.startTimeNs)} – ${formatVirtualTime(pkt.endTimeNs)} (Δ ${formatVirtualTime(pkt.endTimeNs - pkt.startTimeNs)})`}
            </title>
          </g>
        )
      })}
    </g>
  )
}
