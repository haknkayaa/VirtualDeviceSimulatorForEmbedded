import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TransactionsPage } from './TransactionsPage'
import { jsonResponse, renderRoute } from '../../test/render'
import { useEventStore } from '../../stores/eventStore'

describe('transactions connection states', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('renders disconnected and replay cursor state without fabricating events', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([])))
    useEventStore.getState().setConnection('disconnected')
    renderRoute(<TransactionsPage />)
    expect(await screen.findByText('Live event stream disconnected')).toBeInTheDocument()
    expect(screen.getByText('after_event_id: 0')).toBeInTheDocument()
  })
})
