import { ChevronDown, Gem, PanelLeftClose } from 'lucide-react'
import { useMemo, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/features/auth/AuthProvider'
import { RequireAuth } from '@/features/auth/RequireAuth'
import { ThemeToggle } from '@/components/theme/ThemeProvider'
import { cn } from '@/lib/utils'
import { MobileNav, ModuleDock } from './Dock'
import { NavLayoutContext, readSidebarPref, writeSidebarPref } from './navLayout'
import { permissionForPath, visibleNavigation, type NavGroup } from './navigation'
import { BranchSwitcher, UserMenu } from './UserMenu'

const itemBase =
  'flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-sidebar-foreground/80 transition hover:bg-sidebar-active/60 hover:text-sidebar-foreground'

function SidebarGroup({ group }: { group: NavGroup }) {
  const location = useLocation()
  const isActive = group.items?.some((i) => location.pathname.startsWith(i.to)) ?? false
  const [open, setOpen] = useState(isActive)
  const Icon = group.icon

  if (group.to) {
    return (
      <NavLink
        to={group.to}
        end
        className={({ isActive: a }) => cn(itemBase, a && 'bg-sidebar-active font-medium text-sidebar-foreground')}
      >
        {({ isActive: a }) => (
          <>
            <span className={cn('grid size-7 place-items-center rounded-lg', a ? 'bg-primary text-primary-foreground shadow-[0_4px_12px_-4px_var(--primary)]' : 'bg-secondary/70')}>
              <Icon className="size-3.5" />
            </span>
            {group.label}
          </>
        )}
      </NavLink>
    )
  }

  return (
    <div>
      <button type="button" onClick={() => setOpen((o) => !o)} className={cn(itemBase, 'w-full', isActive && 'font-medium text-sidebar-foreground')}>
        <span className={cn('grid size-7 place-items-center rounded-lg', isActive ? 'bg-primary text-primary-foreground shadow-[0_4px_12px_-4px_var(--primary)]' : 'bg-secondary/70')}>
          <Icon className="size-3.5" />
        </span>
        <span className="flex-1 text-left">{group.label}</span>
        <ChevronDown className={cn('size-3.5 text-sidebar-muted transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="mt-0.5 mb-1 ml-[1.6rem] space-y-0.5 border-l border-border pl-3">
          {group.items?.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive: a }) =>
                cn(
                  'relative block rounded-lg px-2.5 py-1.5 text-[13px] text-sidebar-muted transition hover:text-sidebar-foreground',
                  a && 'bg-sidebar-active/70 font-medium text-primary before:absolute before:top-1/2 before:-left-[13px] before:h-4 before:w-0.5 before:-translate-y-1/2 before:rounded-full before:bg-glow',
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  )
}

export function AppLayout() {
  return (
    <RequireAuth>
      <Shell />
    </RequireAuth>
  )
}

/**
 * Desktop: sidebar, or — when the user hides it — a floating round-icon dock at
 * the bottom. Phones/tablets: always the bottom tab bar + "More" sheet.
 */
function Shell() {
  const { can } = useAuth()
  const { pathname } = useLocation()
  const menu = visibleNavigation(can)
  const [sidebar, setSidebar] = useState(readSidebarPref)
  const nav = useMemo(
    () => ({
      sidebar,
      toggleSidebar: () =>
        setSidebar((s) => {
          writeSidebarPref(!s)
          return !s
        }),
    }),
    [sidebar],
  )

  return (
    <NavLayoutContext.Provider value={nav}>
      <div className="flex min-h-screen">
        {sidebar && (
          <aside className="glass fixed inset-y-3 left-3 z-40 hidden w-64 flex-col rounded-2xl px-3 py-4 lg:flex">
            <div className="mb-5 flex items-center gap-2.5 px-2">
              <Brand />
              <ThemeToggle className="ml-auto size-8 text-sidebar-muted hover:bg-secondary hover:text-sidebar-foreground" />
              <button
                type="button"
                onClick={nav.toggleSidebar}
                aria-label="Hide sidebar"
                title="Hide sidebar"
                className="rounded-full p-1.5 text-sidebar-muted transition hover:bg-secondary hover:text-sidebar-foreground"
              >
                <PanelLeftClose className="size-4" />
              </button>
            </div>
            <nav className="-mr-1 flex-1 space-y-0.5 overflow-y-auto pr-1">
              {menu.map((g) => (
                <SidebarGroup key={g.label} group={g} />
              ))}
            </nav>
            <div className="mt-3 border-t border-[var(--glass-edge)] pt-3">
              <UserMenu placement="sidebar" />
            </div>
          </aside>
        )}

        <div className={cn('flex min-w-0 flex-1 flex-col overflow-x-clip', sidebar ?'lg:pl-[17.5rem]' : 'lg:pl-[4.75rem]')}>
          {/* On the dashboard with the sidebar open the bar would be empty (branch switcher and
              user card live elsewhere), so it is dropped and the greeting sits at the top. */}
          <header className={cn('sticky top-0 z-20 flex h-16 items-center gap-3 px-4 md:px-6', pathname === '/' && sidebar && 'lg:hidden')}>
            {/* Brand shows here whenever the sidebar isn't (always on mobile). */}
            <div className={cn('flex items-center gap-2.5', sidebar && 'lg:hidden')}>
              <Brand />
            </div>
            {/* The dashboard shows the branch switcher in its own toolbar, next to "All branches". */}
            {pathname !== '/' && (
              <span className="hidden sm:block">
                <BranchSwitcher />
              </span>
            )}
            {/* With the sidebar open (lg+) the user card lives at the bottom of the sidebar. */}
            <div className={cn('ml-auto flex items-center gap-2', sidebar && 'lg:hidden')}>
              <ThemeToggle className="glass" />
              <UserMenu />
            </div>
          </header>
          <main className="flex-1 px-4 pb-28 md:px-6 lg:pb-6">
            <RequireAuth permission={permissionForPath(pathname)}>
              <Outlet />
            </RequireAuth>
          </main>
        </div>

        {!sidebar && (
          <ModuleDock onShowSidebar={nav.toggleSidebar} className="fixed! top-1/2 left-3 z-30 hidden -translate-y-1/2 lg:block" />
        )}
        <MobileNav />
      </div>
    </NavLayoutContext.Provider>
  )
}

function Brand() {
  return (
    <>
      <Logo />
      <div className="leading-tight">
        <p className="text-[15px] font-semibold tracking-tight">Sampath</p>
        <p className="text-[11px] text-sidebar-muted">Pawning · Gold loans</p>
      </div>
    </>
  )
}

/** Brand mark used in the sidebar, the top bar and on the login screen. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-[0_6px_16px_-6px_var(--primary)]', className)}>
      <Gem className="size-[18px]" />
    </span>
  )
}
