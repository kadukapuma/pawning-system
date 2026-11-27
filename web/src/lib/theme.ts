import { createContext, useContext } from 'react'

export type ThemePref = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

export type ThemeCtx = { pref: ThemePref; theme: ResolvedTheme; setPref: (p: ThemePref) => void; toggle: () => void }

export const ThemeContext = createContext<ThemeCtx>({ pref: 'dark', theme: 'dark', setPref: () => {}, toggle: () => {} })

export const useTheme = () => useContext(ThemeContext)

// Keep in sync with the inline script in index.html (it applies the theme before React loads).
const KEY = 'sampath.theme'

export const systemDarkQuery = () => window.matchMedia('(prefers-color-scheme: dark)')

/** Remembered per browser; storage can be unavailable (private mode), so every access is guarded. */
/** Dark is the default until the user picks something else. */
export const DEFAULT_THEME: ThemePref = 'dark'

export function readThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' || v === 'system' ? v : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

export function writeThemePref(p: ThemePref) {
  try {
    localStorage.setItem(KEY, p)
  } catch {
    /* ignore */
  }
}

export function applyTheme(theme: ResolvedTheme) {
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
  root.style.colorScheme = theme // native controls, scrollbars, <select> popups
}
