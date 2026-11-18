import { Pencil, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge, Button, Card, Checkbox, Dialog, EmptyState, Field, Input, PageHeader, Spinner } from '@/components/ui'
import { useAuth } from '@/features/auth/AuthProvider'
import { useApiMutation, useApiQuery } from '@/lib/hooks'
import type { Bank, BankBranch } from '@/lib/types'

type Editing =
  | { kind: 'bank'; bank?: Bank }
  | { kind: 'branch'; bank: Bank; branch?: BankBranch }
  | null

export function BanksPage() {
  const { can } = useAuth()
  const banks = useApiQuery<Bank[]>(['banks'], '/api/v1/banks')
  const [editing, setEditing] = useState<Editing>(null)
  const manage = can('masters.manage')

  return (
    <div>
      <PageHeader
        title="Banks"
        description="Banks and branches used for cheques and the company's bank accounts."
        actions={manage && <Button onClick={() => setEditing({ kind: 'bank' })}><Plus className="size-4" /> Add bank</Button>}
      />
      {banks.isPending ? (
        <Spinner />
      ) : banks.data?.length === 0 ? (
        <Card><EmptyState title="No banks yet">Add the banks you deal with.</EmptyState></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {banks.data?.map((b) => (
            <Card key={b.id} className="p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div>
                  <p className="font-semibold">{b.name} {b.is_active === false && <Badge>inactive</Badge>}</p>
                  <p className="text-xs text-muted-foreground">Bank code {b.code}</p>
                </div>
                {manage && (
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditing({ kind: 'bank', bank: b })} aria-label="Edit bank"><Pencil className="size-4" /></Button>
                    <Button size="sm" variant="secondary" onClick={() => setEditing({ kind: 'branch', bank: b })}><Plus className="size-4" /> Branch</Button>
                  </div>
                )}
              </div>
              <ul className="divide-y text-sm">
                {b.branches.map((br) => (
                  <li key={br.id} className="flex items-center justify-between py-1.5">
                    <span><span className="font-mono text-xs text-muted-foreground">{br.code}</span> {br.name}</span>
                    {manage && (
                      <Button size="sm" variant="ghost" onClick={() => setEditing({ kind: 'branch', bank: b, branch: br })} aria-label="Edit branch">
                        <Pencil className="size-3.5" />
                      </Button>
                    )}
                  </li>
                ))}
                {b.branches.length === 0 && <li className="py-1.5 text-muted-foreground">No branches</li>}
              </ul>
            </Card>
          ))}
        </div>
      )}
      <BankDialog editing={editing} onClose={() => setEditing(null)} />
    </div>
  )
}

function BankDialog({ editing, onClose }: { editing: Editing; onClose: () => void }) {
  const [form, setForm] = useState({ code: '', name: '', is_active: true })
  const isBank = editing?.kind === 'bank'
  const existing = isBank ? editing.bank : editing?.kind === 'branch' ? editing.branch : undefined

  const save = useApiMutation<typeof form>({
    method: existing ? 'put' : 'post',
    url: () => {
      if (!editing) return ''
      if (editing.kind === 'bank') return editing.bank ? `/api/v1/banks/${editing.bank.id}` : '/api/v1/banks'
      return editing.branch ? `/api/v1/banks/${editing.bank.id}/branches/${editing.branch.id}` : `/api/v1/banks/${editing.bank.id}/branches`
    },
    invalidate: [['banks'], ['lookups']],
    success: 'Saved',
    onSuccess: onClose,
  })

  useEffect(() => {
    if (editing) {
      setForm({ code: existing?.code ?? '', name: existing?.name ?? '', is_active: (existing as Bank | undefined)?.is_active ?? true })
      save.clearErrors()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])

  const title = isBank ? (existing ? 'Edit bank' : 'Add bank') : `${existing ? 'Edit' : 'Add'} branch — ${editing?.kind === 'branch' ? editing.bank.name : ''}`

  return (
    <Dialog
      open={!!editing}
      onClose={onClose}
      size="sm"
      title={title}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate(form)}>Save</Button></>}
    >
      <div className="space-y-4">
        <Field label="Code" required error={save.fieldErrors.code}>
          <Input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} />
        </Field>
        <Field label="Name" required error={save.fieldErrors.name}>
          <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </Field>
        {isBank && (
          <Checkbox label="Active" checked={form.is_active} onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))} />
        )}
      </div>
    </Dialog>
  )
}
