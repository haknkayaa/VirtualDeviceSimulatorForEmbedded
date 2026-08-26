import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { jsonResponse, renderRoute } from '../../test/render'
import type { Adapter } from '../../types/api'
import { AdaptersPage } from './AdaptersPage'

function adapter(overrides: Partial<Adapter> = {}): Adapter {
  return {
    id: 'spi0',
    name: 'SPI 0',
    bus_type: 'spi',
    driver: 'cuse',
    state: 'unloaded',
    readiness: 'ready',
    bus_number: 0,
    bindings: [],
    daemon_pids: [],
    ...overrides,
  }
}

describe('adapters page', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('attaches a device and controls adapter lifecycle through REST', async () => {
    let current = adapter()
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/adapters' && !init?.method) return jsonResponse([current])
      if (url === '/api/v1/devices') return jsonResponse([{ id: 'spi-flash-0', bus: 'spi', state: 'ready' }])
      if (url === '/api/v1/adapters/spi0/bindings' && init?.method === 'POST') {
        current = adapter({ bindings: [{ device_id: 'spi-flash-0', endpoint: 0, device_path: '/dev/spidev0.0' }] })
        return jsonResponse(current)
      }
      if (url === '/api/v1/adapters/spi0/load' && init?.method === 'POST') {
        current = { ...current, state: 'loaded', daemon_pids: [3456] }
        return jsonResponse(current)
      }
      if (url === '/api/v1/adapters/spi0/unload' && init?.method === 'POST') {
        current = { ...current, state: 'unloaded', daemon_pids: [] }
        return jsonResponse(current)
      }
      throw new Error(`Unexpected request ${init?.method ?? 'GET'} ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    renderRoute(<AdaptersPage />, '/adapters', '/adapters')

    expect(await screen.findByRole('heading', { name: 'SPI 0' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Connect device' }))
    expect((await screen.findAllByText('/dev/spidev0.0')).length).toBeGreaterThan(0)
    await userEvent.click(screen.getByRole('treeitem', { name: /SPI 0/i }))
    expect(await screen.findByRole('heading', { name: 'SPI 0' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Load Adapter' }))
    expect(await screen.findByText('#3456')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Unload' }))
    await waitFor(() => expect(screen.queryByText('#3456')).not.toBeInTheDocument())
  })

  it('uses an authorization dialog without collecting a sudo password', async () => {
    const current = adapter({
      readiness: 'authorization_required',
      bindings: [{ device_id: 'spi-flash-0', endpoint: 0, device_path: '/dev/spidev0.0' }],
    })
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/adapters') return jsonResponse([current])
      if (url === '/api/v1/devices') return jsonResponse([{ id: 'spi-flash-0', bus: 'spi', state: 'ready' }])
      if (url === '/api/v1/adapters/spi0/load' && init?.method === 'POST') {
        return jsonResponse(
          { code: 'adapter_authorization_required', message: 'CUSE authorization required' },
          { status: 403 },
        )
      }
      throw new Error(`Unexpected request ${init?.method ?? 'GET'} ${url}`)
    }))
    renderRoute(<AdaptersPage />, '/adapters', '/adapters')

    await screen.findAllByText('/dev/spidev0.0')
    await userEvent.click(screen.getByRole('button', { name: 'Load Adapter' }))
    expect(await screen.findByRole('dialog', { name: 'Kernel adapter access required' })).toBeInTheDocument()
    expect(screen.getByText(/sudo modprobe gpio-sim/)).toBeInTheDocument()
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument()
  })

  it('creates and loads a kernel GPIO controller', async () => {
    let current = [adapter()]
    let createBody: unknown
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/adapters' && !init?.method) return jsonResponse(current)
      if (url === '/api/v1/devices') return jsonResponse([{ id: 'generic-gpio-bank-32', bus: 'gpio', state: null }])
      if (url === '/api/v1/adapters' && init?.method === 'POST') {
        createBody = JSON.parse(String(init.body))
        const gpio = adapter({
          id: 'gpio0',
          name: 'GPIO 0',
          bus_type: 'gpio',
          driver: 'gpio-sim',
          line_count: 32,
          readiness: 'ready',
        })
        current = [...current, gpio]
        return jsonResponse(gpio, { status: 201 })
      }
      if (url === '/api/v1/adapters/gpio0/load' && init?.method === 'POST') {
        const gpio = { ...current[1], state: 'loaded' as const, device_path: '/dev/gpiochip4', daemon_pids: [4567] }
        current = [current[0], gpio]
        return jsonResponse(gpio)
      }
      if (url === '/api/v1/adapters/gpio0/bindings' && init?.method === 'POST') {
        const gpio = {
          ...current[1],
          bindings: [{ device_id: 'generic-gpio-bank-32', endpoint: 0, device_path: '/dev/gpiochipX' }],
        }
        current = [current[0], gpio]
        return jsonResponse(gpio)
      }
      throw new Error(`Unexpected request ${init?.method ?? 'GET'} ${url}`)
    }))
    renderRoute(<AdaptersPage />, '/adapters', '/adapters')

    await screen.findByRole('heading', { name: 'SPI 0' })
    await userEvent.click(screen.getByRole('button', { name: 'New Adapter' }))
    await userEvent.selectOptions(screen.getByLabelText('Bus type'), 'gpio')
    await userEvent.click(screen.getByRole('button', { name: 'Create Adapter' }))

    await screen.findByRole('heading', { name: 'GPIO 0' })
    expect(createBody).toEqual({
      id: 'gpio0',
      name: 'GPIO 0',
      bus_type: 'gpio',
      line_count: 32,
    })
    expect(screen.getAllByText('/dev/gpiochipX').length).toBeGreaterThan(0)
    await userEvent.click(screen.getByRole('button', { name: 'Attach' }))
    const loadButton = screen.getByRole('button', { name: 'Load Adapter' })
    await waitFor(() => expect(loadButton).toBeEnabled())
    await userEvent.click(loadButton)
    expect((await screen.findAllByText('/dev/gpiochip4')).length).toBeGreaterThan(0)
  })

  it('explains when a loaded UART port is already assigned', async () => {
    const current = adapter({
      id: 'uart0',
      name: 'UART 0',
      bus_type: 'uart',
      driver: 'pty',
      state: 'loaded',
      device_path: '/dev/pts/7',
      bindings: [{ device_id: 'serial-sensor-0', endpoint: 0, device_path: '/dev/pts/7' }],
    })
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/adapters') return jsonResponse([current])
      if (url === '/api/v1/devices') return jsonResponse([{ id: 'serial-sensor-0', bus: 'uart', state: 'ready' }])
      throw new Error(`Unexpected request GET ${url}`)
    }))
    renderRoute(<AdaptersPage />, '/adapters', '/adapters')

    expect(await screen.findByText('This UART port is fully assigned.')).toBeInTheDocument()
    expect(screen.getByText(/another UART adapter/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Connect device' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Detach serial-sensor-0' })).toBeDisabled()
  })

  it('explains that a loaded I2C topology must be unloaded before editing', async () => {
    const current = adapter({
      id: 'i2c0',
      name: 'I2C 0',
      bus_type: 'i2c',
      state: 'loaded',
      bindings: [{ device_id: 'temperature-0', endpoint: 0x48, device_path: '/dev/i2c-0' }],
    })
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/adapters') return jsonResponse([current])
      if (url === '/api/v1/devices') return jsonResponse([
        { id: 'temperature-0', bus: 'i2c', state: 'ready' },
        { id: 'eeprom-0', bus: 'i2c', state: 'ready' },
      ])
      throw new Error(`Unexpected request GET ${url}`)
    }))
    renderRoute(<AdaptersPage />, '/adapters', '/adapters')

    expect(await screen.findByText('Topology is locked while loaded.')).toBeInTheDocument()
    expect(screen.getByText(/Unload the I²C adapter/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Connect device' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Detach temperature-0' })).toBeDisabled()
  })
})
