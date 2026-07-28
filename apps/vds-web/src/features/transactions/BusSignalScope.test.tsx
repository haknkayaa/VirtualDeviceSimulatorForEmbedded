import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { BusSignalScope } from './BusSignalScope'
import { supportsSignalScope } from './signalScopeSupport'
import type { LiveTransaction } from './transactionModel'

function transaction(busType: string, request = [0xa5], response = [0x3c]): LiveTransaction {
  return {
    id: `${busType}:1`,
    transactionId: 1,
    deviceId: `${busType}-device`,
    busType,
    request,
    response,
    status: 'success',
  }
}

describe('protocol signal scopes', () => {
  it('renders I2C START, repeated START, STOP, and nine clocks per byte', () => {
    render(<BusSignalScope transaction={transaction('i2c')} />)

    expect(screen.getByText('I2C signal scope')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /I2C timing diagram with 2 bytes and 18 clock pulses/i })).toBeInTheDocument()
    expect(screen.getByText('START')).toBeInTheDocument()
    expect(screen.getByText('RESTART')).toBeInTheDocument()
    expect(screen.getByText('STOP')).toBeInTheDocument()
    expect(screen.getByText('TX A5')).toBeInTheDocument()
    expect(screen.getByText('RX 3C')).toBeInTheDocument()
  })

  it('renders UART as 8N1 frames and GPIO as eight line states', () => {
    const { rerender } = render(<BusSignalScope transaction={transaction('uart')} />)

    expect(screen.getByText('UART signal scope')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /UART 8N1 timing diagram with 2 frames/i })).toBeInTheDocument()
    expect(screen.getAllByText('D0…D7')).toHaveLength(2)

    rerender(<BusSignalScope transaction={transaction('gpio', [0x01], [])} />)
    expect(screen.getByText('GPIO signal scope')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /GPIO timing diagram with 1 bank samples/i })).toBeInTheDocument()
    expect(screen.getByText('G0')).toBeInTheDocument()
    expect(screen.getByText('G7')).toBeInTheDocument()
  })

  it('does not render an electrical scope for Ethernet', () => {
    const { container } = render(<BusSignalScope transaction={transaction('ethernet')} />)

    expect(supportsSignalScope('ethernet')).toBe(false)
    expect(container).toBeEmptyDOMElement()
  })
})
