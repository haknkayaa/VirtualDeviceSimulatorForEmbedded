import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { DeviceLibraryPage } from './DeviceLibraryPage'
import { renderRoute } from '../../test/render'

describe('device library', () => {
  it('renders the public-safe local package catalog and selected details', () => {
    renderRoute(<DeviceLibraryPage />)

    expect(screen.getByRole('heading', { level: 1, name: 'Device Library' })).toBeInTheDocument()
    expect(screen.getByText('Generic SPI Flash 128 Mbit', { selector: 'h2' })).toBeInTheDocument()
    expect(screen.getAllByText('device-models/examples/generic-spi-flash/model.yaml')).toHaveLength(2)
    expect(screen.getByText('6 local packages')).toBeInTheDocument()
    expect(screen.getByText('Local assets only · no package registry or install API is enabled.')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Export package/i })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: /Export package/i }).every((button) => button.hasAttribute('disabled'))).toBe(true)
  })

  it('filters installed packages and changes the detail selection', async () => {
    renderRoute(<DeviceLibraryPage />)

    expect(screen.getByRole('button', { name: /Installed 6/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Community 0/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Private Registry 0/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Updates 0/i })).toBeDisabled()

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search device packages' }), 'compatibility')
    expect(screen.getByRole('button', { name: /SPI Flash Compatibility Fixture/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Linear Flow Foundation/i })).not.toBeInTheDocument()

    await userEvent.clear(screen.getByRole('searchbox', { name: 'Search device packages' }))
    await userEvent.click(screen.getByRole('button', { name: /Linear Flow Foundation/i }))
    expect(screen.getByText('Linear Flow Foundation', { selector: 'h2' })).toBeInTheDocument()
    expect(screen.getAllByText('Generic Start, Placeholder Action and End flow document demonstrating the reusable canvas.')).toHaveLength(2)
  })
})
