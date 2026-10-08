import { screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useEventStore } from '../../stores/eventStore'
import { jsonResponse, renderRoute } from '../../test/render'
import type { Adapter } from '../../types/api'
import { OverviewPage } from './OverviewPage'

const loadedAdapter: Adapter = {
  id: 'spi0', name: 'SPI 0', bus_type: 'spi', driver: 'cuse', state: 'loaded', readiness: 'ready', bus_number: 0,
  device_path: '/dev/spidev0.*', bindings: [{ device_id: 'flash', endpoint: 0, device_path: '/dev/spidev0.0' }], daemon_pids: [77],
}

function stubApi(adapters: Adapter[]) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/health')) return jsonResponse({ status: 'ok' })
    if (url.endsWith('/adapters')) return jsonResponse(adapters)
    if (url.endsWith('/devices')) return jsonResponse([{ id: 'flash', bus: 'spi', state: 'ready', name: 'SPI NOR', model: 'MT25QL256' }, { id: 'eeprom', bus: 'i2c', state: null }])
    if (url.endsWith('/devices/flash/commands')) return jsonResponse([{ name: 'read_jedec_id', opcode: 0x9f, allowed_states: ['ready'] }])
    if (url.endsWith('/faults')) return jsonResponse([])
    if (url.endsWith('/scenarios')) return jsonResponse([{ id: 'jedec', name: 'JEDEC identification', timeout_ms: 20, steps: 2, device_ids: ['flash'] }])
    if (url.endsWith('/scenarios/jedec')) return jsonResponse({ schema_version: 1, scenario: { id: 'jedec', name: 'JEDEC', timeout_ms: 20 }, steps: [{ id: 'read', action: 'send_spi', continue_on_failure: false }, { id: 'assert', action: 'assert_response', continue_on_failure: false }] })
    if (url.endsWith('/runs/run-7/result')) {
      const metric = (covered: number, total: number, missed: string[] = []) => ({ covered, total, missed })
      return jsonResponse({
        scenario_id: 'jedec', status: 'passed', started_virtual_ns: 0, completed_virtual_ns: 1, duration_virtual_ns: 1,
        steps_total: 2, steps_passed: 2, steps_failed: 0, steps_skipped: 0, steps: [],
        coverage: { devices: [{ device_id: 'flash', commands: metric(1, 21, ['WRITE_ENABLE']), registers: metric(0, 12), states: metric(2, 7), transitions: metric(1, 16), faults: metric(0, 0) }] },
      })
    }
    if (url.endsWith('/telemetry/buses')) return jsonResponse({ generated_at_wall_ns: 0, window_seconds: 60, buses: [] })
    return jsonResponse({})
  }))
}

describe('OverviewPage', () => {
  beforeEach(() => {
    const wall = Date.now() * 1_000_000
    useEventStore.getState().setConnection('connected')
    useEventStore.getState().acceptEvents([
      { event_id: 1, event_type: 'scenario_started', timestamp_virtual_ns: 1_000, timestamp_wall_ns: wall, scenario_run_id: 'run-7', payload: { kind: 'scenario_started', scenario_id: 'jedec' } },
      { event_id: 2, event_type: 'scenario_step_started', timestamp_virtual_ns: 1_000, timestamp_wall_ns: wall, scenario_run_id: 'run-7', payload: { kind: 'scenario_step_started', step_id: 'read', action: 'send_spi' } },
      { event_id: 3, event_type: 'transaction_started', timestamp_virtual_ns: 2_318_000_000, timestamp_wall_ns: wall, device_id: 'flash', payload: { kind: 'transaction_started', transaction_id: 9, request: [0x9f] } },
      { event_id: 4, event_type: 'transaction_completed', timestamp_virtual_ns: 2_318_000_000, timestamp_wall_ns: wall + 78_000, device_id: 'flash', payload: { kind: 'transaction_completed', transaction_id: 9, response: [0x20, 0xba, 0x19], result: 'success', error_code: null } },
    ])
  })
  afterEach(() => vi.unstubAllGlobals())

  it('draws the live device path with link activity and the running scenario', async () => {
    stubApi([loadedAdapter])
    renderRoute(<OverviewPage />)

    const path = await screen.findByRole('region', { name: 'Live device path' })
    expect(await within(path).findByText('SPI 0 / CUSE')).toBeInTheDocument()
    expect(within(path).getByText('Loaded · Ready')).toBeInTheDocument()
    expect(within(path).getByText('SPI NOR')).toBeInTheDocument()
    expect(within(path).getByText('TX 9F / RX 20 BA 19')).toBeInTheDocument()
    expect(within(path).getByText(/eeprom\./)).toBeInTheDocument()

    const scenario = screen.getByRole('region', { name: 'Scenario run' })
    expect(within(scenario).getByText('jedec')).toBeInTheDocument()
    expect(await within(scenario).findByText('Queued')).toBeInTheDocument()
    expect(within(scenario).getByText('Step 1 of 2')).toBeInTheDocument()

    const recent = screen.getByRole('region', { name: 'Recent transactions' })
    expect(within(recent).getByText('02.318')).toBeInTheDocument()
    expect(await within(recent).findByText('Read jedec id')).toBeInTheDocument()

    expect(screen.getByRole('region', { name: 'Attention' })).toHaveTextContent('All host prerequisites available')
    expect(screen.getByRole('link', { name: /Device$/ })).toHaveAttribute('href', '/devices?add=1')
  })

  it('names missing kernel modules with a copyable fix', async () => {
    stubApi([{ ...loadedAdapter, state: 'unloaded', readiness: 'unavailable' }])
    renderRoute(<OverviewPage />)

    const attention = await screen.findByRole('region', { name: 'Attention' })
    expect(await within(attention).findByText(/Kernel module missing: cuse/)).toBeInTheDocument()
    expect(within(attention).getByText('sudo modprobe cuse')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Live device path' })).getByText('Not loaded · cuse missing')).toBeInTheDocument()
  })

  it('shows the finished run\'s coverage summary', async () => {
    useEventStore.getState().acceptEvents([
      { event_id: 5, event_type: 'scenario_step_completed', timestamp_virtual_ns: 2_000, timestamp_wall_ns: 0, scenario_run_id: 'run-7', payload: { kind: 'scenario_step_completed', step_id: 'read', action: 'send_spi', status: 'passed', error: null } },
      { event_id: 6, event_type: 'scenario_completed', timestamp_virtual_ns: 3_000, timestamp_wall_ns: 0, scenario_run_id: 'run-7', payload: { kind: 'scenario_completed', scenario_id: 'jedec', status: 'passed', steps_passed: 2, steps_failed: 0, steps_skipped: 0 } },
    ])
    stubApi([loadedAdapter])
    renderRoute(<OverviewPage />)

    const scenario = await screen.findByRole('region', { name: 'Scenario run' })
    const coverage = await within(scenario).findByRole('definition')
    expect(coverage).toHaveTextContent('commands 1/21')
    expect(coverage).toHaveTextContent('transitions 1/16')
    expect(coverage).not.toHaveTextContent('faults')
    expect(within(coverage).getByText('1/21').closest('span')).toHaveAttribute('title', 'Not exercised: WRITE_ENABLE')
  })
})
