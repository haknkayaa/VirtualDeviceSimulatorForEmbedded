import { screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { jsonResponse, renderRoute } from '../test/render'
import type { Topology } from '../types/api'
import { SignalConnectionsPanel } from './SignalConnectionsPanel'

const topology: Topology = {
  attached: true,
  path: '/etc/vds4e/topology.yaml',
  connections: [
    {
      from: 'imu0.drdy', to: 'gpio0.GPIO16', source_device: 'imu0', source_signal: 'drdy', target_device: 'gpio0', target_line: 'GPIO16',
      delay_ns: 0, level: true, pending: [],
    },
    {
      from: 'imu0.drdy', to: 'gpio0.GPIO17', source_device: 'imu0', source_signal: 'drdy', target_device: 'gpio0', target_line: 'GPIO17',
      delay_ns: 500_000, level: true, pending: [{ due_ns: 2_000_000, value: true }],
    },
    {
      from: 'adc0.ready', to: 'gpio0.GPIO20', source_device: 'adc0', source_signal: 'ready', target_device: 'gpio0', target_line: 'GPIO20',
      delay_ns: 0, level: null, pending: [],
    },
  ],
}

function stubApi(body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/topology')) return jsonResponse(body)
    if (url.endsWith('/clock')) return jsonResponse({ virtual_time_ns: 1_500_000 })
    return jsonResponse({})
  }))
}

describe('SignalConnectionsPanel', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('lists every connection with its level and the delayed change still on the wire', async () => {
    stubApi(topology)
    renderRoute(<SignalConnectionsPanel />)

    const panel = await screen.findByRole('region', { name: 'Signal connections' })
    expect(within(panel).getByText('topology.yaml')).toHaveAttribute('title', '/etc/vds4e/topology.yaml')
    const rows = within(panel).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('imu0.drdy')
    expect(rows[0]).toHaveTextContent('gpio0.GPIO16')
    expect(rows[0]).toHaveTextContent('High')
    expect(rows[1]).toHaveTextContent('500.000 µs')
    expect(await within(rows[1]).findByText('High in 500.000 µs')).toBeInTheDocument()
    expect(rows[2]).toHaveTextContent('Not sampled')
    expect(within(rows[0]).getByRole('link', { name: 'imu0' })).toHaveAttribute('href', '/devices/imu0')
  })

  it('scopes to one device and leaves that device unlinked', async () => {
    stubApi(topology)
    renderRoute(<SignalConnectionsPanel deviceId="adc0" />)

    const panel = await screen.findByRole('region', { name: 'Signal connections' })
    const rows = within(panel).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(1)
    expect(within(rows[0]).queryByRole('link', { name: 'adc0' })).not.toBeInTheDocument()
    expect(within(rows[0]).getByRole('link', { name: 'gpio0' })).toBeInTheDocument()
  })

  it('renders nothing for a device without connections', async () => {
    stubApi(topology)
    renderRoute(<><SignalConnectionsPanel /><SignalConnectionsPanel deviceId="flash" /></>)

    await screen.findByRole('region', { name: 'Signal connections' })
    expect(screen.getAllByRole('region', { name: 'Signal connections' })).toHaveLength(1)
  })

  it('renders nothing without a topology', async () => {
    stubApi({ attached: false, path: null, connections: [] })
    const { container } = renderRoute(<SignalConnectionsPanel />)
    await vi.waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith(expect.stringMatching(/\/topology$/), expect.anything()))
    expect(container).toBeEmptyDOMElement()
  })
})
