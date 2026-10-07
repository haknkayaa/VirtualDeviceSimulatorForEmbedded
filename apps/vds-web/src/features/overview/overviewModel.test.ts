import { describe, expect, it } from 'vitest'

import type { Adapter, Device, DeviceCommand } from '../../types/api'
import type { DomainEvent } from '../../types/events'
import { formatEndpoint } from '../../utils/endpoints'
import type { LiveTransaction } from '../transactions/transactionModel'
import {
  buildDevicePath,
  buildTimeline,
  hostPrerequisites,
  latestScenarioRun,
  linkActivity,
  mergeScenarioSteps,
  transactionOperation,
  unboundDevices,
  virtualSeconds,
} from './overviewModel'

const spiAdapter = (overrides: Partial<Adapter> = {}): Adapter => ({
  id: 'spi0', name: 'SPI 0', bus_type: 'spi', driver: 'cuse', state: 'loaded', readiness: 'ready', bus_number: 0,
  bindings: [{ device_id: 'nor', endpoint: 1, device_path: '/dev/spidev0.1' }, { device_id: 'flash', endpoint: 0, device_path: '/dev/spidev0.0' }],
  daemon_pids: [], ...overrides,
})

const transaction = (id: number, overrides: Partial<LiveTransaction> = {}): LiveTransaction => ({
  id: `flash:${id}`, transactionId: id, deviceId: 'flash', busType: 'spi', request: [0x9f], response: [0x20, 0xba, 0x19], status: 'success',
  completedWallNs: id * 1_000_000, ...overrides,
})

describe('host prerequisites', () => {
  it('collects missing kernel modules from bound adapters only', () => {
    const gpio = spiAdapter({ id: 'gpio0', bus_type: 'gpio', driver: 'gpio-sim', state: 'unloaded', readiness: 'authorization_required', bindings: [{ device_id: 'bank', endpoint: 0, device_path: '/dev/gpiochipX' }] })
    const idle = spiAdapter({ id: 'spi9', readiness: 'unavailable', bindings: [] })
    const state = hostPrerequisites([spiAdapter({ state: 'unloaded', readiness: 'unavailable' }), gpio, idle])
    expect(state).toMatchObject({ missingModules: ['cuse', 'gpio-sim'], nodesOpen: 0, nodesTotal: 3 })
  })

  it('lists ready adapters that only need loading', () => {
    const state = hostPrerequisites([spiAdapter({ state: 'unloaded' })])
    expect(state.missingModules).toEqual([])
    expect(state.loadableAdapters.map((adapter) => adapter.id)).toEqual(['spi0'])
  })
})

describe('live device path', () => {
  const devices: Device[] = [{ id: 'flash', bus: 'spi', state: 'ready' }, { id: 'nor', bus: 'spi', state: null }, { id: 'eeprom', bus: 'i2c', state: null }]

  it('groups bound devices under their adapter in endpoint order', () => {
    const groups = buildDevicePath([spiAdapter(), spiAdapter({ id: 'empty', bindings: [] })], devices)
    expect(groups).toHaveLength(1)
    expect(groups[0].links.map((link) => link.binding.device_id)).toEqual(['flash', 'nor'])
    expect(unboundDevices([spiAdapter()], devices).map((device) => device.id)).toEqual(['eeprom'])
  })

  it('labels a link by its last traffic, idle, or down', () => {
    const now = 10_000
    expect(linkActivity(spiAdapter(), 'flash', [transaction(9_000)], now)).toEqual({ kind: 'active', label: 'TX 9F / RX 20 BA 19', failed: false })
    expect(linkActivity(spiAdapter(), 'flash', [transaction(1_000)], now + 5_000)).toEqual({ kind: 'idle', label: 'Idle' })
    expect(linkActivity(spiAdapter({ state: 'unloaded' }), 'flash', [], now)).toEqual({ kind: 'down', label: 'Not loaded' })
    const gpio = spiAdapter({ bus_type: 'gpio' })
    expect(linkActivity(gpio, 'flash', [transaction(9_500, { busType: 'gpio', gpioEdges: [{ line: 7, from: 0, to: 1 }] })], now))
      .toMatchObject({ kind: 'active', label: 'Edge ↑ (line 7)', edge: true })
  })
})

describe('transactions', () => {
  it('names SPI operations from the device command table and falls back to direction', () => {
    const commands = [{ name: 'read_jedec_id', opcode: 0x9f, allowed_states: [] }] satisfies DeviceCommand[]
    expect(transactionOperation(transaction(1), commands)).toBe('Read jedec id')
    expect(transactionOperation(transaction(1, { busType: 'i2c', request: [0xa0, 0x00], response: [0x12, 0x34] }), undefined)).toBe('Read (2 bytes)')
    expect(transactionOperation(transaction(1, { request: [0x06], response: [] }), commands)).toBe('Write (1 byte)')
  })

  it('formats virtual time as zero-padded seconds', () => {
    expect(virtualSeconds(2_318_000_000)).toBe('02.318')
    expect(virtualSeconds(undefined)).toBe('—')
  })

  it('places ticks inside the window and marks unconfigured buses', () => {
    const lanes = buildTimeline([transaction(9_000), transaction(8_000, { status: 'error' }), transaction(500)], [spiAdapter()], 10_000, 5_000)
    const spi = lanes.find((lane) => lane.bus === 'spi')
    expect(spi?.ticks.map((tick) => [tick.at, tick.failed])).toEqual([[0.8, false], [0.6, true]])
    expect(lanes.find((lane) => lane.bus === 'uart')).toMatchObject({ configured: false, ticks: [] })
  })
})

describe('scenario run', () => {
  const event = (eventId: number, payload: DomainEvent['payload']): DomainEvent => ({
    event_id: eventId, event_type: payload.kind, timestamp_virtual_ns: eventId * 1_000, timestamp_wall_ns: 0, scenario_run_id: 'run-1', payload,
  })
  const events = [
    event(1, { kind: 'scenario_started', scenario_id: 'jedec' }),
    event(2, { kind: 'scenario_step_started', step_id: 'reset', action: 'reset_device' }),
    event(4, { kind: 'scenario_step_completed', step_id: 'reset', action: 'reset_device', status: 'passed', error: null }),
    event(5, { kind: 'scenario_step_started', step_id: 'read', action: 'send_spi' }),
  ]

  it('tracks step states and durations while running', () => {
    const run = latestScenarioRun(events)
    expect(run).toMatchObject({ runId: 'run-1', scenarioId: 'jedec', status: 'running' })
    expect(run?.steps).toEqual([
      { id: 'reset', action: 'reset_device', state: 'passed', durationNs: 2_000, error: undefined },
      { id: 'read', action: 'send_spi', state: 'running' },
    ])
    expect(mergeScenarioSteps(run!, [{ id: 'reset', action: 'reset_device' }, { id: 'read', action: 'send_spi' }, { id: 'assert', action: 'assert_response' }]).map((step) => step.state))
      .toEqual(['passed', 'running', 'queued'])
  })

  it('reports the completion and failed steps', () => {
    const finished = latestScenarioRun([
      ...events,
      event(6, { kind: 'scenario_step_completed', step_id: 'read', action: 'send_spi', status: 'failed', error: 'mismatch' }),
      event(7, { kind: 'scenario_completed', scenario_id: 'jedec', status: 'failed', steps_passed: 1, steps_failed: 1, steps_skipped: 0 }),
    ])
    expect(finished).toMatchObject({ status: 'failed', passed: 1, failed: 1 })
    expect(finished?.steps[1]).toMatchObject({ state: 'failed', error: 'mismatch' })
  })
})

describe('endpoints', () => {
  it('formats endpoints the way Linux tools address them', () => {
    expect(formatEndpoint('spi', 1)).toBe('CS1')
    expect(formatEndpoint('i2c', 80)).toBe('0x50')
  })
})
