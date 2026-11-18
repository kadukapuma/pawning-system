import { Building2, ChevronDown, LogOut } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
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
      <span className="flex items-center gap-1.5 rounded-md bg-secondary px-2.5 py-1 text-xs font-medium">
        <Building2 className="size-3.5" />
        {currentBranch.code} · {currentBranch.name}
      </span>
    )
  }

  return (
    <label className="flex items-center gap-1.5 rounded-md bg-secondary px-2 py-1 text-xs font-medium">
      <Building2 className="size-3.5" />
      <span className="sr-only">Working branch</span>
      <select
        className="bg-transparent outline-none"
        value={currentBranch.id}
        onChange={async (e) => {
          const id = Number(e.target.value)
          await switchBranch(id)
          const b = user.branches.find((x) => x.id === id)
          toast.success(`Now working in ${b?.code} · ${b?.name}`)
        }}
      >
        {user.branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.code} · {b.name}
          </option>
        ))}
      </select>
    </label>
  )
}

export function UserMenu() {
  const { user, logout } = useAuth()
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
        className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-secondary"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="grid size-8 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
          {initials(user.name)}
        </span>
        <span className="hidden text-left sm:block">
          <span className="block text-sm leading-tight font-medium">{user.name}</span>
          <span className="block text-xs leading-tight text-muted-foreground">{roleLabel(user.roles[0] ?? '')}</span>
        </span>
        <ChevronDown className="size-4 text-muted-foreground" />
      </button>

      {open && (
        <div role="menu" className="absolute right-0 mt-2 w-56 rounded-lg border bg-popover p-1 shadow-lg">
          <div className="px-3 py-2 text-xs text-muted-foreground">
            Signed in as <span className="font-medium text-foreground">{user.username}</span>
          </div>
          <button
            role="menuitem"
            type="button"
            onClick={() => logout()}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-secondary"
          >
            <LogOut className="size-4" /> Sign out
          </button>
        </div>
      )}
    </div>
  )
}
