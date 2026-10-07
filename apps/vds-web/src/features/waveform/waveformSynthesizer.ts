import type { LiveTransaction } from '../transactions/transactionModel'
import type {
  DigitalLogicLevel,
  ProtocolPacket,
  WaveformChannel,
} from './types'

function hex(byte: number): string {
  return byte.toString(16).padStart(2, '0').toUpperCase()
}

function asciiChar(byte: number): string {
  return byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.'
}

const GPIO_COLORS = [
  '#50d890',
  '#48cfe7',
  '#f2a93b',
  '#b184f3',
  '#ff7675',
  '#74b9ff',
  '#ffeaa7',
  '#55efc4',
]

function inferBusFromDeviceId(busType: string, deviceId: string): string {
  const b = busType.toLowerCase()
  if (b && b !== 'unknown') return b
  const id = deviceId.toLowerCase()
  if (id.includes('spi')) return 'spi'
  if (id.includes('i2c')) return 'i2c'
  if (id.includes('uart')) return 'uart'
  if (id.includes('gpio')) return 'gpio'
  if (id.includes('can')) return 'can'
  return b
}

export function synthesizeWaveforms(transactions: LiveTransaction[]): {
  channels: WaveformChannel[]
  allPackets: ProtocolPacket[]
  minTimeNs: number
  maxTimeNs: number
} {
  const channelMap = new Map<string, WaveformChannel>()
  const allPackets: ProtocolPacket[] = []

  function getOrCreateChannel(
    id: string,
    name: string,
    bus: string,
    deviceId: string,
    pinType: string,
    color: string,
    initialLevel: DigitalLogicLevel = 0,
  ): WaveformChannel {
    let channel = channelMap.get(id)
    if (!channel) {
      channel = {
        id,
        name,
        bus,
        deviceId,
        pinType,
        color,
        visible: true,
        samples: initialLevel !== -1 ? [{ timeNs: 0, value: initialLevel }] : [],
        packets: [],
      }
      channelMap.set(id, channel)
    }
    return channel
  }

  function addSample(channel: WaveformChannel, timeNs: number, value: DigitalLogicLevel) {
    const last = channel.samples.at(-1)
    if (!last || last.value !== value || last.timeNs !== timeNs) {
      channel.samples.push({ timeNs, value })
    }
  }

  function addPacket(channel: WaveformChannel | null, packet: ProtocolPacket) {
    if (channel) {
      channel.packets.push(packet)
    }
    allPackets.push(packet)
  }

  // Sort transactions chronologically
  const sorted = [...transactions].sort((a, b) => {
    const timeA = a.startedVirtualNs ?? a.completedVirtualNs ?? 0
    const timeB = b.startedVirtualNs ?? b.completedVirtualNs ?? 0
    return timeA - timeB || a.transactionId - b.transactionId
  })

  // Ensure deterministic continuous timing if mock or 0 timestamps are present
  let currentBaseTimeNs = 0

  sorted.forEach((txn, txnIdx) => {
    let t0 = txn.startedVirtualNs ?? txn.completedVirtualNs ?? 0
    if (t0 <= currentBaseTimeNs && txnIdx > 0) {
      t0 = currentBaseTimeNs + 2_000 // 2 µs gap between transactions
    } else if (t0 < currentBaseTimeNs) {
      t0 = currentBaseTimeNs
    }

    const bus = inferBusFromDeviceId(txn.busType, txn.deviceId)
    let txnEndTimeNs = t0

    if (bus === 'spi') {
      const csChan = getOrCreateChannel(
        `${txn.deviceId}:cs`,
        'CS#',
        'spi',
        txn.deviceId,
        'CS',
        '#f2a93b',
        1,
      )
      const sclkChan = getOrCreateChannel(
        `${txn.deviceId}:sclk`,
        'SCLK',
        'spi',
        txn.deviceId,
        'CLK',
        '#2acbd4',
        0,
      )
      const mosiChan = getOrCreateChannel(
        `${txn.deviceId}:mosi`,
        'MOSI',
        'spi',
        txn.deviceId,
        'MOSI',
        '#4b9ff5',
        0,
      )
      const misoChan = getOrCreateChannel(
        `${txn.deviceId}:miso`,
        'MISO',
        'spi',
        txn.deviceId,
        'MISO',
        '#b184f3',
        0,
      )

      const halfClockNs = 100 // 5 MHz clock
      let curT = t0

      // CS goes LOW (Assert)
      addSample(csChan, curT, 0)
      addPacket(csChan, {
        id: `spi-${txn.id}-cs-assert`,
        transactionId: txn.transactionId,
        bus: 'spi',
        deviceId: txn.deviceId,
        channelId: csChan.id,
        startTimeNs: curT,
        endTimeNs: curT + halfClockNs,
        type: 'control',
        label: 'CS# ASSERT',
        detail: 'Chip select driven low',
      })
      curT += halfClockNs

      const totalByteCount = Math.max(txn.request.length, txn.response.length, 1)
      const mosiBytes = txn.request
      const misoBytes = txn.response

      for (let b = 0; b < totalByteCount; b++) {
        const mosiByte = mosiBytes[b] ?? 0
        const misoByte = misoBytes[b] ?? 0
        const byteStart = curT

        for (let bit = 7; bit >= 0; bit--) {
          const mosiBit = ((mosiByte >> bit) & 1) as DigitalLogicLevel
          const misoBit = ((misoByte >> bit) & 1) as DigitalLogicLevel

          addSample(mosiChan, curT, mosiBit)
          addSample(misoChan, curT, misoBit)

          // Clock rising edge
          addSample(sclkChan, curT, 0)
          curT += halfClockNs
          addSample(sclkChan, curT, 1)
          curT += halfClockNs
        }

        // Return clock to low
        addSample(sclkChan, curT, 0)

        // Add decoded packets for the byte
        if (b < mosiBytes.length) {
          addPacket(mosiChan, {
            id: `spi-${txn.id}-mosi-${b}`,
            transactionId: txn.transactionId,
            bus: 'spi',
            deviceId: txn.deviceId,
            channelId: mosiChan.id,
            startTimeNs: byteStart,
            endTimeNs: curT,
            type: b === 0 ? 'control' : 'data',
            label: b === 0 ? `OP 0x${hex(mosiByte)}` : `0x${hex(mosiByte)}`,
            detail: `MOSI Byte ${b}: 0x${hex(mosiByte)} (0b${mosiByte.toString(2).padStart(8, '0')})`,
            byte: mosiByte,
            hex: hex(mosiByte),
          })
        }

        if (b < misoBytes.length) {
          addPacket(misoChan, {
            id: `spi-${txn.id}-miso-${b}`,
            transactionId: txn.transactionId,
            bus: 'spi',
            deviceId: txn.deviceId,
            channelId: misoChan.id,
            startTimeNs: byteStart,
            endTimeNs: curT,
            type: 'data',
            label: `0x${hex(misoByte)}`,
            detail: `MISO Byte ${b}: 0x${hex(misoByte)} (0b${misoByte.toString(2).padStart(8, '0')})`,
            byte: misoByte,
            hex: hex(misoByte),
          })
        }

        // Inter-byte gap
        curT += halfClockNs
      }

      // CS deasserts (returns HIGH)
      addSample(csChan, curT, 1)
      addSample(mosiChan, curT, 0)
      addSample(misoChan, curT, 0)
      addPacket(csChan, {
        id: `spi-${txn.id}-cs-deassert`,
        transactionId: txn.transactionId,
        bus: 'spi',
        deviceId: txn.deviceId,
        channelId: csChan.id,
        startTimeNs: curT,
        endTimeNs: curT + halfClockNs,
        type: 'control',
        label: 'CS# DEASSERT',
        detail: 'Chip select returned high',
      })
      curT += halfClockNs
      txnEndTimeNs = curT
    } else if (bus === 'i2c') {
      const sclChan = getOrCreateChannel(
        `${txn.deviceId}:scl`,
        'SCL',
        'i2c',
        txn.deviceId,
        'CLK',
        '#2acbd4',
        1,
      )
      const sdaChan = getOrCreateChannel(
        `${txn.deviceId}:sda`,
        'SDA',
        'i2c',
        txn.deviceId,
        'SDA',
        '#f2a93b',
        1,
      )

      const bitDurationNs = 2_500 // 400 kHz fast mode (2.5 µs)
      const halfBitNs = bitDurationNs / 2
      const quarterBitNs = bitDurationNs / 4
      let curT = t0

      // Idle high
      addSample(sclChan, curT, 1)
      addSample(sdaChan, curT, 1)
      curT += halfBitNs

      // START condition: SDA drops while SCL is high
      addSample(sdaChan, curT, 0)
      addPacket(sdaChan, {
        id: `i2c-${txn.id}-start`,
        transactionId: txn.transactionId,
        bus: 'i2c',
        deviceId: txn.deviceId,
        channelId: sdaChan.id,
        startTimeNs: curT,
        endTimeNs: curT + halfBitNs,
        type: 'start',
        label: 'START',
        detail: 'I2C Bus Start Condition',
      })
      curT += quarterBitNs
      addSample(sclChan, curT, 0)
      curT += quarterBitNs

      const emitI2cByte = (
        byte: number,
        isAddress: boolean,
        isRead: boolean,
        isAck: boolean,
        index: number,
      ) => {
        const byteStart = curT
        for (let bit = 7; bit >= 0; bit--) {
          const bitVal = ((byte >> bit) & 1) as DigitalLogicLevel
          addSample(sdaChan, curT, bitVal)
          curT += quarterBitNs
          addSample(sclChan, curT, 1) // SCL high
          curT += halfBitNs
          addSample(sclChan, curT, 0) // SCL low
          curT += quarterBitNs
        }

        // 9th bit: ACK / NACK
        const ackVal: DigitalLogicLevel = isAck ? 0 : 1
        const ackStart = curT
        addSample(sdaChan, curT, ackVal)
        curT += quarterBitNs
        addSample(sclChan, curT, 1)
        curT += halfBitNs
        addSample(sclChan, curT, 0)
        curT += quarterBitNs

        if (isAddress) {
          const addr7 = byte >> 1
          addPacket(sdaChan, {
            id: `i2c-${txn.id}-addr-${index}`,
            transactionId: txn.transactionId,
            bus: 'i2c',
            deviceId: txn.deviceId,
            channelId: sdaChan.id,
            startTimeNs: byteStart,
            endTimeNs: ackStart,
            type: 'address',
            label: `ADDR 0x${hex(addr7)} [${byte & 1 ? 'R' : 'W'}]`,
            detail: `7-bit Slave Address 0x${hex(addr7)}, ${byte & 1 ? 'Read' : 'Write'}`,
            byte,
            hex: hex(byte),
          })
        } else {
          addPacket(sdaChan, {
            id: `i2c-${txn.id}-data-${index}`,
            transactionId: txn.transactionId,
            bus: 'i2c',
            deviceId: txn.deviceId,
            channelId: sdaChan.id,
            startTimeNs: byteStart,
            endTimeNs: ackStart,
            type: 'data',
            label: `0x${hex(byte)}`,
            detail: `Data Byte: 0x${hex(byte)} (0b${byte.toString(2).padStart(8, '0')})`,
            byte,
            hex: hex(byte),
          })
        }

        addPacket(sdaChan, {
          id: `i2c-${txn.id}-ack-${index}`,
          transactionId: txn.transactionId,
          bus: 'i2c',
          deviceId: txn.deviceId,
          channelId: sdaChan.id,
          startTimeNs: ackStart,
          endTimeNs: curT,
          type: isAck ? 'ack' : 'nack',
          label: isAck ? 'ACK' : 'NACK',
          detail: isAck ? 'Acknowledge received' : 'Not-Acknowledge',
        })
      }

      // Transmit request bytes (Write phase)
      if (txn.request.length > 0) {
        txn.request.forEach((byte, idx) => {
          const isAddr = idx === 0
          emitI2cByte(byte, isAddr, false, true, idx)
        })
      }

      // If response bytes exist, send Repeated Start
      if (txn.response.length > 0) {
        if (txn.request.length > 0) {
          // Repeated start
          addSample(sdaChan, curT, 1)
          curT += quarterBitNs
          addSample(sclChan, curT, 1)
          curT += quarterBitNs
          addSample(sdaChan, curT, 0)
          addPacket(sdaChan, {
            id: `i2c-${txn.id}-restart`,
            transactionId: txn.transactionId,
            bus: 'i2c',
            deviceId: txn.deviceId,
            channelId: sdaChan.id,
            startTimeNs: curT - quarterBitNs,
            endTimeNs: curT + quarterBitNs,
            type: 'start',
            label: 'RESTART',
            detail: 'Repeated START condition',
          })
          curT += quarterBitNs
          addSample(sclChan, curT, 0)
          curT += quarterBitNs
        }

        txn.response.forEach((byte, idx) => {
          const isLast = idx === txn.response.length - 1
          emitI2cByte(byte, false, true, !isLast, 100 + idx)
        })
      }

      // STOP condition: SDA goes low -> high while SCL is high
      addSample(sdaChan, curT, 0)
      curT += quarterBitNs
      addSample(sclChan, curT, 1)
      curT += quarterBitNs
      addSample(sdaChan, curT, 1)
      addPacket(sdaChan, {
        id: `i2c-${txn.id}-stop`,
        transactionId: txn.transactionId,
        bus: 'i2c',
        deviceId: txn.deviceId,
        channelId: sdaChan.id,
        startTimeNs: curT - quarterBitNs,
        endTimeNs: curT + quarterBitNs,
        type: 'stop',
        label: 'STOP',
        detail: 'I2C Bus Stop Condition',
      })
      curT += halfBitNs
      txnEndTimeNs = curT
    } else if (bus === 'uart') {
      const txChan = getOrCreateChannel(
        `${txn.deviceId}:tx`,
        'TX',
        'uart',
        txn.deviceId,
        'TX',
        '#4b9ff5',
        1,
      )
      const rxChan = getOrCreateChannel(
        `${txn.deviceId}:rx`,
        'RX',
        'uart',
        txn.deviceId,
        'RX',
        '#50d890',
        1,
      )

      const bitDurationNs = 8_680 // 115200 baud
      const curT = t0

      const emitUartBytes = (
        bytes: number[],
        chan: WaveformChannel,
        isTx: boolean,
      ) => {
        let t = curT
        bytes.forEach((byte, idx) => {
          // Start bit (0)
          addSample(chan, t, 0)
          addPacket(chan, {
            id: `uart-${txn.id}-${isTx ? 'tx' : 'rx'}-start-${idx}`,
            transactionId: txn.transactionId,
            bus: 'uart',
            deviceId: txn.deviceId,
            channelId: chan.id,
            startTimeNs: t,
            endTimeNs: t + bitDurationNs,
            type: 'start',
            label: 'START',
            detail: 'UART Frame Start Bit',
          })
          t += bitDurationNs

          // 8 data bits LSB first
          const dataStart = t
          for (let bit = 0; bit < 8; bit++) {
            const val = ((byte >> bit) & 1) as DigitalLogicLevel
            addSample(chan, t, val)
            t += bitDurationNs
          }

          addPacket(chan, {
            id: `uart-${txn.id}-${isTx ? 'tx' : 'rx'}-data-${idx}`,
            transactionId: txn.transactionId,
            bus: 'uart',
            deviceId: txn.deviceId,
            channelId: chan.id,
            startTimeNs: dataStart,
            endTimeNs: t,
            type: 'data',
            label: `0x${hex(byte)} ('${asciiChar(byte)}')`,
            detail: `${isTx ? 'TX' : 'RX'} Byte: 0x${hex(byte)} · '${asciiChar(byte)}'`,
            byte,
            hex: hex(byte),
          })

          // Stop bit (1)
          addSample(chan, t, 1)
          addPacket(chan, {
            id: `uart-${txn.id}-${isTx ? 'tx' : 'rx'}-stop-${idx}`,
            transactionId: txn.transactionId,
            bus: 'uart',
            deviceId: txn.deviceId,
            channelId: chan.id,
            startTimeNs: t,
            endTimeNs: t + bitDurationNs,
            type: 'stop',
            label: 'STOP',
            detail: 'UART Stop Bit',
          })
          t += bitDurationNs
        })
        return t
      }

      let endTx = curT
      let endRx = curT
      if (txn.request.length > 0) {
        endTx = emitUartBytes(txn.request, txChan, true)
      }
      if (txn.response.length > 0) {
        endRx = emitUartBytes(txn.response, rxChan, false)
      }
      txnEndTimeNs = Math.max(endTx, endRx, curT + bitDurationNs)
    } else if (bus === 'can') {
      const canTx = getOrCreateChannel(
        `${txn.deviceId}:can_tx`,
        'CAN_TX',
        'can',
        txn.deviceId,
        'CAN_TX',
        '#e17055',
        1,
      )
      const canRx = getOrCreateChannel(
        `${txn.deviceId}:can_rx`,
        'CAN_RX',
        'can',
        txn.deviceId,
        'CAN_RX',
        '#a29bfe',
        1,
      )
      const canH = getOrCreateChannel(
        `${txn.deviceId}:can_h`,
        'CAN_H',
        'can',
        txn.deviceId,
        'CAN_H',
        '#fdcb6e',
        0,
      )
      const canL = getOrCreateChannel(
        `${txn.deviceId}:can_l`,
        'CAN_L',
        'can',
        txn.deviceId,
        'CAN_L',
        '#00cec9',
        1,
      )

      const bitDurationNs = 2_000 // 500 kbps (2.0 µs)
      let curT = t0

      const emitCanBit = (dominant: boolean) => {
        const txVal: DigitalLogicLevel = dominant ? 0 : 1
        addSample(canTx, curT, txVal)
        addSample(canRx, curT, txVal)
        // Dominant: CAN_H high (3.5V), CAN_L low (1.5V)
        addSample(canH, curT, dominant ? 1 : 0)
        addSample(canL, curT, dominant ? 0 : 1)
        curT += bitDurationNs
      }

      // SOF (1 dominant bit)
      const sofStart = curT
      emitCanBit(true)
      addPacket(canTx, {
        id: `can-${txn.id}-sof`,
        transactionId: txn.transactionId,
        bus: 'can',
        deviceId: txn.deviceId,
        channelId: canTx.id,
        startTimeNs: sofStart,
        endTimeNs: curT,
        type: 'start',
        label: 'SOF',
        detail: 'CAN Start of Frame (Dominant)',
      })

      // 11-bit Identifier (use transactionId or first byte)
      const idStart = curT
      const canId = (txn.transactionId * 0x11) & 0x7ff
      for (let bit = 10; bit >= 0; bit--) {
        const dominant = ((canId >> bit) & 1) === 0
        emitCanBit(dominant)
      }
      addPacket(canTx, {
        id: `can-${txn.id}-id`,
        transactionId: txn.transactionId,
        bus: 'can',
        deviceId: txn.deviceId,
        channelId: canTx.id,
        startTimeNs: idStart,
        endTimeNs: curT,
        type: 'address',
        label: `ID 0x${canId.toString(16).toUpperCase()}`,
        detail: `CAN Standard Identifier 0x${canId.toString(16).toUpperCase()}`,
      })

      // Control field: RTR (0), IDE (0), r0 (0), DLC (4 bits)
      emitCanBit(true) // RTR dominant
      emitCanBit(true) // IDE dominant
      emitCanBit(true) // r0 dominant

      const dlc = Math.min(txn.request.length, 8)
      const dlcStart = curT
      for (let bit = 3; bit >= 0; bit--) {
        const dominant = ((dlc >> bit) & 1) === 0
        emitCanBit(dominant)
      }
      addPacket(canTx, {
        id: `can-${txn.id}-dlc`,
        transactionId: txn.transactionId,
        bus: 'can',
        deviceId: txn.deviceId,
        channelId: canTx.id,
        startTimeNs: dlcStart,
        endTimeNs: curT,
        type: 'control',
        label: `DLC ${dlc}`,
        detail: `Data Length Code: ${dlc} bytes`,
      })

      // Data bytes
      txn.request.slice(0, 8).forEach((byte, idx) => {
        const byteStart = curT
        for (let bit = 7; bit >= 0; bit--) {
          const dominant = ((byte >> bit) & 1) === 0
          emitCanBit(dominant)
        }
        addPacket(canTx, {
          id: `can-${txn.id}-data-${idx}`,
          transactionId: txn.transactionId,
          bus: 'can',
          deviceId: txn.deviceId,
          channelId: canTx.id,
          startTimeNs: byteStart,
          endTimeNs: curT,
          type: 'data',
          label: `0x${hex(byte)}`,
          detail: `CAN Data Byte ${idx}: 0x${hex(byte)}`,
          byte,
          hex: hex(byte),
        })
      })

      // CRC field: 15 bits + Delimiter (recessive)
      const crcStart = curT
      for (let i = 0; i < 15; i++) {
        emitCanBit(i % 2 === 0)
      }
      emitCanBit(false) // CRC Delim (recessive)
      addPacket(canTx, {
        id: `can-${txn.id}-crc`,
        transactionId: txn.transactionId,
        bus: 'can',
        deviceId: txn.deviceId,
        channelId: canTx.id,
        startTimeNs: crcStart,
        endTimeNs: curT,
        type: 'control',
        label: 'CRC',
        detail: '15-bit CRC + Delimiter',
      })

      // ACK slot (dominant) + ACK delimiter (recessive)
      const ackStart = curT
      emitCanBit(true)
      emitCanBit(false)
      addPacket(canTx, {
        id: `can-${txn.id}-ack`,
        transactionId: txn.transactionId,
        bus: 'can',
        deviceId: txn.deviceId,
        channelId: canTx.id,
        startTimeNs: ackStart,
        endTimeNs: curT,
        type: 'ack',
        label: 'ACK',
        detail: 'CAN Acknowledge',
      })

      // EOF: 7 recessive bits
      const eofStart = curT
      for (let i = 0; i < 7; i++) {
        emitCanBit(false)
      }
      addPacket(canTx, {
        id: `can-${txn.id}-eof`,
        transactionId: txn.transactionId,
        bus: 'can',
        deviceId: txn.deviceId,
        channelId: canTx.id,
        startTimeNs: eofStart,
        endTimeNs: curT,
        type: 'stop',
        label: 'EOF',
        detail: 'CAN End of Frame',
      })

      txnEndTimeNs = curT
    } else if (bus === 'gpio') {
      const lineCount = Math.max(
        txn.request.length,
        txn.response.length,
        txn.gpioEdges?.length ? Math.max(...txn.gpioEdges.map((e) => e.line + 1)) : 0,
        1,
      )

      const activeLines = new Set<number>()
      if (txn.gpioEdges && txn.gpioEdges.length > 0) {
        txn.gpioEdges.forEach((e) => activeLines.add(e.line))
      } else {
        for (let i = 0; i < Math.min(lineCount, 8); i++) {
          activeLines.add(i)
        }
      }

      const pulseDurationNs = 1_000
      const curT = t0

      Array.from(activeLines).sort((a, b) => a - b).forEach((line) => {
        const color = GPIO_COLORS[line % GPIO_COLORS.length]
        const chan = getOrCreateChannel(
          `${txn.deviceId}:io_${line}`,
          `IO_${line}`,
          'gpio',
          txn.deviceId,
          'PIN',
          color,
          0,
        )

        const edge = txn.gpioEdges?.find((e) => e.line === line)
        if (edge) {
          const fromVal = edge.from as DigitalLogicLevel
          const toVal = edge.to as DigitalLogicLevel
          addSample(chan, curT, fromVal)
          addSample(chan, curT + 200, toVal)
          addPacket(chan, {
            id: `gpio-${txn.id}-line-${line}`,
            transactionId: txn.transactionId,
            bus: 'gpio',
            deviceId: txn.deviceId,
            channelId: chan.id,
            startTimeNs: curT,
            endTimeNs: curT + pulseDurationNs,
            type: 'edge',
            label: `${edge.from ? 'HIGH' : 'LOW'} → ${edge.to ? 'HIGH' : 'LOW'}`,
            detail: `GPIO line ${line}: ${edge.from} → ${edge.to} (${edge.to > edge.from ? 'Rising Edge' : 'Falling Edge'})`,
          })
        } else {
          const val = ((txn.response[line] ?? txn.request[line] ?? 0) !== 0 ? 1 : 0) as DigitalLogicLevel
          addSample(chan, curT, val)
          addPacket(chan, {
            id: `gpio-${txn.id}-line-${line}`,
            transactionId: txn.transactionId,
            bus: 'gpio',
            deviceId: txn.deviceId,
            channelId: chan.id,
            startTimeNs: curT,
            endTimeNs: curT + pulseDurationNs,
            type: 'edge',
            label: val ? 'HIGH' : 'LOW',
            detail: `GPIO line ${line} is ${val ? 'HIGH' : 'LOW'}`,
          })
        }
      })

      txnEndTimeNs = curT + pulseDurationNs
    }

    currentBaseTimeNs = Math.max(currentBaseTimeNs, txnEndTimeNs)
  })

  // Ensure all channels have samples ending at max time
  const channels = Array.from(channelMap.values())
  const minTimeNs = 0
  const maxTimeNs = Math.max(currentBaseTimeNs, 5_000)

  channels.forEach((channel) => {
    const lastSample = channel.samples.at(-1)
    if (lastSample && lastSample.timeNs < maxTimeNs) {
      channel.samples.push({
        timeNs: maxTimeNs,
        value: lastSample.value,
      })
    }
  })

  return {
    channels,
    allPackets,
    minTimeNs,
    maxTimeNs,
  }
}
