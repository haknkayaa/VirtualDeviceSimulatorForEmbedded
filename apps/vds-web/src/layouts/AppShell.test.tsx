import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { jsonResponse } from '../test/render'
import { AppShell } from './AppShell'

describe('AppShell', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/health')) return jsonResponse({ status: 'ok' })
      if (url.endsWith('/clock')) return jsonResponse({ virtual_time_ns: 1_500_000 })
      if (url.endsWith('/adapters')) return jsonResponse([{ id: 'spi0', name: 'SPI 0', bus_type: 'spi', driver: 'cuse', state: 'unloaded', readiness: 'ready', bus_number: 0, bindings: [{ device_id: 'flash', endpoint: 0, device_path: '/dev/spidev0.0' }], daemon_pids: [] }])
      if (url.endsWith('/devices')) return jsonResponse([{ id: 'flash', bus: 'spi', state: 'ready' }])
      if (url.endsWith('/faults')) return jsonResponse([])
      if (url.endsWith('/telemetry/buses')) return jsonResponse({ generated_at_wall_ns: 0, window_seconds: 60, buses: [] })
      return jsonResponse({})
    }))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('renders one navigation rail and a status bar without placeholder chrome', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/']}>
          <Routes><Route element={<AppShell />}><Route element={<p>home</p>} index /></Route></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getAllByRole('navigation')).toHaveLength(1)
    const nav = screen.getByRole('navigation', { name: 'Primary navigation' })
    for (const label of ['Overview', 'Adapters', 'Devices', 'Transactions', 'Logic Analyzer', 'Event Log', 'Device Library']) {
      expect(within(nav).getByRole('link', { name: new RegExp(label) })).toBeInTheDocument()
    }
    expect(screen.queryByText(/Pro\+|Account/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Notifications' })).not.toBeInTheDocument()

    const summary = screen.getByRole('banner', { name: 'Simulator summary' })
    expect(await within(summary).findByText('1.500 ms')).toBeInTheDocument()
    expect(await within(summary).findByText('Server connected')).toBeInTheDocument()
    expect(within(summary).getByText(/0 \/ 1/)).toBeInTheDocument()

    const status = screen.getByRole('contentinfo', { name: 'Simulator status' })
    expect(await within(status).findByRole('link', { name: '0 errors, 2 warnings' })).toBeInTheDocument()
    expect(within(status).getByText(/^VDS4E v\d/)).toBeInTheDocument()
  })
})
