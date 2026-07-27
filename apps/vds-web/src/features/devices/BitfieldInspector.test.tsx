import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { DeviceRegister } from '../../types/api'
import { BitfieldInspector } from './BitfieldInspector'

describe('BitfieldInspector', () => {
  it('renders undefined gaps alongside defined bitfields', () => {
    const register: DeviceRegister = {
      name: 'CONFIG',
      address: 1,
      width_bits: 8,
      access: 'rw',
      value: 0xa5,
      bitfields: [
        { name: 'MODE', lsb: 5, width: 2, access: 'rw' },
        { name: 'ENABLE', lsb: 0, width: 1, access: 'rw' },
      ],
    }

    render(<BitfieldInspector register={register} />)

    const undefinedRows = screen.getAllByRole('row').filter((row) => within(row).queryByText('UNDEFINED'))
    expect(undefinedRows).toHaveLength(2)
    expect(within(undefinedRows[0]).getByText('7')).toBeInTheDocument()
    expect(within(undefinedRows[1]).getByText('4:1')).toBeInTheDocument()
    expect(screen.getByText('MODE')).toBeInTheDocument()
    expect(screen.getByText('ENABLE')).toBeInTheDocument()
  })

  it('preserves editable synthetic bits when all bitfield metadata is absent', () => {
    render(<BitfieldInspector register={{
      name: 'RAW',
      address: 2,
      width_bits: 8,
      access: 'rw',
      value: 0,
    }} />)

    expect(screen.getByText('BIT7')).toBeInTheDocument()
    expect(screen.getByText('BIT0')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Set BIT0' })).toBeInTheDocument()
    expect(screen.queryByText('UNDEFINED')).not.toBeInTheDocument()
  })
})
