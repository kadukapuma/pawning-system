import { ChevronDown, Gem, Menu, X } from 'lucide-react'
import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/features/auth/AuthProvider'
import { RequireAuth } from '@/features/auth/RequireAuth'
import { cn } from '@/lib/utils'
import { permissionForPath, visibleNavigation, type NavGroup } from './navigation'
import { BranchSwitcher, UserMenu } from './UserMenu'

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
        className={({ isActive: a }) =>
          cn(
            'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/90 hover:bg-sidebar-active',
            a && 'bg-sidebar-active text-white',
          )
        }
      >
        <Icon className="size-4" />
        {group.label}
      </NavLink>
    )
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/90 hover:bg-sidebar-active"
      >
        <Icon className="size-4" />
        <span className="flex-1 text-left">{group.label}</span>
        <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="mt-1 ml-7 space-y-0.5 border-l border-white/10 pl-3">
          {group.items?.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive: a }) =>
                cn(
                  'block rounded px-2 py-1.5 text-sm text-sidebar-muted hover:text-white',
                  a && 'font-medium text-accent',
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

function Shell() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const { can } = useAuth()
  const { pathname } = useLocation()
  const menu = visibleNavigation(can)

  return (
    <div className="flex min-h-screen">
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 w-64 overflow-y-auto bg-sidebar px-3 py-4 transition-transform lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="mb-6 flex items-center gap-2 px-3">
          <div className="grid size-9 place-items-center rounded-lg bg-accent text-accent-foreground">
            <Gem className="size-5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Sampath Pawning</p>
            <p className="text-xs text-sidebar-muted">Gold loan management</p>
          </div>
          <button className="ml-auto text-white lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close menu">
            <X className="size-5" />
          </button>
        </div>
        <nav className="space-y-1">
          {menu.map((g) => (
            <SidebarGroup key={g.label} group={g} />
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-card/80 px-4 backdrop-blur">
          <button className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          <BranchSwitcher />
          <div className="ml-auto">
            <UserMenu />
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6">
          <RequireAuth permission={permissionForPath(pathname)}>
            <Outlet />
          </RequireAuth>
        </main>
      </div>
    </div>
  )
}
