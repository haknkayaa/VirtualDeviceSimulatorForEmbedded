import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { RegisterMap } from './RegisterMap'
import type { DeviceRegister } from '../../types/api'

const registers: DeviceRegister[] = Array.from({ length: 12 }, (_, address) => ({
  name: `REGISTER_${address}`,
  address,
  width_bits: 8,
  access: 'rw',
  reset_value: 0,
  value: address,
  description: `Register ${address}`,
}))

describe('RegisterMap', () => {
  it('paginates after eight registers and supports expanded mode', async () => {
    render(<RegisterMap onSelect={vi.fn()} registers={registers} selectedAddress={0} />)

    expect(screen.getByText('REGISTER_0')).toBeInTheDocument()
    expect(screen.getByText('REGISTER_7')).toBeInTheDocument()
    expect(screen.queryByText('REGISTER_8')).not.toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Register pages' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '2' }))
    expect(screen.getByText('REGISTER_8')).toBeInTheDocument()
    expect(screen.queryByText('REGISTER_0')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Expand register map' }))
    expect(screen.getByRole('button', { name: 'Collapse register map' }).closest('section')).toHaveClass('expanded')
  })
})
