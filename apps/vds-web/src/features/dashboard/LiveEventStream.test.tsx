import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { LiveEventStream } from './LiveEventStream'
import { useEventStore } from '../../stores/eventStore'
import type { DomainEvent } from '../../types/events'

const events: DomainEvent[] = [
  {
    event_id: 42,
    event_type: 'fault_triggered',
    timestamp_virtual_ns: 5_000_000,
    timestamp_wall_ns: 0,
    device_id: 'spi-flash-0',
    payload: {
      kind: 'fault_triggered',
      fault_id: 'read-timeout',
      command: 'read_id',
      trigger: 'always',
      trigger_count: 1,
      action: 'timeout',
      result: 'applied',
    },
  },
  {
    event_id: 43,
    event_type: 'transaction_completed',
    timestamp_virtual_ns: 6_000_000,
    timestamp_wall_ns: 0,
    device_id: 'spi-flash-0',
    payload: {
      kind: 'transaction_completed',
      transaction_id: 7,
      response: [],
      result: 'failed',
      error_code: 'fault_timeout',
    },
  },
  {
    event_id: 44,
    event_type: 'signal_changed',
    timestamp_virtual_ns: 7_000_000,
    timestamp_wall_ns: 0,
    device_id: 'generic-gpio-bank-32',
    payload: {
      kind: 'signal_changed',
      phase: 'delivered',
      source: 'spi-sensor-drdy.drdy',
      target: 'generic-gpio-bank-32.GPIO16',
      value: true,
      delay_ns: 500_000,
    },
  },
]

describe('dashboard live event stream', () => {
  afterEach(() => useEventStore.getState().reset())

  it('renders headerless event columns with severity, source, details, and timestamps', () => {
    render(<LiveEventStream events={events} />)

    expect(screen.queryByRole('columnheader')).not.toBeInTheDocument()
    expect(screen.getByText('warn')).toBeInTheDocument()
    expect(screen.getByText('error')).toBeInTheDocument()
    expect(screen.getAllByText('spi-flash-0')).toHaveLength(2)
    expect(screen.getByText('5.000 ms')).toBeInTheDocument()
    expect(screen.getByText('read-timeout · timeout')).toBeInTheDocument()
    expect(screen.getByText('fault_timeout')).toBeInTheDocument()
    expect(
      screen.getByText('spi-sensor-drdy.drdy → generic-gpio-bank-32.GPIO16 = high · delivered (+500.000 µs)'),
    ).toBeInTheDocument()
  })

  it('opens the existing event detail selection path', () => {
    render(<LiveEventStream events={events} />)
    fireEvent.click(screen.getByRole('button', { name: 'warn fault triggered on spi-flash-0' }))
    expect(useEventStore.getState().selectedEventId).toBe(42)
  })
})
