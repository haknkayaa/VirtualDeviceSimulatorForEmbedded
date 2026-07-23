import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { useTheme } from './useTheme'

describe('useTheme', () => {
  beforeEach(() => {
    localStorage.clear()
    delete document.documentElement.dataset.theme
  })

  it('applies and persists the selected color theme', () => {
    localStorage.setItem('vds4e-theme', 'dark')
    const { result } = renderHook(useTheme)
    expect(document.documentElement.dataset.theme).toBe('dark')
    act(() => result.current.toggleTheme())
    expect(result.current.theme).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(localStorage.getItem('vds4e-theme')).toBe('light')
  })
})
