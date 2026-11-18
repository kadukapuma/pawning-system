import { KeyRound, Pencil, Plus, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Badge, Button, Card, Checkbox, Dialog, Field, Input, PageHeader, Select, Spinner, Table, Td, Th } from '@/components/ui'
import { useAuth } from '@/features/auth/AuthProvider'
import { useApiMutation, useApiQuery, useLookups } from '@/lib/hooks'
import type { AdminUser } from '@/lib/types'

export const roleLabel = (r: string | null) => (r ?? '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

export function UsersPage() {
  const users = useApiQuery<AdminUser[]>(['admin-users'], '/api/v1/admin/users')
  const [editing, setEditing] = useState<AdminUser | 'new' | null>(null)
  const [resetting, setResetting] = useState<AdminUser | null>(null)
  const [q, setQ] = useState('')

  const rows = useMemo(() => {
    const t = q.toLowerCase()
    return (users.data ?? []).filter((u) => !t || `${u.username} ${u.name} ${u.role}`.toLowerCase().includes(t))
  }, [users.data, q])

  return (
    <div>
      <PageHeader
        title="Users"
        description="Each user has one role and a home branch, and may be granted extra branches. Users are deactivated, never deleted."
        actions={<Button onClick={() => setEditing('new')}><Plus className="size-4" /> New user</Button>}
      />
      <Card>
        <div className="border-b p-3">
          <div className="relative max-w-sm">
            <Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by name, username, role…" className="pl-9" />
          </div>
        </div>
        {users.isPending ? (
          <div className="grid place-items-center py-14"><Spinner /></div>
        ) : (
          <Table>
            <thead>
              <tr><Th>Username</Th><Th>Name</Th><Th>Role</Th><Th>Home branch</Th><Th>Last sign-in</Th><Th>Status</Th><Th /></tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} className={u.is_active ? '' : 'opacity-60'}>
                  <Td className="font-mono text-xs">{u.username}</Td>
                  <Td className="font-medium">{u.name}</Td>
                  <Td><Badge tone="primary">{roleLabel(u.role)}</Badge></Td>
                  <Td>{u.branch?.code} · {u.branch?.name}{u.branch_ids.length > 0 && <span className="text-xs text-muted-foreground"> +{u.branch_ids.length}</span>}</Td>
                  <Td className="text-xs text-muted-foreground">{u.last_login_at ? new Date(u.last_login_at).toLocaleString() : 'never'}</Td>
                  <Td>{u.is_active ? <Badge tone="success">active</Badge> : <Badge>inactive</Badge>}</Td>
                  <Td className="text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" onClick={() => setResetting(u)} aria-label="Reset password"><KeyRound className="size-4" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(u)} aria-label="Edit"><Pencil className="size-4" /></Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <UserDialog user={editing} onClose={() => setEditing(null)} />
      <ResetPasswordDialog user={resetting} onClose={() => setResetting(null)} />
    </div>
  )
}

function UserDialog({ user, onClose }: { user: AdminUser | 'new' | null; onClose: () => void }) {
  const { data: lookups } = useLookups()
  const { user: me } = useAuth()
  const isNew = user === 'new'
  const blank = { username: '', name: '', email: '', phone: '', password: '', branch_id: '', role: 'cashier', branch_ids: [] as number[], is_active: true }
  const [f, setF] = useState(blank)

  const save = useApiMutation<Record<string, unknown>>({
    method: isNew ? 'post' : 'put',
    url: () => (isNew ? '/api/v1/admin/users' : `/api/v1/admin/users/${(user as AdminUser).id}`),
    invalidate: [['admin-users']],
    success: isNew ? 'User created' : 'User updated',
    onSuccess: onClose,
  })

  useEffect(() => {
    if (!user) return
    setF(
      user === 'new'
        ? { ...blank, branch_id: String(lookups?.branches[0]?.id ?? '') }
        : { ...blank, username: user.username, name: user.name, email: user.email ?? '', phone: user.phone ?? '', branch_id: String(user.branch?.id ?? ''), role: user.role ?? 'cashier', branch_ids: user.branch_ids, is_active: user.is_active },
    )
    save.clearErrors()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  const e = save.fieldErrors
  const roles = (lookups?.roles ?? []).filter((r) => r !== 'super_admin' || me?.roles.includes('super_admin'))
  const submit = () => {
    const body: Record<string, unknown> = {
      name: f.name, email: f.email || null, phone: f.phone || null, branch_id: Number(f.branch_id),
      role: f.role, branch_ids: f.branch_ids.filter((id) => id !== Number(f.branch_id)), is_active: f.is_active,
    }
    if (isNew) Object.assign(body, { username: f.username, password: f.password })
    save.mutate(body)
  }

  return (
    <Dialog
      open={!!user}
      onClose={onClose}
      title={isNew ? 'New user' : `Edit ${(user as AdminUser)?.username}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={submit}>Save</Button></>}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {isNew && (
          <Field label="Username" required error={e.username} hint="Letters, numbers, - and _">
            <Input value={f.username} onChange={(ev) => setF({ ...f, username: ev.target.value })} autoComplete="off" />
          </Field>
        )}
        <Field label="Full name" required error={e.name}>
          <Input value={f.name} onChange={(ev) => setF({ ...f, name: ev.target.value })} />
        </Field>
        {isNew && (
          <Field label="Password" required error={e.password} hint="At least 10 characters with letters and numbers">
            <Input type="password" value={f.password} onChange={(ev) => setF({ ...f, password: ev.target.value })} autoComplete="new-password" />
          </Field>
        )}
        <Field label="Role" required error={e.role}>
          <Select value={f.role} onChange={(ev) => setF({ ...f, role: ev.target.value })}>
            {roles.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
          </Select>
        </Field>
        <Field label="Home branch" required error={e.branch_id}>
          <Select value={f.branch_id} onChange={(ev) => setF({ ...f, branch_id: ev.target.value })}>
            {lookups?.branches.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
          </Select>
        </Field>
        <Field label="Email" error={e.email}><Input type="email" value={f.email} onChange={(ev) => setF({ ...f, email: ev.target.value })} /></Field>
        <Field label="Phone" error={e.phone}><Input value={f.phone} onChange={(ev) => setF({ ...f, phone: ev.target.value })} /></Field>
        <div className="space-y-1 sm:col-span-2">
          <p className="text-sm font-medium">Also allowed to work in</p>
          <div className="flex flex-wrap gap-4">
            {lookups?.branches.filter((b) => String(b.id) !== f.branch_id).map((b) => (
              <Checkbox
                key={b.id}
                label={`${b.code} · ${b.name}`}
                checked={f.branch_ids.includes(b.id)}
                onChange={(ev) => setF({ ...f, branch_ids: ev.target.checked ? [...f.branch_ids, b.id] : f.branch_ids.filter((x) => x !== b.id) })}
              />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Super admin, head office and auditor can always use every branch.</p>
        </div>
        <Checkbox label="Active (can sign in)" checked={f.is_active} onChange={(ev) => setF({ ...f, is_active: ev.target.checked })} />
      </div>
    </Dialog>
  )
}

function ResetPasswordDialog({ user, onClose }: { user: AdminUser | null; onClose: () => void }) {
  const [password, setPassword] = useState('')
  const save = useApiMutation<{ password: string }>({
    method: 'put',
    url: () => `/api/v1/admin/users/${user?.id}/password`,
    success: 'Password changed',
    onSuccess: onClose,
  })
  useEffect(() => { if (user) setPassword('') }, [user])

  return (
    <Dialog
      open={!!user}
      onClose={onClose}
      size="sm"
      title={`Reset password — ${user?.username ?? ''}`}
      description="Give the new password to the user in person."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate({ password })}>Set password</Button></>}
    >
      <Field label="New password" required error={save.fieldErrors.password} hint="At least 10 characters with letters and numbers">
        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
      </Field>
    </Dialog>
  )
}
