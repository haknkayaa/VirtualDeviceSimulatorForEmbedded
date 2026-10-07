import { useLayoutEffect, useState } from 'react'

export type Theme = 'dark' | 'light'

const STORAGE_KEY = 'vds4e-theme'

function readStoredTheme(): Theme | null {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    return saved === 'dark' || saved === 'light' ? saved : null
  } catch {
    return null
  }
}

function preferredTheme(): Theme {
  return readStoredTheme() ?? (window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(preferredTheme)

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    try {
      window.localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // Storage may be unavailable (private mode); the theme still applies for this session.
    }
  }, [theme])

  return {
    theme,
    toggleTheme: () => setTheme((current) => current === 'dark' ? 'light' : 'dark'),
  }
}
