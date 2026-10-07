import type { ProtocolPacket, WaveformChannel } from './types'

function generateVcdSymbol(index: number): string {
  // Use printable ASCII characters starting from '!' (33) to '~' (126)
  const base = 94
  let symbol = ''
  let num = index
  do {
    const charCode = 33 + (num % base)
    symbol = String.fromCharCode(charCode) + symbol
    num = Math.floor(num / base) - 1
  } while (num >= 0)
  return symbol
}

export function exportToVcd(
  channels: WaveformChannel[],
  timeScale = '1ns',
): string {
  const dateStr = new Date().toISOString()
  const visibleChannels = channels.filter((c) => c.visible && c.samples.length > 0)
  const channelSymbols = new Map<string, string>()

  visibleChannels.forEach((c, idx) => {
    channelSymbols.set(c.id, generateVcdSymbol(idx))
  })

  let vcd = `$date\n  ${dateStr}\n$end\n`
  vcd += `$version\n  VDS4E Virtual Device Simulator Logic Analyzer\n$end\n`
  vcd += `$timescale\n  ${timeScale}\n$end\n`
  vcd += `$scope module top $end\n`

  visibleChannels.forEach((c) => {
    const sym = channelSymbols.get(c.id)
    const sanitizedName = `${c.bus}_${c.deviceId}_${c.name}`.replace(/[^a-zA-Z0-9_]/g, '_')
    vcd += `$var wire 1 ${sym} ${sanitizedName} $end\n`
  })

  vcd += `$upscope $end\n`
  vcd += `$enddefinitions $end\n`

  // Collect all transitions
  interface Transition {
    timeNs: number
    symbol: string
    value: number
  }

  const allTransitions: Transition[] = []
  const initialValues: { symbol: string; value: number }[] = []

  visibleChannels.forEach((c) => {
    const sym = channelSymbols.get(c.id)!
    if (c.samples.length > 0) {
      initialValues.push({
        symbol: sym,
        value: c.samples[0].value === -1 ? 0 : c.samples[0].value,
      })
    }
    for (let i = 1; i < c.samples.length; i++) {
      const sample = c.samples[i]
      allTransitions.push({
        timeNs: sample.timeNs,
        symbol: sym,
        value: sample.value === -1 ? 0 : sample.value,
      })
    }
  })

  // Dumpvars
  vcd += `$dumpvars\n`
  initialValues.forEach(({ symbol, value }) => {
    vcd += `${value}${symbol}\n`
  })
  vcd += `$end\n`

  // Sort transitions by time
  allTransitions.sort((a, b) => a.timeNs - b.timeNs)

  let currentTime = -1
  allTransitions.forEach(({ timeNs, symbol, value }) => {
    if (timeNs !== currentTime) {
      currentTime = timeNs
      vcd += `#${timeNs}\n`
    }
    vcd += `${value}${symbol}\n`
  })

  return vcd
}

export function exportToCsv(
  channels: WaveformChannel[],
  packets: ProtocolPacket[],
): string {
  const lines: string[] = []
  lines.push('Timestamp_ns,Bus,Device,Channel,Signal_State,Decoded_Label,Decoded_Detail')

  const visibleChannels = channels.filter((c) => c.visible)

  interface EventRow {
    timeNs: number
    bus: string
    device: string
    channel: string
    state: string
    label: string
    detail: string
  }

  const rows: EventRow[] = []

  visibleChannels.forEach((c) => {
    c.samples.forEach((sample) => {
      rows.push({
        timeNs: sample.timeNs,
        bus: c.bus.toUpperCase(),
        device: c.deviceId,
        channel: c.name,
        state: sample.value === -1 ? 'IDLE' : sample.value === 1 ? 'HIGH' : 'LOW',
        label: '',
        detail: '',
      })
    })

    c.packets.forEach((pkt) => {
      rows.push({
        timeNs: pkt.startTimeNs,
        bus: c.bus.toUpperCase(),
        device: c.deviceId,
        channel: c.name,
        state: '',
        label: pkt.label,
        detail: pkt.detail ?? '',
      })
    })
  })

  rows.sort((a, b) => a.timeNs - b.timeNs)

  rows.forEach((r) => {
    const escapedLabel = `"${r.label.replace(/"/g, '""')}"`
    const escapedDetail = `"${r.detail.replace(/"/g, '""')}"`
    lines.push(
      `${r.timeNs},${r.bus},${r.device},${r.channel},${r.state},${escapedLabel},${escapedDetail}`,
    )
  })

  return lines.join('\n')
}

export function exportToJson(
  channels: WaveformChannel[],
  packets: ProtocolPacket[],
  metadata: Record<string, unknown> = {},
): string {
  const exportData = {
    generator: 'VDS4E Logic Analyzer Waveform Exporter',
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    metadata,
    channels: channels.map((c) => ({
      id: c.id,
      name: c.name,
      bus: c.bus,
      deviceId: c.deviceId,
      pinType: c.pinType,
      color: c.color,
      sampleCount: c.samples.length,
      samples: c.samples,
    })),
    decodedPackets: packets.map((p) => ({
      id: p.id,
      transactionId: p.transactionId,
      bus: p.bus,
      deviceId: p.deviceId,
      channelId: p.channelId,
      startTimeNs: p.startTimeNs,
      endTimeNs: p.endTimeNs,
      type: p.type,
      label: p.label,
      detail: p.detail,
      hex: p.hex,
    })),
  }

  return JSON.stringify(exportData, null, 2)
}

export function downloadFile(
  content: string,
  filename: string,
  mimeType = 'text/plain',
): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
