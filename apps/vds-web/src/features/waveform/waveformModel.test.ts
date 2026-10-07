import { describe, expect, it } from 'vitest'
import type { LiveTransaction } from '../transactions/transactionModel'
import { formatFrequency } from './TimingCursors'
import { exportToCsv, exportToJson, exportToVcd } from './waveformExport'
import { synthesizeWaveforms } from './waveformSynthesizer'

function createTxn(
  busType: string,
  request: number[] = [0xa5],
  response: number[] = [0x3c],
  extra: Partial<LiveTransaction> = {},
): LiveTransaction {
  return {
    id: `${busType}:1`,
    transactionId: 1,
    deviceId: `${busType}-dev`,
    busType,
    request,
    response,
    status: 'success',
    startedVirtualNs: 1_000,
    completedVirtualNs: 5_000,
    ...extra,
  }
}

describe('waveformSynthesizer', () => {
  it('synthesizes SPI digital channels and decoded frames', () => {
    const txn = createTxn('spi', [0x9f, 0x00], [0x00, 0xef])
    const result = synthesizeWaveforms([txn])

    expect(result.channels.map((c) => c.name)).toEqual(['CS#', 'SCLK', 'MOSI', 'MISO'])
    const cs = result.channels.find((c) => c.name === 'CS#')!
    const sclk = result.channels.find((c) => c.name === 'SCLK')!
    const mosi = result.channels.find((c) => c.name === 'MOSI')!
    const miso = result.channels.find((c) => c.name === 'MISO')!

    // CS begins high, drops to 0, ends at 1
    expect(cs.samples[0].value).toBe(1)
    expect(cs.samples[1].value).toBe(0)
    expect(cs.samples.at(-1)?.value).toBe(1)

    // SCLK has clock pulses
    expect(sclk.samples.some((s) => s.value === 1)).toBe(true)

    // Decoded packets contain OP and data bytes
    expect(mosi.packets.some((p) => p.label === 'OP 0x9F')).toBe(true)
    expect(miso.packets.some((p) => p.label === '0xEF')).toBe(true)
  })

  it('synthesizes I2C START, address, data, ACK, RESTART, and STOP', () => {
    const txn = createTxn('i2c', [0xa0, 0x12], [0x34])
    const result = synthesizeWaveforms([txn])

    expect(result.channels.map((c) => c.name)).toEqual(['SCL', 'SDA'])
    const sda = result.channels.find((c) => c.name === 'SDA')!

    expect(sda.packets.some((p) => p.type === 'start')).toBe(true)
    expect(sda.packets.some((p) => p.type === 'address' && p.label.includes('ADDR 0x50 [W]'))).toBe(true)
    expect(sda.packets.some((p) => p.type === 'ack')).toBe(true)
    expect(sda.packets.some((p) => p.type === 'start' && p.label === 'RESTART')).toBe(true)
    expect(sda.packets.some((p) => p.type === 'stop')).toBe(true)
  })

  it('synthesizes UART 8N1 start bit, data bits, and stop bit', () => {
    const txn = createTxn('uart', [0x41], [0x42]) // 'A' and 'B'
    const result = synthesizeWaveforms([txn])

    expect(result.channels.map((c) => c.name)).toEqual(['TX', 'RX'])
    const tx = result.channels.find((c) => c.name === 'TX')!
    const rx = result.channels.find((c) => c.name === 'RX')!

    expect(tx.packets.some((p) => p.type === 'start')).toBe(true)
    expect(tx.packets.some((p) => p.label.includes("0x41 ('A')"))).toBe(true)
    expect(tx.packets.some((p) => p.type === 'stop')).toBe(true)

    expect(rx.packets.some((p) => p.label.includes("0x42 ('B')"))).toBe(true)
  })

  it('synthesizes CAN SOF, ID, DLC, DATA, CRC, ACK, and EOF', () => {
    const txn = createTxn('can', [0xde, 0xad, 0xbe, 0xef], [])
    const result = synthesizeWaveforms([txn])

    expect(result.channels.map((c) => c.name)).toEqual(['CAN_TX', 'CAN_RX', 'CAN_H', 'CAN_L'])
    const canTx = result.channels.find((c) => c.name === 'CAN_TX')!

    expect(canTx.packets.some((p) => p.label === 'SOF')).toBe(true)
    expect(canTx.packets.some((p) => p.type === 'address' && p.label.startsWith('ID'))).toBe(true)
    expect(canTx.packets.some((p) => p.label === 'DLC 4')).toBe(true)
    expect(canTx.packets.some((p) => p.label === '0xDE')).toBe(true)
    expect(canTx.packets.some((p) => p.label === 'CRC')).toBe(true)
    expect(canTx.packets.some((p) => p.label === 'ACK')).toBe(true)
    expect(canTx.packets.some((p) => p.label === 'EOF')).toBe(true)
  })

  it('synthesizes GPIO edge transitions', () => {
    const txn = createTxn('gpio', [0, 1], [1, 0], {
      gpioEdges: [
        { line: 0, from: 0, to: 1 },
        { line: 1, from: 1, to: 0 },
      ],
    })
    const result = synthesizeWaveforms([txn])

    expect(result.channels.map((c) => c.name)).toEqual(['IO_0', 'IO_1'])
    const io0 = result.channels.find((c) => c.name === 'IO_0')!
    const io1 = result.channels.find((c) => c.name === 'IO_1')!

    expect(io0.packets[0].label).toBe('LOW → HIGH')
    expect(io1.packets[0].label).toBe('HIGH → LOW')
  })
})

describe('waveformExport', () => {
  it('generates compliant standard IEEE 1364 VCD format', () => {
    const txn = createTxn('spi', [0x9f], [0xef])
    const { channels } = synthesizeWaveforms([txn])
    const vcd = exportToVcd(channels)

    expect(vcd).toContain('$date')
    expect(vcd).toContain('$version')
    expect(vcd).toContain('VDS4E')
    expect(vcd).toContain('$timescale\n  1ns\n$end')
    expect(vcd).toContain('$scope module top $end')
    expect(vcd).toContain('$var wire 1')
    expect(vcd).toContain('$enddefinitions $end')
    expect(vcd).toContain('$dumpvars')
  })

  it('generates CSV export with timestamps and decoded labels', () => {
    const txn = createTxn('i2c', [0x50], [0x12])
    const { channels, allPackets } = synthesizeWaveforms([txn])
    const csv = exportToCsv(channels, allPackets)

    expect(csv).toContain('Timestamp_ns,Bus,Device,Channel,Signal_State,Decoded_Label,Decoded_Detail')
    expect(csv).toContain('I2C')
    expect(csv).toContain('START')
  })

  it('generates structured JSON export', () => {
    const txn = createTxn('uart', [0x55], [])
    const { channels, allPackets } = synthesizeWaveforms([txn])
    const jsonStr = exportToJson(channels, allPackets, { test: true })
    const parsed = JSON.parse(jsonStr)

    expect(parsed.generator).toContain('VDS4E Logic Analyzer')
    expect(parsed.channels).toHaveLength(2)
    expect(parsed.decodedPackets.length).toBeGreaterThan(0)
  })

  it('calculates frequency from delta nanoseconds', () => {
    expect(formatFrequency(1_000_000_000)).toBe('1.0 Hz')
    expect(formatFrequency(1_000_000)).toBe('1.00 kHz')
    expect(formatFrequency(1_000)).toBe('1.00 MHz')
    expect(formatFrequency(250)).toBe('4.00 MHz')
    expect(formatFrequency(0)).toBe('—')
  })
})
