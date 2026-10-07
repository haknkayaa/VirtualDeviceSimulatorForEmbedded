import { screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useEventStore } from '../../stores/eventStore'
import { jsonResponse, renderRoute } from '../../test/render'
import { OverviewPage } from './OverviewPage'

describe('OverviewPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/health')) return jsonResponse({ status: 'ok', system: { cpu_percent: 12.5 } })
      if (url.endsWith('/adapters')) return jsonResponse([{ id: 'spi0', name: 'SPI 0', bus_type: 'spi', driver: 'cuse', state: 'loaded', readiness: 'ready', bus_number: 0, bindings: [{ device_id: 'flash', endpoint: 0, device_path: '/dev/spidev0.0' }], daemon_pids: [77] }])
      if (url.endsWith('/devices')) return jsonResponse([{ id: 'flash', bus: 'spi', state: 'ready', name: 'SPI NOR' }, { id: 'eeprom', bus: 'i2c', state: 'ready' }])
      if (url.endsWith('/faults')) return jsonResponse([])
      if (url.endsWith('/telemetry/buses')) return jsonResponse({ generated_at_wall_ns: 0, window_seconds: 60, buses: [] })
      return jsonResponse({})
    }))
    useEventStore.getState().setConnection('connected')
    useEventStore.getState().acceptEvents([
      { event_id: 1, event_type: 'transaction_started', timestamp_virtual_ns: 1, timestamp_wall_ns: 1, device_id: 'flash', payload: { kind: 'transaction_started', transaction_id: 9, request: [0x9f, 0, 0, 0] } },
      { event_id: 2, event_type: 'transaction_completed', timestamp_virtual_ns: 2, timestamp_wall_ns: 2, device_id: 'flash', payload: { kind: 'transaction_completed', transaction_id: 9, response: [0, 0x20, 0xba, 0x19], result: 'success', error_code: null } },
    ])
  })
  afterEach(() => vi.unstubAllGlobals())

  it('puts device nodes, problems and recent bus traffic on the first screen', async () => {
    renderRoute(<OverviewPage />)

    const nodes = await screen.findByRole('region', { name: /device nodes/i })
    expect(await within(nodes).findByText('/dev/spidev0.0')).toBeInTheDocument()
    expect(within(nodes).getByText('SPI NOR')).toBeInTheDocument()
    expect(within(nodes).getByText('eeprom')).toBeInTheDocument()

    const problems = screen.getByRole('region', { name: /problems/i })
    expect(await within(problems).findByText(/Device is not bound to an adapter/)).toBeInTheDocument()

    const bus = screen.getByRole('region', { name: /bus activity/i })
    expect(within(bus).getByText('9F 00 00 00 → 00 20 BA 19')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Device$/ })).toHaveAttribute('href', '/devices?add=1')
  })
})
