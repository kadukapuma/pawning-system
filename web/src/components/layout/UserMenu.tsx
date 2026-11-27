import { Building2, ChevronDown, LogOut } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ThemeSegmented } from '@/components/theme/ThemeProvider'
import { Picker } from '@/components/ui'
import { useAuth } from '@/features/auth/AuthProvider'

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('')
}

const roleLabel = (r: string) => r.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

export function BranchSwitcher() {
  const { user, currentBranch, switchBranch } = useAuth()
  if (!user || !currentBranch) return null

  if (user.branches.length <= 1) {
    return (
      <span className="glass flex h-10 items-center gap-2 rounded-full px-4 text-xs font-medium">
        <Building2 className="size-3.5" />
        {currentBranch.code} · {currentBranch.name}
      </span>
    )
  }

  return (
    <div className="glass flex h-10 items-center gap-1 rounded-full pl-4 text-xs font-medium">
      <Building2 className="size-3.5 shrink-0" />
      <Picker
        aria-label="Working branch"
        className="h-10 w-auto max-w-60 border-0 bg-transparent pr-3 pl-1 text-xs font-medium focus:ring-0"
        value={String(currentBranch.id)}
        options={user.branches.map((b) => ({ value: String(b.id), label: `${b.code} · ${b.name}` }))}
        onChange={async (v) => {
          const id = Number(v)
          await switchBranch(id)
          const b = user.branches.find((x) => x.id === id)
          toast.success(`Now working in ${b?.code} · ${b?.name}`)
        }}
      />
    </div>
  )
}

/** Signed-in user card. `placement="sidebar"` fills the sidebar width and opens its menu upward. */
export function UserMenu({ placement = 'header' }: { placement?: 'header' | 'sidebar' }) {
  const { user, logout } = useAuth()
  const inSidebar = placement === 'sidebar'
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  if (!user) return null

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={
          inSidebar
            ? 'flex w-full items-center gap-2.5 rounded-xl border border-[var(--glass-edge)] bg-popover/70 p-2 text-left transition hover:bg-popover'
            : 'glass flex h-10 items-center gap-2 rounded-full py-1 pr-3 pl-1 transition hover:bg-popover'
        }
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
          {initials(user.name)}
        </span>
        <span className={inSidebar ? 'min-w-0 flex-1 text-left' : 'hidden text-left sm:block'}>
          <span className="block truncate text-sm leading-tight font-medium">{user.name}</span>
          <span className="block truncate text-xs leading-tight text-muted-foreground">{roleLabel(user.roles[0] ?? '')}</span>
        </span>
        <ChevronDown className={inSidebar ? 'size-4 shrink-0 rotate-180 text-muted-foreground' : 'size-4 text-muted-foreground'} />
      </button>

      {open && (
        <div
          role="menu"
          className={
            inSidebar
              ? 'absolute right-0 bottom-full left-0 z-50 mb-2 rounded-2xl border border-[var(--glass-edge)] bg-popover p-1.5 shadow-xl'
              : 'absolute right-0 z-50 mt-2 w-56 rounded-2xl border border-[var(--glass-edge)] bg-popover p-1.5 shadow-xl'
          }
        >
          <div className="px-3 py-2 text-xs text-muted-foreground">
            Signed in as <span className="font-medium text-foreground">{user.username}</span>
          </div>
          <div className="px-1.5 pb-1.5">
            <ThemeSegmented />
          </div>
          <button
            role="menuitem"
            type="button"
            onClick={() => logout()}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm hover:bg-secondary"
          >
            <LogOut className="size-4" /> Sign out
          </button>
        </div>
      )}
    </div>
  )
}
