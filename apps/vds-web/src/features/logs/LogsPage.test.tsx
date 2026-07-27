import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { useEventStore } from '../../stores/eventStore'
import { LogsPage } from './LogsPage'

describe('LogsPage', () => {
  afterEach(() => useEventStore.getState().reset())

  it('filters persistent events by device', async () => {
    const event = (eventId: number, deviceId: string) => ({
      event_id: eventId,
      event_type: 'device_reset' as const,
      timestamp_virtual_ns: eventId,
      timestamp_wall_ns: 1_700_000_000_000_000_000,
      device_id: deviceId,
      payload: { kind: 'device_reset' as const, result: 'success' },
    })
    useEventStore.getState().acceptEvent(event(1, 'flash-0'))
    useEventStore.getState().acceptEvent(event(2, 'flash-1'))

    render(<LogsPage />)
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Filter logs by device' }), 'flash-1')

    expect(screen.getByText('flash-1', { selector: '.logs-table-body strong' })).toBeInTheDocument()
    expect(screen.queryByText('flash-0', { selector: '.logs-table-body strong' })).not.toBeInTheDocument()
    expect(screen.getByText('1 / 2 events')).toBeInTheDocument()
  })
})
