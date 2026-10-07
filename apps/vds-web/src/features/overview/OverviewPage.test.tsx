import { fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useEventStore } from '../../stores/eventStore'
import { jsonResponse, renderRoute } from '../../test/render'
import type { Adapter } from '../../types/api'
import { OverviewPage } from './OverviewPage'

const loadedAdapter: Adapter = {
  id: 'spi0', name: 'SPI 0', bus_type: 'spi', driver: 'cuse', state: 'loaded', readiness: 'ready', bus_number: 0,
  bindings: [{ device_id: 'flash', endpoint: 0, device_path: '/dev/spidev0.0' }], daemon_pids: [77],
}

function stubApi(adapters: Adapter[]) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/health')) return jsonResponse({ status: 'ok' })
    if (url.endsWith('/adapters')) return jsonResponse(adapters)
    if (url.endsWith('/devices')) return jsonResponse([{ id: 'flash', bus: 'spi', state: 'ready', name: 'SPI NOR' }, { id: 'eeprom', bus: 'i2c', state: null }])
    if (url.endsWith('/faults')) return jsonResponse([])
    if (url.endsWith('/telemetry/buses')) return jsonResponse({ generated_at_wall_ns: 0, window_seconds: 60, buses: [] })
    return jsonResponse({})
  }))
}

describe('OverviewPage', () => {
  beforeEach(() => {
    useEventStore.getState().setConnection('connected')
    useEventStore.getState().acceptEvents([
      { event_id: 1, event_type: 'transaction_started', timestamp_virtual_ns: 1, timestamp_wall_ns: 1, device_id: 'flash', payload: { kind: 'transaction_started', transaction_id: 9, request: [0x9f, 0, 0, 0] } },
      { event_id: 2, event_type: 'transaction_completed', timestamp_virtual_ns: 2, timestamp_wall_ns: 2, device_id: 'flash', payload: { kind: 'transaction_completed', transaction_id: 9, response: [0, 0x20, 0xba, 0x19], result: 'success', error_code: null } },
    ])
  })
  afterEach(() => vi.unstubAllGlobals())

  it('collapses bring-up to one line and shows nodes, attention and bus lanes when the host is ready', async () => {
    stubApi([loadedAdapter])
    renderRoute(<OverviewPage />)

    const bringUp = await screen.findByRole('region', { name: 'Bring-up' })
    expect(bringUp).toHaveTextContent('1 of 1 device nodes open')

    const nodes = screen.getByRole('region', { name: /device nodes/i })
    expect(await within(nodes).findByText('/dev/spidev0.0')).toBeInTheDocument()
    expect(within(nodes).getByText('SPI NOR')).toBeInTheDocument()
    expect(within(nodes).queryByText('eeprom')).not.toBeInTheDocument()
    fireEvent.click(within(nodes).getByRole('button', { name: /1 device not bound to an adapter/ }))
    expect(within(nodes).getByText('eeprom')).toBeInTheDocument()

    expect(screen.getByRole('region', { name: /needs attention/i })).toHaveTextContent('Nothing needs attention')

    const lanes = screen.getByRole('region', { name: /bus activity/i })
    expect(within(lanes).getByRole('link', { name: '9F 00…' })).toHaveAttribute('href', '/transactions?transaction=flash%3A9')
    expect(within(lanes).getByText('No I2C adapter configured')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Device$/ })).toHaveAttribute('href', '/devices?add=1')
  })

  it('names the first failing bring-up step and its fix when kernel modules are missing', async () => {
    stubApi([{ ...loadedAdapter, state: 'unloaded', readiness: 'unavailable' }])
    renderRoute(<OverviewPage />)

    const bringUp = await screen.findByRole('region', { name: 'Bring-up' })
    const current = await within(bringUp).findByText('Kernel modules')
    expect(current.closest('li')).toHaveAttribute('aria-current', 'step')
    expect(within(bringUp).getByText('sudo modprobe cuse')).toBeInTheDocument()
    expect(within(bringUp).getByText('Adapters loaded').closest('li')).toHaveClass('step-blocked')
  })
})
