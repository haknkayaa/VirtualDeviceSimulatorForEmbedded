import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DevicesPage } from './DevicesPage'
import { useEventStore } from '../../stores/eventStore'
import { jsonResponse, renderRoute } from '../../test/render'

function installDeviceApi() {
  let created = false
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/v1/devices' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { device_id: string }
      created = true
      return jsonResponse({ id: body.device_id, bus: 'spi', state: 'resetting' }, { status: 201 })
    }
    if (url === '/api/v1/devices') {
      return jsonResponse([
        { id: 'spi-flash-0', bus: 'spi', state: 'ready' },
        ...(created ? [{ id: 'spi-flash-1', bus: 'spi', state: 'resetting' }] : []),
      ])
    }
    if (url === '/api/v1/device-models') {
      return jsonResponse([
        { id: 'spi-flash-0', name: 'Reference Flash', bus: 'spi', model: 'generic-spi-command' },
        { id: 'i2c-sensor-0', name: 'Temperature Sensor', bus: 'i2c', model: 'generic-i2c-register' },
      ])
    }
    if (url === '/api/v1/adapters') {
      return jsonResponse([{
        id: 'spi0',
        name: 'SPI 0',
        bus_type: 'spi',
        driver: 'cuse',
        state: 'unloaded',
        readiness: 'ready',
        bus_number: 0,
        bindings: [{ device_id: 'spi-flash-0', endpoint: 0, device_path: '/dev/spidev0.0' }],
        daemon_pids: [],
      }])
    }
    if (url === '/api/v1/devices/spi-flash-0') return jsonResponse({ id: 'spi-flash-0', name: 'Reference Flash', bus: 'spi', type: 'Flash memory', model: 'generic-spi-command', version: '1.0', state: 'ready' })
    if (url === '/api/v1/devices/spi-flash-1') return jsonResponse({ id: 'spi-flash-1', name: 'Reference Flash', bus: 'spi', type: 'Flash memory', model: 'generic-spi-command', version: '1.0', state: 'resetting' })
    if (url === '/api/v1/devices/spi-flash-0/flow') return jsonResponse({
      schema_version: 1,
      flow: { id: 'spi-flash-0-behavior', kind: 'device_behavior', name: 'Reference behavior', revision: 1, created_at: '', updated_at: '' },
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      metadata: { behavior: { device_id: 'spi-flash-0' } },
    })
    if (url === '/api/v1/scenarios') return jsonResponse([])
    if (url === '/api/v1/devices/spi-flash-0/commands' && !init?.method) return jsonResponse([
      {
        name: 'READ_ID',
        opcode: 159,
        response: [239, 64, 24],
        allowed_states: ['ready'],
        shortcut: { tx: [159, 170, 85], rx_length: 3, description: 'Test RX and TX.' },
      },
    ])
    if (url === '/api/v1/devices/spi-flash-0/registers/1' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { value: number }
      return jsonResponse({ name: 'CONTROL', address: 1, width_bits: 8, access: 'rw', reset_value: 0, value: body.value, description: 'Device control register' })
    }
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
    expect(screen.getByRole('tab', { name: 'Behavior' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Register Map' })).toBeInTheDocument()
    expect(screen.getByText(/^2 registers/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Bitfield Inspector' })).toBeInTheDocument()
    expect(screen.queryByText('Loaded devices')).not.toBeInTheDocument()
    expect(screen.getByText('0x0010')).toBeInTheDocument()
    expect(screen.getByText('0x0020')).toBeInTheDocument()
    expect(screen.getByText('0x0030')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Live Read' })).not.toBeInTheDocument()
    expect(screen.queryByText('Auto Refresh')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Load adapter' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reset device' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Recent Transactions' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Register value draft' })).toHaveValue('0x12')
    expect(screen.queryByRole('heading', { name: 'Device Information' })).not.toBeInTheDocument()
    expect(screen.getByText('/dev/spidev0.0', { selector: '.device-profile-card code' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Add Device' }))
    expect(await screen.findByRole('dialog', { name: 'Add Device' })).toBeInTheDocument()
    const busType = screen.getByRole('combobox', { name: 'Bus type' })
    expect(busType).toHaveValue('spi')
    expect(Array.from(busType.querySelectorAll('option')).map((option) => option.value)).toEqual([
      'gpio',
      'spi',
      'i2c',
      'qspi',
      'uart',
      'ethernet',
    ])
    expect(screen.getByRole('combobox', { name: 'Device model' })).toHaveValue('spi-flash-0')
    expect(screen.getByRole('option', { name: 'Reference Flash · SPI' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Temperature Sensor · I2C' })).toBeInTheDocument()
    expect(screen.getByLabelText('Device instance ID')).toHaveValue('spi-flash-1')
    expect(screen.getByLabelText('Suggested device path')).toHaveValue('/dev/spidev0.0')
    expect(screen.getByText('Created by the SPI CUSE adapter for spi-flash-1.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Open Device Library' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await userEvent.click(screen.getByRole('tab', { name: 'Faults' }))
    await userEvent.click(screen.getByRole('button', { name: 'Enable read_id_timeout' }))
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/faults/read_id_timeout/enable',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('creates another runtime instance from a configured model', async () => {
    const fetchMock = installDeviceApi()
    renderRoute(<DevicesPage />, '/devices/spi-flash-0', '/devices/:deviceId')

    await screen.findAllByText('CONTROL')
    await userEvent.click(screen.getByRole('button', { name: 'Add Device' }))
    await screen.findByRole('combobox', { name: 'Device model' })
    await userEvent.click(screen.getByRole('button', { name: 'Create Instance' }))

    await screen.findByRole('link', { name: /spi-flash-1/i })
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /spi-flash-1/i })).toHaveAttribute('aria-current', 'page')
    })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/devices',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ template_id: 'spi-flash-0', device_id: 'spi-flash-1' }),
      }),
    )
  })

  it('keeps the bus and loaded device model selections in sync', async () => {
    installDeviceApi()
    renderRoute(<DevicesPage />, '/devices/spi-flash-0', '/devices/:deviceId')

    await screen.findAllByText('CONTROL')
    await userEvent.click(screen.getByRole('button', { name: 'Add Device' }))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Bus type' }), 'i2c')

    expect(screen.getByRole('combobox', { name: 'Device model' })).toHaveValue('i2c-sensor-0')
    expect(screen.getByRole('button', { name: 'Create Instance' })).toBeEnabled()
    expect(screen.queryByLabelText('Suggested device path')).not.toBeInTheDocument()

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Device model' }), 'spi-flash-0')
    expect(screen.getByRole('combobox', { name: 'Bus type' })).toHaveValue('spi')
    expect(screen.getByLabelText('Suggested device path')).toHaveValue('/dev/spidev0.0')
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

    await screen.findByText('Device control register')
    expect(screen.getByText('2.000 ms')).toBeInTheDocument()
    expect(screen.getByText('Write', { selector: '.transaction-write' })).toBeInTheDocument()
    expect(screen.getAllByText('0x12').length).toBeGreaterThan(1)
  })

  it('opens the Add Device dialog from the ?add=1 deep link and clears it on cancel', async () => {
    installDeviceApi()
    renderRoute(<DevicesPage />, '/devices?add=1', '/devices')

    expect(await screen.findByRole('dialog', { name: 'Add Device' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add Device' })).not.toBeInTheDocument())
  })

  it('applies a typed hex draft value from the bitfield inspector', async () => {
    const fetchMock = installDeviceApi()
    renderRoute(<DevicesPage />, '/devices/spi-flash-0', '/devices/:deviceId')

    const draft = await screen.findByRole('textbox', { name: 'Register value draft' })
    await userEvent.clear(draft)
    await userEvent.type(draft, '0x13')
    expect(screen.getByText('Draft 0x13')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bit 0 (BIT0)' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'Apply value' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/devices/spi-flash-0/registers/1',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ value: 19 }) }),
    ))
  })

  it('filters the register map and applies a bitfield draft through the control API', async () => {
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
    await userEvent.click(screen.getByRole('button', { name: 'Apply value' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/devices/spi-flash-0/registers/1',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ value: 19 }) }),
    ))
    expect(await screen.findByText('0x13', { selector: '.register-current-value' })).toBeInTheDocument()
  })

  it('lists device commands without exposing a REST transaction action', async () => {
    installDeviceApi()
    renderRoute(<DevicesPage />, '/devices/spi-flash-0', '/devices/:deviceId')

    await screen.findAllByText('CONTROL')
    await userEvent.click(screen.getByRole('tab', { name: 'Commands' }))
    expect((await screen.findAllByText('READ_ID')).length).toBeGreaterThan(0)
    expect(screen.getByText(/Execute hardware transactions through/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Execute command/i })).not.toBeInTheDocument()
  })

  it('shows bus-specific SPI adapter settings in Configuration', async () => {
    installDeviceApi()
    renderRoute(<DevicesPage />, '/devices/spi-flash-0', '/devices/:deviceId')

    await screen.findAllByText('CONTROL')
    await userEvent.click(screen.getByRole('tab', { name: 'Configuration' }))

    expect(screen.getByRole('heading', { name: 'SPI configuration' })).toBeInTheDocument()
    expect(within(screen.getByRole('complementary', { name: 'Device detail inspector' })).getByText('/dev/spidev0.0')).toBeInTheDocument()
    expect(screen.getByText('sudo build/adapters/spi-cuse/vds4e-spi-cuse --name spidev0.0 --device-id spi-flash-0 --socket /tmp/vds4e.sock')).toBeInTheDocument()
    expect(screen.getAllByText('Chip select').length).toBeGreaterThan(0)
    expect(screen.getByRole('heading', { name: 'Configuration Inspector' })).toBeInTheDocument()
    expect(screen.getAllByText('SPI topology').length).toBeGreaterThan(0)
    expect(screen.queryByText('No adapter assigned')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    const save = screen.getByRole('button', { name: 'Save' })
    expect(save).toBe(document.querySelector('.device-profile-card .configuration-save'))
    expect(save).toBeDisabled()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'CPOL' }), '1')
    expect(save).toBeEnabled()
    expect(save).toHaveClass('configuration-save-dirty')
  })

  it('shows an empty state when no SPI adapters exist', async () => {
    const fetchMock = installDeviceApi()
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/v1/adapters') return jsonResponse([])
      return fetchMock(input, init)
    }))
    renderRoute(<DevicesPage />, '/devices/spi-flash-0', '/devices/:deviceId')

    await screen.findAllByText('CONTROL')
    await userEvent.click(screen.getByRole('tab', { name: 'Configuration' }))

    expect(await screen.findByText('No adapters found')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open Adapters' })).toHaveAttribute('href', '/adapters')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('derives flow and scenario tabs from device-scoped routes', async () => {
    installDeviceApi()
    renderRoute(<DevicesPage />, '/devices/spi-flash-0/flows', '/devices/:deviceId/*')

    expect(await screen.findByRole('tab', { name: 'Behavior' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { name: 'Behavior Model' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: 'Test Scenarios' }))
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Test Scenarios' })).toHaveAttribute('aria-selected', 'true')
    })
    expect(await screen.findByRole('heading', { name: 'Scenario Flows' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Test Scenario Inspector' })).toBeInTheDocument()
    expect(screen.getByText('Definition')).toBeInTheDocument()
    expect(screen.getByText('Execution')).toBeInTheDocument()
    expect(screen.queryByText('No item selected')).not.toBeInTheDocument()
  })

  it('renders a structured error state when the registry is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ code: 'internal', message: 'registry offline' }, { status: 500 })))
    renderRoute(<DevicesPage />, '/devices', '/devices')
    expect(await screen.findByText('Registry unavailable')).toBeInTheDocument()
    expect(screen.getAllByText('registry offline')).toHaveLength(2)
  })
})
