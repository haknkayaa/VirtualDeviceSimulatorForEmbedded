import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TransactionsPage } from './TransactionsPage'
import { jsonResponse, renderRoute } from '../../test/render'
import { useEventStore } from '../../stores/eventStore'
import type { DomainEvent } from '../../types/events'

function mockApi() {
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/api/v1/devices')) {
      return Promise.resolve(jsonResponse([{ id: 'spi-flash-0', bus: 'spi', state: 'ready' }]))
    }
    if (url.endsWith('/api/v1/telemetry/buses')) {
      return Promise.resolve(jsonResponse({
        generated_at_wall_ns: 1,
        window_seconds: 60,
        buses: [{
          device_id: 'spi-flash-0',
          bus_type: 'spi',
          health: 'healthy',
          transactions_total: 1,
          in_flight: 0,
          throughput: { tx_bytes_per_second: 4, rx_bytes_per_second: 3 },
          latency: { wall_avg_us: 12, wall_p95_us: 14, wall_max_us: 14, virtual_avg_ns: 0, virtual_p95_ns: 0, virtual_max_ns: 0 },
          errors: { count: 0, rate: 0 },
          retries: { count: 0 },
        }],
      }))
    }
    return Promise.resolve(jsonResponse({}))
  }))
}

function event(event: Partial<DomainEvent> & Pick<DomainEvent, 'event_id' | 'event_type' | 'payload'>): DomainEvent {
  return {
    timestamp_virtual_ns: 0,
    timestamp_wall_ns: 1_780_000_000_000_000_000,
    device_id: 'spi-flash-0',
    ...event,
  }
}

describe('live transactions workspace', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    useEventStore.getState().reset()
  })

  it('renders disconnected and replay cursor state without fabricating events', async () => {
    mockApi()
    useEventStore.getState().setConnection('disconnected')
    renderRoute(<TransactionsPage />)
    expect(await screen.findByText('Capture stream disconnected')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Bus Analyzer' })).toBeInTheDocument()
  })

  it('pairs live transaction events and renders waveform, hex, and telemetry', async () => {
    const user = userEvent.setup()
    mockApi()
    useEventStore.getState().setConnection('connected')
    useEventStore.getState().acceptEvent(event({
      event_id: 1,
      event_type: 'transaction_started',
      payload: { kind: 'transaction_started', transaction_id: 7, request: [0x9f, 0, 0, 0] },
    }))
    useEventStore.getState().acceptEvent(event({
      event_id: 2,
      event_type: 'transaction_completed',
      payload: { kind: 'transaction_completed', transaction_id: 7, response: [0, 0xef, 0x40, 0x18], result: 'success', error_code: null },
    }))
    renderRoute(<TransactionsPage />)

    expect(await screen.findByText('spi-flash-0 · #7')).toBeInTheDocument()
    expect(await screen.findByText('SPI signal scope')).toBeInTheDocument()
    expect(screen.getByText('TX Buffer')).toBeInTheDocument()
    expect(await screen.findByText('Bus Health Summary')).toBeInTheDocument()
    expect(await screen.findByText('4.00 B/s')).toBeInTheDocument()

    const pause = screen.getByRole('button', { name: 'Pause' })
    await user.click(pause)
    expect(pause).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Start Capture' }))
    expect(pause).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getByText('Waiting for bus traffic')).toBeInTheDocument()
  })
})
