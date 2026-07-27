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
    await userEvent.click(screen.getByRole('button', { name: 'Attach' }))
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
    expect(await screen.findByRole('dialog', { name: 'CUSE access required' })).toBeInTheDocument()
    expect(screen.getByText('sudo modprobe cuse')).toBeInTheDocument()
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument()
  })
})
