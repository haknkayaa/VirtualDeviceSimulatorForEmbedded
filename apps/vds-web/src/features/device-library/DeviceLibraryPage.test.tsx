import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { DeviceLibraryPage } from './DeviceLibraryPage'
import { renderRoute } from '../../test/render'

describe('device library placeholder', () => {
  it('reserves the route without exposing unfinished library controls', () => {
    renderRoute(<DeviceLibraryPage />)

    expect(screen.getByRole('heading', { level: 1, name: 'Device Library' })).toBeInTheDocument()
    expect(screen.getByText('Device Library is not available yet')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
