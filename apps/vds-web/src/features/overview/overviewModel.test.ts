import { describe, expect, it } from 'vitest'

import type { Adapter, Device } from '../../types/api'
import type { DomainEvent } from '../../types/events'
import { formatEndpoint } from '../../utils/endpoints'
import type { LiveTransaction } from '../transactions/transactionModel'
import { buildBringUp, buildBusLanes, buildDeviceNodeRows, laneLabel, latestScenarioRun, transactionWireSummary } from './overviewModel'

const spiAdapter = (overrides: Partial<Adapter> = {}): Adapter => ({
  id: 'spi0', name: 'SPI 0', bus_type: 'spi', driver: 'cuse', state: 'loaded', readiness: 'ready', bus_number: 0,
  bindings: [{ device_id: 'flash', endpoint: 0, device_path: '/dev/spidev0.0' }, { device_id: 'nor', endpoint: 1, device_path: '/dev/spidev0.1' }],
  daemon_pids: [], ...overrides,
})

const transaction = (id: number, overrides: Partial<LiveTransaction> = {}): LiveTransaction => ({
  id: `flash:${id}`, transactionId: id, deviceId: 'flash', busType: 'spi', request: [0x9f], response: [0x20], status: 'success',
  completedWallNs: id, ...overrides,
})

describe('bring-up pipeline', () => {
  it('fails on missing kernel modules and blocks the steps behind them', () => {
    const gpio = spiAdapter({ id: 'gpio0', bus_type: 'gpio', driver: 'gpio-sim', state: 'unloaded', readiness: 'authorization_required', bindings: [{ device_id: 'bank', endpoint: 0, device_path: '/dev/gpiochipX' }] })
    const state = buildBringUp([spiAdapter({ state: 'unloaded', readiness: 'unavailable' }), gpio], [])
    expect(state.missingModules).toEqual(['cuse', 'gpio-sim'])
    expect(state.steps.map((step) => step.status)).toEqual(['fail', 'blocked', 'blocked', 'idle'])
    expect(state.current?.id).toBe('modules')
    expect(state).toMatchObject({ nodesOpen: 0, nodesTotal: 3 })
  })

  it('points at loadable adapters once modules are present', () => {
    const state = buildBringUp([spiAdapter({ state: 'unloaded' })], [transaction(1)])
    expect(state.current?.id).toBe('adapters')
    expect(state.loadableAdapters.map((adapter) => adapter.id)).toEqual(['spi0'])
    expect(state.steps[3]).toMatchObject({ status: 'ok', detail: '1 transactions' })
  })

  it('is ready when every bound node is open', () => {
    const state = buildBringUp([spiAdapter()], [transaction(1), transaction(2, { status: 'error' })])
    expect(state.current).toBeUndefined()
    expect(state).toMatchObject({ nodesOpen: 2, nodesTotal: 2 })
    expect(state.steps[3].detail).toBe('2 transactions · 1 failed')
  })
})

describe('bus lanes', () => {
  it('orders lane chips oldest to newest and explains silent lanes', () => {
    const lanes = buildBusLanes([transaction(3), transaction(2, { status: 'error' }), transaction(1)], [spiAdapter(), spiAdapter({ id: 'i2c1', bus_type: 'i2c', state: 'unloaded' })])
    const spi = lanes.find((lane) => lane.bus === 'spi')
    expect(spi?.transactions.map((item) => item.transactionId)).toEqual([1, 2, 3])
    expect(spi).toMatchObject({ total: 3, failed: 1 })
    expect(lanes.find((lane) => lane.bus === 'i2c')?.silentReason).toBe('i2c1 not loaded')
    expect(lanes.find((lane) => lane.bus === 'uart')?.silentReason).toBe('No UART adapter configured')
  })

  it('labels chips with the leading opcode bytes or the GPIO edge', () => {
    expect(laneLabel(transaction(1, { request: [0x13, 0x01, 0x00] }))).toBe('13 01…')
    expect(laneLabel(transaction(1, { busType: 'gpio', request: [], gpioEdges: [{ line: 16, from: 0, to: 1 }] }))).toBe('IO16 ↑')
  })
})

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
