import { Monitor, Moon, Sun } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Toaster } from 'sonner'
import {
  applyTheme,
  readThemePref,
  systemDarkQuery,
  ThemeContext,
  useTheme,
  writeThemePref,
  type ResolvedTheme,
  type ThemeCtx,
  type ThemePref,
} from '@/lib/theme'
import { cn } from '@/lib/utils'

/** Light / dark / follow-the-OS theme, toggled via the `.dark` class on <html>. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>(readThemePref)
  const [systemDark, setSystemDark] = useState(() => systemDarkQuery().matches)

  useEffect(() => {
    const m = systemDarkQuery()
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    m.addEventListener('change', onChange)
    return () => m.removeEventListener('change', onChange)
  }, [])

  const theme: ResolvedTheme = pref === 'system' ? (systemDark ? 'dark' : 'light') : pref

  useEffect(() => applyTheme(theme), [theme])

  const value = useMemo<ThemeCtx>(() => {
    const setPref = (p: ThemePref) => {
      writeThemePref(p)
      setPrefState(p)
    }
    return { pref, theme, setPref, toggle: () => setPref(theme === 'dark' ? 'light' : 'dark') }
  }, [pref, theme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

/** Round icon button that flips between light and dark. */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useTheme()
  const next = theme === 'dark' ? 'light' : 'dark'
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      className={cn('grid size-10 shrink-0 place-items-center rounded-full transition hover:bg-popover', className)}
    >
      {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  )
}

const OPTIONS: { value: ThemePref; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
]

/** Three-way Light / Dark / System picker, used inside the user menu. */
export function ThemeSegmented() {
  const { pref, setPref } = useTheme()
  return (
    <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-1 rounded-xl bg-secondary p-1">
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={pref === value}
          onClick={() => setPref(value)}
          className={cn(
            'flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs transition',
            pref === value ? 'bg-popover font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Icon className="size-3.5" /> {label}
        </button>
      ))}
    </div>
  )
}

/** Sonner toasts that follow the app theme. */
export function ThemedToaster() {
  const { theme } = useTheme()
  return <Toaster richColors position="top-right" theme={theme} />
}
