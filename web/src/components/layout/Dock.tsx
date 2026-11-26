import { LayoutDashboard, Menu, PanelLeftOpen, Plus, Search, Users, X, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/features/auth/AuthProvider'
import { cn } from '@/lib/utils'
import { visibleNavigation, type NavGroup } from './navigation'

/** Is this path inside the given group? ("/" only matches itself.) */
function inGroup(g: NavGroup, pathname: string) {
  if (g.to) return g.to === '/' ? pathname === '/' : pathname.startsWith(g.to)
  return g.items?.some((i) => pathname.startsWith(i.to)) ?? false
}

/* ================================================================ desktop dock */

/**
 * Slim vertical icon rail on the left, used on desktop when the sidebar is
 * hidden. Groups open their pages in a flyout to the right of the icon.
 */
export function ModuleDock({ className, onShowSidebar }: { className?: string; onShowSidebar?: () => void }) {
  const { can } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const menu = visibleNavigation(can)
  const [open, setOpen] = useState<string | null>(null)
  const [flyTop, setFlyTop] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(null)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [])

  const click = (g: NavGroup, button: HTMLElement) => {
    if (g.to) {
      setOpen(null)
      navigate(g.to)
      return
    }
    // Align the flyout with the clicked icon, but keep it on screen.
    const r = button.getBoundingClientRect()
    const rail = ref.current?.getBoundingClientRect()
    const height = 44 + (g.items?.length ?? 0) * 36
    const top = Math.min(r.top, window.innerHeight - height - 12)
    setFlyTop(Math.max(12, top) - (rail?.top ?? 0))
    setOpen((o) => (o === g.label ? null : g.label))
  }
  const openGroup = menu.find((g) => g.label === open)

  return (
    <div ref={ref} className={cn('relative max-h-[calc(100vh-1.5rem)]', className)}>
      {openGroup && (
        <div
          role="menu"
          aria-label={openGroup.label}
          style={{ top: flyTop }}
          className="absolute left-full z-10 ml-3 w-60 rounded-2xl border border-[var(--glass-edge)] bg-popover p-1.5 shadow-xl"
        >
          <p className="px-3 pt-1.5 pb-1 text-[11px] font-medium text-muted-foreground">{openGroup.label}</p>
          {openGroup.items?.map((it) => (
            <Link
              key={it.to}
              role="menuitem"
              to={it.to}
              onClick={() => setOpen(null)}
              className={cn('block rounded-xl px-3 py-2 text-sm hover:bg-secondary', pathname.startsWith(it.to) && 'bg-secondary font-medium text-primary')}
            >
              {it.label}
            </Link>
          ))}
        </div>
      )}
      <nav aria-label="Modules" className="glass flex max-h-[calc(100vh-1.5rem)] flex-col items-center gap-1.5 overflow-y-auto rounded-full p-1.5 [scrollbar-width:none]">
        {onShowSidebar && (
          <>
            <button
              type="button"
              onClick={onShowSidebar}
              aria-label="Show sidebar"
              title="Show sidebar"
              className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground shadow-[0_6px_16px_-6px_var(--primary)] transition hover:opacity-90"
            >
              <PanelLeftOpen className="size-4" />
            </button>
            <span className="my-0.5 h-px w-6 shrink-0 bg-border" />
          </>
        )}
        {menu.map((g) => {
          const active = inGroup(g, pathname)
          const isOpen = open === g.label
          return (
            <button
              key={g.label}
              type="button"
              onClick={(e) => click(g, e.currentTarget)}
              aria-label={g.label}
              aria-expanded={g.items ? isOpen : undefined}
              title={g.label}
              className={cn(
                'grid size-10 shrink-0 place-items-center rounded-full transition',
                isOpen ? 'bg-foreground text-background' : active ? 'bg-primary/15 text-primary ring-1 ring-primary/30' : 'bg-popover/70 hover:bg-popover',
              )}
            >
              <g.icon className="size-4" />
            </button>
          )
        })}
      </nav>
    </div>
  )
}

/* ================================================================ mobile */

/**
 * Phones/tablets: fixed bottom tab bar with the counter essentials, and a
 * "More" button that opens every module as a bottom sheet.
 */
export function MobileNav() {
  const { can } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const menu = visibleNavigation(can)
  const [sheet, setSheet] = useState(false)

  useEffect(() => {
    if (!sheet) return
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setSheet(false)
    document.addEventListener('keydown', esc)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', esc)
      document.body.style.overflow = overflow
    }
  }, [sheet])

  const tabs: { label: string; icon: LucideIcon; to: string; perm?: string; primary?: boolean }[] = [
    { label: 'Home', icon: LayoutDashboard, to: '/' },
    { label: 'Tickets', icon: Search, to: '/pawning/search', perm: 'pawn.view' },
    { label: 'New pawn', icon: Plus, to: '/pawning/new', perm: 'pawn.create', primary: true },
    { label: 'Customers', icon: Users, to: '/customers', perm: 'customers.view' },
  ]
  const visible = tabs.filter((t) => !t.perm || can(t.perm))
  const isActive = (to: string) => (to === '/' ? pathname === '/' : pathname.startsWith(to))
  const moreActive = !sheet && !visible.some((t) => isActive(t.to))

  return (
    <div className="lg:hidden">
      <nav
        aria-label="Main"
        className="glass fixed inset-x-3 bottom-3 z-40 flex items-end justify-around rounded-[1.75rem] px-2 pt-1.5 pb-[calc(0.375rem+env(safe-area-inset-bottom))]"
      >
        {visible.map((t) =>
          t.primary ? (
            <button
              key={t.to}
              type="button"
              onClick={() => navigate(t.to)}
              aria-label={t.label}
              className="-mt-5 grid size-13 place-items-center rounded-full bg-primary text-primary-foreground shadow-[0_8px_20px_-6px_var(--primary)] ring-4 ring-background active:scale-95"
            >
              <t.icon className="size-5" />
            </button>
          ) : (
            <button
              key={t.to}
              type="button"
              onClick={() => navigate(t.to)}
              aria-current={isActive(t.to) ? 'page' : undefined}
              className={cn('flex min-w-14 flex-col items-center gap-0.5 rounded-xl px-2 py-1 text-[10px] active:bg-secondary', isActive(t.to) ? 'font-medium text-primary' : 'text-muted-foreground')}
            >
              <t.icon className="size-5" />
              {t.label}
            </button>
          ),
        )}
        <button
          type="button"
          onClick={() => setSheet(true)}
          aria-expanded={sheet}
          className={cn('flex min-w-14 flex-col items-center gap-0.5 rounded-xl px-2 py-1 text-[10px] active:bg-secondary', moreActive ? 'font-medium text-primary' : 'text-muted-foreground')}
        >
          <Menu className="size-5" />
          More
        </button>
      </nav>

      {sheet && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="All modules">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setSheet(false)} />
          <div className="absolute inset-x-0 bottom-0 flex max-h-[85vh] flex-col rounded-t-3xl bg-popover pb-[env(safe-area-inset-bottom)] shadow-2xl">
            <div className="relative flex items-center justify-between px-5 pt-3 pb-2">
              <span className="absolute top-2 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full bg-border" />
              <h2 className="pt-2 text-base font-medium">All modules</h2>
              <button type="button" onClick={() => setSheet(false)} aria-label="Close" className="mt-2 rounded-full p-1.5 hover:bg-secondary">
                <X className="size-4" />
              </button>
            </div>
            <div className="space-y-4 overflow-y-auto px-4 pb-5">
              {menu.map((g) =>
                g.to ? (
                  <Link key={g.label} to={g.to} onClick={() => setSheet(false)} className="flex items-center gap-3 rounded-2xl bg-secondary/60 px-3 py-3 text-sm font-medium">
                    <span className="grid size-8 place-items-center rounded-full bg-primary/12 text-primary"><g.icon className="size-4" /></span>
                    {g.label}
                  </Link>
                ) : (
                  <section key={g.label}>
                    <h3 className="mb-1.5 flex items-center gap-2 px-1 text-xs font-medium text-muted-foreground">
                      <g.icon className="size-3.5" /> {g.label}
                    </h3>
                    <div className="grid grid-cols-2 gap-1.5">
                      {g.items?.map((it) => (
                        <Link
                          key={it.to}
                          to={it.to}
                          onClick={() => setSheet(false)}
                          className={cn('rounded-xl px-3 py-2.5 text-[13px] active:bg-secondary', pathname.startsWith(it.to) ? 'bg-primary/12 font-medium text-primary' : 'bg-secondary/60')}
                        >
                          {it.label}
                        </Link>
                      ))}
                    </div>
                  </section>
                ),
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
