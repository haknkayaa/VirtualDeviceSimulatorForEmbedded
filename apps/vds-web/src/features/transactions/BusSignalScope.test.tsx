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

  it('renders UART as 8N1 frames and every GPIO line state', () => {
    const { container, rerender } = render(<BusSignalScope transaction={transaction('uart')} />)

    expect(screen.getByText('UART signal scope')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /UART 8N1 timing diagram with 2 frames/i })).toBeInTheDocument()
    expect(screen.getAllByText('D0…D7')).toHaveLength(2)

    const gpioLines = Array.from({ length: 32 }, (_, line) => Number(line === 0 || line === 31))
    const gpioTransaction = transaction('gpio', gpioLines, gpioLines)
    gpioTransaction.gpioOutputLines = Array.from({ length: 32 }, (_, offset) => offset === 0)
    rerender(<BusSignalScope
      gpioControllerIndex={2}
      transaction={gpioTransaction}
    />)
    expect(screen.getByText('GPIO Line State View')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /GPIO line-state table with 32 lines/i })).toBeInTheDocument()
    expect(screen.getAllByText('GPIOx_IOy')).toHaveLength(2)
    expect(screen.getAllByText('INPUT/OUTPUT')).toHaveLength(2)
    expect(screen.getAllByText('HIGH/LOW')).toHaveLength(2)
    expect(screen.getAllByText('INDICATOR')).toHaveLength(2)
    expect(container.querySelectorAll('.gpio-bank')).toHaveLength(2)
    expect(container.querySelectorAll('.gpio-bank-1 .gpio-line')).toHaveLength(16)
    expect(container.querySelectorAll('.gpio-bank-2 .gpio-line')).toHaveLength(16)
    expect(screen.getByText('GPIO2_IO0')).toBeInTheDocument()
    expect(screen.getByText('GPIO2_IO31')).toBeInTheDocument()
    expect(screen.getAllByText('INPUT')).toHaveLength(31)
    expect(screen.getByText('OUTPUT')).toBeInTheDocument()
    expect(screen.getByText('G0…G31')).toBeInTheDocument()
    expect(screen.getAllByText('HIGH')).toHaveLength(2)
    expect(screen.getAllByText('LOW')).toHaveLength(30)
    expect(container.querySelectorAll('.gpio-value-indicator.high')).toHaveLength(2)
    expect(container.querySelectorAll('.gpio-value-indicator.low')).toHaveLength(30)
  })

  it('does not render an electrical scope for Ethernet', () => {
    const { container } = render(<BusSignalScope transaction={transaction('ethernet')} />)

    expect(supportsSignalScope('ethernet')).toBe(false)
    expect(container).toBeEmptyDOMElement()
  })
})
