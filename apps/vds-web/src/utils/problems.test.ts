import { describe, expect, it } from 'vitest'

import type { Adapter, BusTelemetry, Device, Fault } from '../types/api'
import type { DomainEvent } from '../types/events'
import { collectProblems, countProblems } from './problems'

const adapter = (overrides: Partial<Adapter>): Adapter => ({
  id: 'spi0',
  name: 'SPI 0',
  bus_type: 'spi',
  driver: 'cuse',
  state: 'loaded',
  readiness: 'ready',
  bus_number: 0,
  bindings: [{ device_id: 'flash', endpoint: 0, device_path: '/dev/spidev0.0' }],
  daemon_pids: [],
  ...overrides,
})

const devices: Device[] = [
  { id: 'flash', bus: 'spi', state: 'ready' },
  { id: 'eeprom', bus: 'i2c', state: 'error' },
]

const failedTransaction = (eventId: number): DomainEvent => ({
  event_id: eventId,
  event_type: 'transaction_completed',
  timestamp_virtual_ns: eventId,
  timestamp_wall_ns: eventId,
  device_id: 'flash',
  payload: { kind: 'transaction_completed', transaction_id: eventId, response: [], result: 'failed', error_code: 'fault_timeout' },
})

describe('collectProblems', () => {
  it('reports a clean workspace as problem free', () => {
    const problems = collectProblems({ connectionStatus: 'connected', adapters: [adapter({})], devices: [devices[0]], events: [] })
    expect(problems).toEqual([])
  })

  it('derives adapter, device, fault, bus and event problems ordered by severity', () => {
    const fault: Fault = { id: 'timeout', device_id: 'flash', enabled: true, priority: 1, persistent: false, trigger: 'always', action: 'timeout' }
    const telemetry = {
      device_id: 'flash', bus_type: 'spi', health: 'degraded', transactions_total: 10, in_flight: 0,
      throughput: { tx_bytes_per_second: 0, rx_bytes_per_second: 0 },
      latency: { wall_avg_us: 0, wall_p95_us: 0, wall_max_us: 0, virtual_avg_ns: 0, virtual_p95_ns: 0, virtual_max_ns: 0 },
      errors: { count: 2, rate: 0.2, last_code: 'fault_timeout' }, retries: { count: 0 },
    } satisfies BusTelemetry
    const problems = collectProblems({
      connectionStatus: 'reconnecting',
      reconnectAttempt: 2,
      adapters: [
        adapter({ state: 'unloaded' }),
        adapter({ id: 'gpio0', bus_type: 'gpio', readiness: 'authorization_required', bindings: [] }),
      ],
      devices,
      faults: [fault],
      telemetry: [telemetry],
      events: [failedTransaction(1), failedTransaction(2)],
    })

    expect(problems.map((problem) => problem.id)).toEqual([
      'device-error-eeprom',
      'events-flash',
      'event-stream',
      'adapter-unloaded-spi0',
      'adapter-auth-gpio0',
      'fault-timeout',
      'bus-flash',
      'adapter-empty-gpio0',
      'device-unbound-eeprom',
    ])
    expect(problems.find((problem) => problem.id === 'events-flash')?.message).toBe('2 error events in session')
    expect(problems.find((problem) => problem.id === 'adapter-auth-gpio0')?.detail).toBe('sudo modprobe gpio-sim')
    expect(countProblems(problems)).toEqual({ errors: 2, warnings: 5 })
  })

  it('flags an unreachable control API', () => {
    const [problem] = collectProblems({ controlApiError: true, connectionStatus: 'connected', events: [] })
    expect(problem).toMatchObject({ severity: 'error', source: 'vds-server' })
  })
})
