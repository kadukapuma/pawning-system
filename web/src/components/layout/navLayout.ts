import { createContext, useContext } from 'react'

/** Whether the desktop sidebar is shown (false = floating dock at the bottom instead). */
export const NavLayoutContext = createContext<{ sidebar: boolean; toggleSidebar: () => void }>({
  sidebar: true,
  toggleSidebar: () => {},
})

export const useNavLayout = () => useContext(NavLayoutContext)

const KEY = 'sampath.nav.sidebar'

/** Remembered per browser; storage can be unavailable (private mode), so every access is guarded. */
export function readSidebarPref(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off'
  } catch {
    return true
  }
}

export function writeSidebarPref(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off')
  } catch {
    /* ignore */
  }
}
