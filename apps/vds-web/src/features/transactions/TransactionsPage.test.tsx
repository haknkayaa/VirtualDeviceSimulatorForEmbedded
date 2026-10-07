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
    if (url.endsWith('/api/v1/adapters')) {
      return Promise.resolve(jsonResponse([]))
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
    expect(screen.getByRole('heading', { name: 'Transactions' })).toBeInTheDocument()
    expect(screen.getByText('Bus Analyzer')).toBeInTheDocument()
  })

  it('pairs live transaction events and renders waveform, hex, and telemetry', async () => {
    const user = userEvent.setup()
    mockApi()
    useEventStore.getState().setConnection('connected')
    useEventStore.getState().acceptEvent(event({
      event_id: 1,
      event_type: 'transaction_started',
      payload: { kind: 'transaction_started', transaction_id: 7, request: [0x9f, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] },
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
    expect(screen.getByText('00000010')).toBeInTheDocument()
    expect(screen.getByText('|..|')).toBeInTheDocument()
    expect(await screen.findByText('Bus telemetry')).toBeInTheDocument()
    expect(await screen.findByRole('meter', { name: 'Success rate: 100.0%' })).toBeInTheDocument()
    expect(await screen.findByText('7.00 B/s')).toBeInTheDocument()
    expect(screen.getByText('4.00 B/s')).toBeInTheDocument()
    expect(screen.getByText('3.00 B/s')).toBeInTheDocument()
    expect(screen.getByText('Throughput')).toBeInTheDocument()
    expect(screen.getByText('0.00%')).toBeInTheDocument()
    expect(screen.getByText('Latency p95')).toBeInTheDocument()
    expect(screen.getAllByText('14 µs')).toHaveLength(2)
    expect(screen.getByText('12 µs')).toBeInTheDocument()

    const pause = screen.getByRole('button', { name: 'Pause' })
    const resume = screen.getByRole('button', { name: 'Resume' })
    expect(resume).toBeDisabled()
    await user.click(pause)
    expect(pause).toBeDisabled()
    await user.click(resume)
    expect(pause).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getByText('Waiting for bus traffic')).toBeInTheDocument()
  })

  it('selects and locks the transaction named by the ?transaction= deep link', async () => {
    mockApi()
    useEventStore.getState().setConnection('connected')
    useEventStore.getState().acceptEvents([
      event({ event_id: 1, event_type: 'transaction_started', payload: { kind: 'transaction_started', transaction_id: 7, request: [0x9f] } }),
      event({ event_id: 2, event_type: 'transaction_completed', payload: { kind: 'transaction_completed', transaction_id: 7, response: [0xef], result: 'success', error_code: null } }),
      event({ event_id: 3, event_type: 'transaction_started', timestamp_wall_ns: 1_780_000_000_000_100_000, payload: { kind: 'transaction_started', transaction_id: 8, request: [0x05] } }),
      event({ event_id: 4, event_type: 'transaction_completed', timestamp_wall_ns: 1_780_000_000_000_200_000, payload: { kind: 'transaction_completed', transaction_id: 8, response: [], result: 'error', error_code: 'device_busy' } }),
    ])
    renderRoute(<TransactionsPage />, '/transactions?transaction=spi-flash-0%3A7', '/transactions')

    expect(await screen.findByText('spi-flash-0 · #7')).toBeInTheDocument()
    expect(screen.getByText('Selection locked')).toBeInTheDocument()
    expect(screen.getByRole('row', { selected: true })).toHaveTextContent('9F ⇄ EF')
    expect(screen.getByRole('button', { name: /Follow/ })).toHaveAttribute('aria-pressed', 'false')
  })

  it('follows the newest transaction without a deep link', async () => {
    const user = userEvent.setup()
    mockApi()
    useEventStore.getState().setConnection('connected')
    useEventStore.getState().acceptEvents([
      event({ event_id: 1, event_type: 'transaction_started', payload: { kind: 'transaction_started', transaction_id: 7, request: [0x9f] } }),
      event({ event_id: 2, event_type: 'transaction_completed', timestamp_wall_ns: 1_780_000_000_000_100_000, payload: { kind: 'transaction_completed', transaction_id: 8, response: [], result: 'error', error_code: 'device_busy' } }),
    ])
    renderRoute(<TransactionsPage />, '/transactions', '/transactions')

    expect(await screen.findByText('spi-flash-0 · #8')).toBeInTheDocument()
    expect(screen.getByText('Live tail')).toBeInTheDocument()
    await user.click(screen.getByText('9F'))
    expect(await screen.findByText('spi-flash-0 · #7')).toBeInTheDocument()
    expect(screen.getByText('Selection locked')).toBeInTheDocument()
  })
})
