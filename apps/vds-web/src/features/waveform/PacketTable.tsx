import { useVirtualizer } from '@tanstack/react-virtual'
import { useRef } from 'react'

import { BusTag } from '../../components/BusTag'
import { formatVirtualTime } from '../../utils/format'
import type { ProtocolPacket } from './types'
import { observeRectWithFallback } from '../transactions/virtualRows'

const ROW_HEIGHT = 24

interface PacketTableProps {
  packets: ProtocolPacket[]
  isSelected: (packet: ProtocolPacket) => boolean
  onSelect: (packet: ProtocolPacket) => void
}

/** Virtualised decoded-frame table; clicking a frame spans cursors A/B over it. */
export function PacketTable({ packets, isSelected, onSelect }: PacketTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  // TanStack Virtual intentionally returns an imperative instance; React
  // Compiler must not memoize this hook result.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: packets.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    observeElementRect: observeRectWithFallback,
  })
  const items = virtualizer.getVirtualItems()
  const paddingTop = items[0]?.start ?? 0
  const paddingBottom = items.length ? virtualizer.getTotalSize() - (items.at(-1)?.end ?? 0) : 0

  return (
    <div className="wfa-packets-scroll" ref={scrollRef}>
      <table className="data-table wfa-packets">
        <colgroup>
          <col className="wfa-col-time" />
          <col className="wfa-col-dur" />
          <col className="wfa-col-bus" />
          <col className="wfa-col-device" />
          <col className="wfa-col-type" />
          <col className="wfa-col-label" />
          <col className="wfa-col-hex" />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th>Start</th>
            <th className="num">Δt</th>
            <th>Bus</th>
            <th>Device</th>
            <th>Frame</th>
            <th>Decoded</th>
            <th>Hex</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          {paddingTop > 0 && <tr aria-hidden="true" className="wfa-spacer"><td colSpan={8} style={{ height: paddingTop }} /></tr>}
          {items.map((item) => {
            const packet = packets[item.index]
            return (
              <tr
                aria-selected={isSelected(packet)}
                className={`clickable bus-${packet.bus.toLowerCase()}`}
                key={packet.id}
                onClick={() => onSelect(packet)}
                title="Place cursors A and B on this frame"
              >
                <td className="mono dim">{formatVirtualTime(packet.startTimeNs)}</td>
                <td className="num dim">{formatVirtualTime(packet.endTimeNs - packet.startTimeNs)}</td>
                <td><BusTag bus={packet.bus} /></td>
                <td className="wfa-packet-device" title={packet.deviceId}>{packet.deviceId}</td>
                <td><span className={`wfa-frame-type wfa-pkt-${packet.type}`}>{packet.type}</span></td>
                <td className="mono wfa-packet-label">{packet.label}</td>
                <td className="mono">{packet.hex ? `0x${packet.hex}` : '—'}</td>
                <td className="wfa-packet-detail" title={packet.detail}>{packet.detail ?? '—'}</td>
              </tr>
            )
          })}
          {paddingBottom > 0 && <tr aria-hidden="true" className="wfa-spacer"><td colSpan={8} style={{ height: paddingBottom }} /></tr>}
        </tbody>
      </table>
    </div>
  )
}
