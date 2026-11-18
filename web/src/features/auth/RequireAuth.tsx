import { Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './AuthProvider'

/** Redirects to /login when signed out; optionally requires a permission. */
export function RequireAuth({ children, permission }: { children: ReactNode; permission?: string }) {
  const { user, isLoading, can } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />

  if (permission && !can(permission)) {
    return (
      <div className="rounded-xl border bg-card p-10 text-center">
        <p className="font-medium">You don't have access to this page.</p>
        <p className="text-sm text-muted-foreground">Ask an administrator for the “{permission}” permission.</p>
      </div>
    )
  }

  return <>{children}</>
}
