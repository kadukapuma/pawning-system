import { useQuery } from '@tanstack/react-query'
import { Check, Lock } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button, Card, PageHeader, Spinner, Table, Td, Th } from '@/components/ui'
import { api } from '@/lib/api'
import { useApiMutation } from '@/lib/hooks'
import { roleLabel } from './UsersPage'

type RoleRow = { name: string; users_count: number; permissions: string[]; editable: boolean }
type Draft = Record<string, string[]>

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x))

/** Role × permission matrix. Roles are fixed; tick boxes to change what each role may do. */
export function RolesPage() {
  const roles = useQuery({
    queryKey: ['admin-roles'],
    queryFn: async () => (await api.get<{ data: RoleRow[]; meta: { all_permissions: string[] } }>('/api/v1/admin/roles')).data,
  })
  const list = useMemo(() => roles.data?.data ?? [], [roles.data])
  const all = roles.data?.meta.all_permissions ?? []

  const [draft, setDraft] = useState<Draft>({})
  useEffect(() => setDraft(Object.fromEntries(list.map((r) => [r.name, r.permissions]))), [list])

  const dirty = list.filter((r) => r.editable && draft[r.name] && !sameSet(draft[r.name], r.permissions))

  const save = useApiMutation<{ role: string; permissions: string[] }>({
    method: 'put',
    url: (b) => `/api/v1/admin/roles/${b.role}`,
    invalidate: [['admin-roles'], ['auth', 'me']],
  })
  const [saving, setSaving] = useState(false)
  const saveAll = async () => {
    setSaving(true)
    try {
      for (const r of dirty) await save.mutateAsync({ role: r.name, permissions: draft[r.name] })
      toast.success(dirty.length === 1 ? `${roleLabel(dirty[0].name)} permissions saved` : `${dirty.length} roles saved`)
    } catch {
      /* useApiMutation already shows the error */
    } finally {
      setSaving(false)
    }
  }

  const toggle = (role: string, perm: string) =>
    setDraft((d) => ({ ...d, [role]: d[role].includes(perm) ? d[role].filter((p) => p !== perm) : [...d[role], perm] }))

  // Group rows by module prefix ("pawn.create" → "pawn").
  const groups = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const p of all) {
      const g = p.split('.')[0]
      m.set(g, [...(m.get(g) ?? []), p])
    }
    return [...m.entries()]
  }, [all])

  if (roles.isPending) return <Spinner />

  return (
    <div>
      <PageHeader
        title="Roles & permissions"
        description="Tick a box to give a role that permission. Changes apply to every user with the role as soon as you save. Assign roles to users on the Users page."
        actions={
          <>
            <Button variant="secondary" disabled={dirty.length === 0 || saving} onClick={() => setDraft(Object.fromEntries(list.map((r) => [r.name, r.permissions])))}>
              Discard
            </Button>
            <Button disabled={dirty.length === 0} loading={saving} onClick={saveAll}>
              Save{dirty.length > 0 && ` (${dirty.length})`}
            </Button>
          </>
        }
      />
      <Card>
        <Table>
          <thead className="sticky top-0 z-10 bg-card">
            <tr>
              <Th>Permission</Th>
              {list.map((r) => (
                <Th key={r.name} className="text-center">
                  <span className="inline-flex items-center gap-1">
                    {roleLabel(r.name)}
                    {!r.editable && <Lock className="size-3 text-muted-foreground" aria-label="Not editable" />}
                  </span>
                  <div className="font-normal">{r.users_count} user(s)</div>
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map(([g, perms]) => [
              <tr key={`g-${g}`} className="bg-muted/40">
                <Td colSpan={list.length + 1} className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{g.replace(/_/g, ' ')}</Td>
              </tr>,
              ...perms.map((p) => (
                <tr key={p}>
                  <Td className="font-mono text-xs">{p}</Td>
                  {list.map((r) => {
                    const on = (draft[r.name] ?? r.permissions).includes(p)
                    const changed = on !== r.permissions.includes(p)
                    return (
                      <Td key={r.name} className={`text-center ${changed ? 'bg-warning/15' : ''}`}>
                        {r.editable ? (
                          <input
                            type="checkbox"
                            className="size-4 accent-[var(--primary)]"
                            checked={on}
                            disabled={saving}
                            onChange={() => toggle(r.name, p)}
                            aria-label={`${roleLabel(r.name)}: ${p}`}
                          />
                        ) : (
                          on && <Check className="mx-auto size-4 text-success" />
                        )}
                      </Td>
                    )
                  })}
                </tr>
              )),
            ])}
          </tbody>
        </Table>
      </Card>
      <p className="mt-3 text-xs text-muted-foreground">
        <Lock className="inline size-3" /> Super admin always has every permission, and you cannot change the role you hold yourself.
      </p>
    </div>
  )
}
