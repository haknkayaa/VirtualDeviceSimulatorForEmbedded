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
        return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })
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

  it('renders the public-safe local package catalog and selected details', () => {
    renderRoute(<DeviceLibraryPage />)

    expect(screen.getByRole('heading', { level: 1, name: 'Device Library' })).toBeInTheDocument()
    expect(screen.getByText('Micron MT25QL256ABA8ESF-0SIT', { selector: 'h2' })).toBeInTheDocument()
    expect(screen.getByText('4 local packages')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import Package' })).toBeEnabled()
    expect(screen.queryByText(/Packages are installed into/)).not.toBeInTheDocument()
  })

  it('filters installed packages and changes the detail selection', async () => {
    renderRoute(<DeviceLibraryPage />)

    expect(screen.getByRole('button', { name: /Installed 4/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Community 0/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Private Registry 0/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Updates 0/i })).toBeDisabled()

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search device packages' }), 'ethernet')
    expect(screen.getByRole('button', { name: /Generic Ethernet Device/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Generic I2C Device/i })).not.toBeInTheDocument()

    await userEvent.clear(screen.getByRole('searchbox', { name: 'Search device packages' }))
    await userEvent.click(screen.getByRole('button', { name: /Generic I2C Device/i }))
    expect(screen.getByText('Generic I2C Device', { selector: 'h2' })).toBeInTheDocument()
    expect(screen.getByText('Installed', { selector: '.package-install-state strong' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Add Device' })).toHaveAttribute('href', '/devices')
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
