import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useEventStore } from '../../stores/eventStore'
import { jsonResponse, renderRoute } from '../../test/render'
import type { DomainEvent } from '../../types/events'
import { WaveformPage } from './WaveformPage'

function mockApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/api/v1/devices')) {
        return Promise.resolve(
          jsonResponse([
            { id: 'spi-flash-0', name: 'SPI NOR Flash', bus: 'spi', state: 'ready' },
            { id: 'i2c-eeprom-0', name: 'I2C EEPROM', bus: 'i2c', state: 'ready' },
          ]),
        )
      }
      if (url.endsWith('/api/v1/adapters')) {
        return Promise.resolve(jsonResponse([]))
      }
      return Promise.resolve(jsonResponse({}))
    }),
  )
}

function event(
  eventObj: Partial<DomainEvent> & Pick<DomainEvent, 'event_id' | 'event_type' | 'payload'>,
): DomainEvent {
  return {
    timestamp_virtual_ns: 10_000,
    timestamp_wall_ns: 1_780_000_000_000_000_000,
    device_id: 'spi-flash-0',
    ...eventObj,
  }
}

describe('WaveformPage & Logic Analyzer Protocol Viewer', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    useEventStore.getState().reset()
  })

  it('renders initial empty capture state and analyzer header', async () => {
    mockApi()
    useEventStore.getState().setConnection('connected')
    renderRoute(<WaveformPage />)

    expect(await screen.findByRole('heading', { name: 'Logic Analyzer & Waveforms' })).toBeInTheDocument()
    expect(screen.getByText('No bus traffic captured yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'VCD' })).toBeDisabled()
  })

  it('renders synthesized digital channels and decoded frames on transaction arrival', async () => {
    const user = userEvent.setup()
    mockApi()
    useEventStore.getState().setConnection('connected')

    // Feed SPI transaction
    useEventStore.getState().acceptEvent(
      event({
        event_id: 1,
        event_type: 'transaction_started',
        payload: {
          kind: 'transaction_started',
          transaction_id: 42,
          request: [0x9f, 0x00],
        },
      }),
    )
    useEventStore.getState().acceptEvent(
      event({
        event_id: 2,
        event_type: 'transaction_completed',
        payload: {
          kind: 'transaction_completed',
          transaction_id: 42,
          response: [0xef, 0x40],
          result: 'success',
          error_code: null,
        },
      }),
    )

    renderRoute(<WaveformPage />)

    // Check Channel Sidebar and timeline after devices resolve
    expect(await screen.findAllByText('CS#')).not.toHaveLength(0)
    expect(screen.getAllByText('SCLK')).not.toHaveLength(0)
    expect(screen.getAllByText('MOSI')).not.toHaveLength(0)
    expect(screen.getAllByText('MISO')).not.toHaveLength(0)

    // Export buttons should now be enabled
    const vcdBtn = screen.getByRole('button', { name: 'VCD' })
    expect(vcdBtn).toBeEnabled()

    // Decoded packets table
    expect(screen.getByText(/Decoded Protocol Packets/)).toBeInTheDocument()
    expect(screen.getByText('OP 0x9F')).toBeInTheDocument()

    // Clicking a packet sets timing cursors
    const packetRow = screen.getByText('OP 0x9F').closest('tr')!
    await user.click(packetRow)

    const timingHud = screen.getByRole('region', { name: 'Timing cursors measurement' })
    expect(timingHud).toBeInTheDocument()
    expect(timingHud.querySelector('.timing-hud-delta strong')?.textContent).not.toBe('—')

    // Toggle channel visibility
    const hideBtn = screen.getByRole('button', { name: 'Hide channel CS#' })
    await user.click(hideBtn)
    expect(screen.getByRole('button', { name: 'Show channel CS#' })).toBeInTheDocument()

    // Pause and Resume
    const pauseBtn = screen.getByRole('button', { name: 'Pause' })
    await user.click(pauseBtn)
    expect(pauseBtn).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument()

    // Clear capture
    const clearBtn = screen.getByRole('button', { name: 'Clear' })
    await user.click(clearBtn)
    expect(screen.getByText('No bus traffic captured yet')).toBeInTheDocument()
  })
})
