import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DevicesPage } from './DevicesPage'
import { jsonResponse, renderRoute } from '../../test/render'

function installDeviceApi() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/v1/devices') return jsonResponse([{ id: 'spi-flash-0', bus: 'spi', state: 'ready' }])
    if (url === '/api/v1/devices/spi-flash-0') return jsonResponse({ id: 'spi-flash-0', bus: 'spi', state: 'ready' })
    if (url.endsWith('/registers')) return jsonResponse([{ name: 'CONTROL', address: 1, width_bits: 8, access: 'rw', value: 18 }])
    if (url.endsWith('/state')) return jsonResponse({ device_id: 'spi-flash-0', state: 'ready' })
    if (url === '/api/v1/faults') return jsonResponse([{ id: 'read_id_timeout', device_id: 'spi-flash-0', enabled: false, priority: 10, persistent: false, trigger: 'always', action: 'timeout' }])
    if (url === '/api/v1/faults/read_id_timeout/enable' && init?.method === 'POST') return new Response(null, { status: 204 })
    throw new Error(`Unexpected request ${init?.method ?? 'GET'} ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('devices page', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('renders device/register snapshots and toggles faults through REST', async () => {
    const fetchMock = installDeviceApi()
    renderRoute(<DevicesPage />, '/devices/spi-flash-0', '/devices/:deviceId')

    expect(await screen.findByText('CONTROL')).toBeInTheDocument()
    expect(screen.getAllByText('spi-flash-0').length).toBeGreaterThan(0)
    expect(screen.getByText('0x12')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Enable read_id_timeout' }))
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/faults/read_id_timeout/enable',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('renders a structured error state when the registry is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ code: 'internal', message: 'registry offline' }, { status: 500 })))
    renderRoute(<DevicesPage />, '/devices', '/devices')
    expect(await screen.findByText('Registry unavailable')).toBeInTheDocument()
    expect(screen.getByText('registry offline')).toBeInTheDocument()
  })
})
