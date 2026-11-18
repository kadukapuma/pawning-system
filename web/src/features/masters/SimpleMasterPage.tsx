import { Pencil, Plus, Search } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Badge, Button, Card, Checkbox, Dialog, EmptyState, Field, Input, PageHeader, Select, Spinner, Table, Td, Th } from '@/components/ui'
import { useAuth } from '@/features/auth/AuthProvider'
import { useApiMutation, useApiQuery } from '@/lib/hooks'

export type FieldDef = {
  name: string
  label: string
  type?: 'text' | 'select' | 'checkbox'
  options?: { value: string; label: string }[]
  required?: boolean
  /** Shown only when creating (e.g. a permanent code). */
  createOnly?: boolean
  hint?: string
}

export type ColumnDef<T> = { label: string; render: (row: T) => ReactNode; className?: string }

/**
 * List + add/edit dialog for small master tables (categories, conditions,
 * branches, ...). Rows are never deleted — use the Active checkbox.
 */
export function SimpleMasterPage<T extends { id: number; is_active?: boolean }>({
  title,
  description,
  endpoint,
  queryKey,
  permission,
  columns,
  fields,
  searchText,
  extraInvalidate = [['lookups']],
}: {
  title: string
  description?: string
  endpoint: string
  queryKey: string
  permission: string
  columns: ColumnDef<T>[]
  fields: FieldDef[]
  searchText: (row: T) => string
  extraInvalidate?: string[][]
}) {
  const { can } = useAuth()
  const list = useApiQuery<T[]>([queryKey], endpoint)
  const [editing, setEditing] = useState<T | 'new' | null>(null)
  const [q, setQ] = useState('')

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    return (list.data ?? []).filter((r) => !term || searchText(r).toLowerCase().includes(term))
  }, [list.data, q, searchText])

  return (
    <div>
      <PageHeader
        title={title}
        description={description}
        actions={can(permission) && <Button onClick={() => setEditing('new')}><Plus className="size-4" /> Add</Button>}
      />
      <Card>
        <div className="border-b p-3">
          <div className="relative max-w-sm">
            <Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter…" className="pl-9" />
          </div>
        </div>
        {list.isPending ? (
          <div className="grid place-items-center py-14"><Spinner /></div>
        ) : rows.length === 0 ? (
          <EmptyState title="Nothing here yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                {columns.map((c) => <Th key={c.label} className={c.className}>{c.label}</Th>)}
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={r.is_active === false ? 'opacity-60' : ''}>
                  {columns.map((c) => <Td key={c.label} className={c.className}>{c.render(r)}</Td>)}
                  <Td>{r.is_active === false ? <Badge>inactive</Badge> : <Badge tone="success">active</Badge>}</Td>
                  <Td className="text-right">
                    {can(permission) && (
                      <Button size="sm" variant="ghost" onClick={() => setEditing(r)} aria-label="Edit"><Pencil className="size-4" /></Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <p className="px-3 py-2 text-xs text-muted-foreground">{rows.length} record(s)</p>
      </Card>

      <EditDialog
        row={editing}
        onClose={() => setEditing(null)}
        endpoint={endpoint}
        fields={fields}
        invalidate={[[queryKey], ...extraInvalidate]}
        title={title}
      />
    </div>
  )
}

function EditDialog<T extends { id: number }>({
  row,
  onClose,
  endpoint,
  fields,
  invalidate,
  title,
}: {
  row: T | 'new' | null
  onClose: () => void
  endpoint: string
  fields: FieldDef[]
  invalidate: string[][]
  title: string
}) {
  const isNew = row === 'new'
  const [form, setForm] = useState<Record<string, string | boolean>>({})
  const save = useApiMutation<Record<string, unknown>>({
    method: isNew ? 'post' : 'put',
    url: () => (isNew ? endpoint : `${endpoint}/${(row as T).id}`),
    invalidate,
    success: 'Saved',
    onSuccess: onClose,
  })

  useEffect(() => {
    if (!row) return
    const f: Record<string, string | boolean> = {}
    fields.forEach((d) => {
      const v = isNew ? undefined : (row as Record<string, unknown>)[d.name]
      f[d.name] = d.type === 'checkbox' ? (v ?? true) as boolean : v == null ? (d.options?.[0]?.value ?? '') : String(v)
    })
    setForm(f)
    save.clearErrors()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row])

  const visible = fields.filter((f) => !(f.createOnly && !isNew))
  const submit = () =>
    save.mutate(Object.fromEntries(visible.map((f) => [f.name, form[f.name] === '' ? null : form[f.name]])))

  return (
    <Dialog
      open={!!row}
      onClose={onClose}
      size="sm"
      title={isNew ? `Add — ${title}` : `Edit — ${title}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={submit}>Save</Button></>}
    >
      <div className="space-y-4">
        {visible.map((f) =>
          f.type === 'checkbox' ? (
            <Checkbox
              key={f.name}
              label={f.label}
              checked={!!form[f.name]}
              onChange={(e) => setForm((x) => ({ ...x, [f.name]: e.target.checked }))}
            />
          ) : (
            <Field key={f.name} label={f.label} required={f.required} hint={f.hint} error={save.fieldErrors[f.name]}>
              {f.type === 'select' ? (
                <Select value={String(form[f.name] ?? '')} onChange={(e) => setForm((x) => ({ ...x, [f.name]: e.target.value }))}>
                  {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
              ) : (
                <Input
                  value={String(form[f.name] ?? '')}
                  onChange={(e) => setForm((x) => ({ ...x, [f.name]: e.target.value }))}
                  aria-invalid={!!save.fieldErrors[f.name]}
                />
              )}
            </Field>
          ),
        )}
      </div>
    </Dialog>
  )
}
