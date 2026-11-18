import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, ShieldCheck, XCircle } from 'lucide-react'
import { useAuth } from '@/features/auth/AuthProvider'
import { api, type Ping } from '@/lib/api'

export function DashboardPage() {
  const { user, currentBranch } = useAuth()
  const ping = useQuery({
    queryKey: ['ping'],
    queryFn: async () => (await api.get<Ping>('/api/v1/ping')).data,
    retry: false,
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome, {user?.name}</h1>
        <p className="text-sm text-muted-foreground">
          Working in branch {currentBranch?.code} · {currentBranch?.name}. Business modules arrive from phase 4.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">API connection</h2>
          {ping.isPending && <p className="text-sm">Checking…</p>}
          {ping.isError && (
            <p className="flex items-center gap-2 text-sm text-destructive">
              <XCircle className="size-4" /> API not reachable.
            </p>
          )}
          {ping.data && (
            <p className="flex items-center gap-2 text-sm text-success">
              <CheckCircle2 className="size-4" /> Connected ({ping.data.timezone})
            </p>
          )}
        </div>

        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">Your access</h2>
          <p className="flex items-center gap-2 text-sm">
            <ShieldCheck className="size-4 text-primary" />
            {user?.roles.join(', ')} · {user?.permissions.length} permissions · {user?.branches.length} branch(es)
          </p>
        </div>
      </div>
    </div>
  )
}
