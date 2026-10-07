import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DeviceLibraryPage } from './DeviceLibraryPage'
import { renderRoute } from '../../test/render'

describe('device library', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/v1/device-packages') && !init?.method) {
        return new Response(JSON.stringify([
          { id: 'micron-mt25ql256aba8esf-0sit', name: 'Micron MT25QL256ABA8ESF-0SIT', version: '0.1.0', bus: 'spi' },
          { id: 'atmel-at24c256', name: 'Atmel AT24C256', version: '1.0.0', bus: 'i2c' },
        ]), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.endsWith('/api/v1/device-packages/import')) {
        return new Response(JSON.stringify({
          id: 'imported-sensor',
          name: 'Imported Sensor',
          version: '1.0.0',
          bus: 'i2c',
        }), { status: 201, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } })
    }))
  })

  it('renders the package-service catalog and selected details', async () => {
    renderRoute(<DeviceLibraryPage />)

    expect(screen.getByRole('heading', { level: 1, name: 'Device Library' })).toBeInTheDocument()
    expect(await screen.findByText('Micron MT25QL256ABA8ESF-0SIT', { selector: 'h2' })).toBeInTheDocument()
    expect(screen.getByText('2 local packages')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import Package' })).toBeEnabled()
    expect(screen.queryByText(/Packages are installed into/)).not.toBeInTheDocument()
  })

  it('filters installed packages and changes the detail selection', async () => {
    renderRoute(<DeviceLibraryPage />)

    expect(await screen.findByRole('button', { name: /Micron MT25QL256/i })).toHaveAttribute('aria-pressed', 'true')

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search device packages' }), 'micron')
    expect(screen.getByRole('button', { name: /Micron MT25QL256/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Atmel AT24C256/i })).not.toBeInTheDocument()
    expect(screen.getByText('1 of 2 local packages')).toBeInTheDocument()

    await userEvent.clear(screen.getByRole('searchbox', { name: 'Search device packages' }))
    await userEvent.click(screen.getByRole('button', { name: 'I2C' }))
    expect(screen.queryByRole('button', { name: /Micron MT25QL256/i })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'All' }))

    await userEvent.clear(screen.getByRole('searchbox', { name: 'Search device packages' }))
    await userEvent.click(screen.getByRole('button', { name: /Atmel AT24C256/i }))
    expect(screen.getByText('Atmel AT24C256', { selector: 'h2' })).toBeInTheDocument()
    expect(screen.getByText('Installed', { selector: '.package-install-state strong' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Add Device' })).toHaveAttribute('href', '/devices?add=1')
  })

  it('uploads a selected package directory and adds it to the catalog', async () => {
    renderRoute(<DeviceLibraryPage />)
    const manifest = new File(['manifest'], 'device-package.yaml', { type: 'text/yaml' })
    Object.defineProperty(manifest, 'webkitRelativePath', { value: 'imported-sensor/device-package.yaml' })

    fireEvent.change(screen.getByLabelText('Choose device package directory'), {
      target: { files: [manifest] },
    })

    expect(await screen.findByText('Imported Sensor', { selector: 'h2' })).toBeInTheDocument()
    expect(screen.getByText('Imported Sensor installed')).toBeInTheDocument()
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      '/api/v1/device-packages/import',
      expect.objectContaining({ method: 'POST' }),
    ))
  })
})
