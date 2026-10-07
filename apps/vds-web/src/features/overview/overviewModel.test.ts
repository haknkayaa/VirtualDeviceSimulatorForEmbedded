import { describe, expect, it } from 'vitest'

import type { Adapter, Device } from '../../types/api'
import type { DomainEvent } from '../../types/events'
import { formatEndpoint } from '../../utils/endpoints'
import { buildDeviceNodeRows, latestScenarioRun, transactionWireSummary } from './overviewModel'

describe('overview model', () => {
  it('lists bound nodes, empty adapters and unbound devices', () => {
    const adapters: Adapter[] = [
      { id: 'spi0', name: 'SPI 0', bus_type: 'spi', driver: 'cuse', state: 'loaded', readiness: 'ready', bus_number: 0, bindings: [{ device_id: 'flash', endpoint: 1, device_path: '/dev/spidev0.1' }], daemon_pids: [42] },
      { id: 'i2c1', name: 'I2C 1', bus_type: 'i2c', driver: 'cuse', state: 'unloaded', readiness: 'ready', bus_number: 1, bindings: [], daemon_pids: [] },
    ]
    const devices: Device[] = [{ id: 'flash', bus: 'spi', state: 'ready' }, { id: 'eeprom', bus: 'i2c', state: null }]
    const events: DomainEvent[] = [{
      event_id: 1, event_type: 'transaction_completed', timestamp_virtual_ns: 5, timestamp_wall_ns: 99, device_id: 'flash',
      payload: { kind: 'transaction_completed', transaction_id: 1, response: [1], result: 'success', error_code: null },
    }]
    const rows = buildDeviceNodeRows(adapters, devices, undefined, events)
    expect(rows.map((row) => row.key)).toEqual(['spi0:flash', 'adapter:i2c1', 'device:eeprom'])
    expect(rows[0]).toMatchObject({ deviceId: 'flash', lastActivityWallNs: 99 })
  })

  it('formats endpoints the way Linux tools address them', () => {
    expect(formatEndpoint('spi', 1)).toBe('CS1')
    expect(formatEndpoint('i2c', 80)).toBe('0x50')
    expect(formatEndpoint('gpio', 0)).toBe('#0')
    expect(formatEndpoint('uart', 0)).toBe('PTY')
  })

  it('summarises wire bytes and GPIO edges', () => {
    const base = { id: 'a:1', transactionId: 1, deviceId: 'a', status: 'success' as const }
    expect(transactionWireSummary({ ...base, busType: 'spi', request: [0x9f, 0, 0, 0, 0], response: [0, 0x20, 0xba] })).toBe('9F 00 00 00 … → 00 20 BA')
    expect(transactionWireSummary({ ...base, busType: 'gpio', request: [], response: [1], gpioEdges: [{ line: 3, from: 0, to: 1 }, { line: 4, from: 1, to: 0 }] })).toBe('IO3 ↑ +1')
  })

  it('reconstructs the latest scenario run from events', () => {
    const event = (eventId: number, payload: DomainEvent['payload']): DomainEvent => ({
      event_id: eventId, event_type: payload.kind, timestamp_virtual_ns: eventId * 1_000, timestamp_wall_ns: 0, scenario_run_id: 'run-1', payload,
    })
    const events = [
      event(1, { kind: 'scenario_started', scenario_id: 'jedec' }),
      event(2, { kind: 'scenario_step_completed', step_id: 'read', action: 'send_spi', status: 'failed', error: 'mismatch' }),
      event(3, { kind: 'scenario_completed', scenario_id: 'jedec', status: 'failed', steps_passed: 1, steps_failed: 1, steps_skipped: 0 }),
    ]
    expect(latestScenarioRun(events)).toMatchObject({
      runId: 'run-1', scenarioId: 'jedec', status: 'failed', passed: 1, failed: 1, lastError: 'mismatch', startedVirtualNs: 1_000, completedVirtualNs: 3_000,
    })
    expect(latestScenarioRun(events.slice(0, 2))).toMatchObject({ status: 'running', lastStep: 'read' })
  })
})
