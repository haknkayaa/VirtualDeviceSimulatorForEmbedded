import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DevicesPage } from './DevicesPage'
import { useEventStore } from '../../stores/eventStore'
import { jsonResponse, renderRoute } from '../../test/render'

function installDeviceApi() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/v1/devices') return jsonResponse([{ id: 'spi-flash-0', bus: 'spi', state: 'ready' }])
    if (url === '/api/v1/devices/spi-flash-0') return jsonResponse({ id: 'spi-flash-0', name: 'Reference Flash', bus: 'spi', type: 'Flash memory', model: 'generic-spi-command', version: '1.0', state: 'ready' })
    if (url.endsWith('/registers')) return jsonResponse([
      { name: 'CONTROL', address: 1, width_bits: 8, access: 'rw', reset_value: 0, value: 18, description: 'Device control register' },
      { name: 'STATUS', address: 2, width_bits: 8, access: 'ro', reset_value: 1, value: 1, description: 'Current device status' },
    ])
    if (url.endsWith('/state')) return jsonResponse({ device_id: 'spi-flash-0', state: 'ready' })
    if (url === '/api/v1/faults') return jsonResponse([{ id: 'read_id_timeout', device_id: 'spi-flash-0', enabled: false, priority: 10, persistent: false, trigger: 'always', action: 'timeout' }])
    if (url === '/api/v1/faults/read_id_timeout/enable' && init?.method === 'POST') return new Response(null, { status: 204 })
    throw new Error(`Unexpected request ${init?.method ?? 'GET'} ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('devices page', () => {
  afterEach(() => {
    useEventStore.getState().reset()
    vi.unstubAllGlobals()
  })

  it('renders device/register snapshots and toggles faults through REST', async () => {
    const fetchMock = installDeviceApi()
    renderRoute(<DevicesPage />, '/devices/spi-flash-0', '/devices/:deviceId')

    expect((await screen.findAllByText('CONTROL')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('0x12').length).toBeGreaterThan(0)
    expect(screen.getByText('Reference Flash')).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Device instances' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add Device' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /spi-flash-0/i })).toHaveAttribute('aria-current', 'page')
    expect(screen.getAllByText('Flash memory').length).toBeGreaterThan(0)
    expect(screen.getAllByText('generic-spi-command').length).toBeGreaterThan(0)
    expect(screen.getAllByText('1.0').length).toBeGreaterThan(0)
    expect(screen.getByRole('tab', { name: 'State Machine' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Register Map' })).toBeInTheDocument()
    expect(screen.getByText('2 Registers')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Bitfield Inspector' })).toBeInTheDocument()
    expect(screen.queryByText('Loaded devices')).not.toBeInTheDocument()
    expect(screen.getByText('0x0010')).toBeInTheDocument()
    expect(screen.getByText('0x0020')).toBeInTheDocument()
    expect(screen.getByText('0x0030')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Live Read' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('heading', { name: 'Recent Transactions' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Value Controls' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Validation & State' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Device Information' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Write' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Write & Verify' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Add Device' }))
    expect(screen.getByText('Choose an installed model')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open Device Library' })).toHaveAttribute('href', '/device-library')
    await userEvent.click(screen.getByRole('tab', { name: 'Faults' }))
    await userEvent.click(screen.getByRole('button', { name: 'Enable read_id_timeout' }))
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/faults/read_id_timeout/enable',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('renders recent register events in the device footer without a separate transaction path', async () => {
    installDeviceApi()
    useEventStore.getState().acceptEvent({
      event_id: 7,
      event_type: 'register_write',
      timestamp_virtual_ns: 2_000_000,
      timestamp_wall_ns: 0,
      device_id: 'spi-flash-0',
      payload: {
        kind: 'register_write',
        name: 'CONTROL',
        address: 1,
        old_value: 0,
        new_value: 18,
      },
    })
    renderRoute(<DevicesPage />, '/devices/spi-flash-0', '/devices/:deviceId')

    await screen.findAllByText('CONTROL')
    expect(screen.getByText('2.000 ms')).toBeInTheDocument()
    expect(screen.getByText('Write', { selector: '.transaction-write' })).toBeInTheDocument()
    expect(screen.getAllByText('0x12').length).toBeGreaterThan(1)
    expect(screen.getByText('Live snapshot')).toBeInTheDocument()
    expect(screen.getByText('100%')).toBeInTheDocument()
  })

  it('filters the register map and edits a local bitfield draft without issuing a write', async () => {
    const fetchMock = installDeviceApi()
    renderRoute(<DevicesPage />, '/devices/spi-flash-0', '/devices/:deviceId')

    await screen.findByText('Device control register')
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search registers' }), 'STATUS')
    expect(screen.getByText('Current device status')).toBeInTheDocument()
    expect(screen.queryByText('Device control register')).not.toBeInTheDocument()

    await userEvent.clear(screen.getByRole('searchbox', { name: 'Search registers' }))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Filter by access' }), 'rw')
    expect(screen.getByText('Device control register')).toBeInTheDocument()
    expect(screen.queryByText('Current device status')).not.toBeInTheDocument()

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Set BIT0' }), '1')
    expect(screen.getByText('Draft 0x13')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Apply value' })).toBeDisabled()
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/registers/'), expect.objectContaining({ method: 'POST' }))
  })

  it('shows explicit placeholders for device data outside the current API contract', async () => {
    installDeviceApi()
    renderRoute(<DevicesPage />, '/devices/spi-flash-0', '/devices/:deviceId')

    await screen.findAllByText('CONTROL')
    await userEvent.click(screen.getByRole('tab', { name: 'Commands' }))
    expect(screen.getByText('Not exposed yet')).toBeInTheDocument()
    expect(screen.getByText('Command metadata is not exposed by the current Control API.')).toBeInTheDocument()
  })

  it('renders a structured error state when the registry is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ code: 'internal', message: 'registry offline' }, { status: 500 })))
    renderRoute(<DevicesPage />, '/devices', '/devices')
    expect(await screen.findByText('Registry unavailable')).toBeInTheDocument()
    expect(screen.getAllByText('registry offline')).toHaveLength(2)
  })
})
