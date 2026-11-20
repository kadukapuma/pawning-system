import { History, Pencil, Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Badge, Button, Card, Dialog, PageHeader, Select, Spinner, Table, Td, Th } from '@/components/ui'
import { useAuth } from '@/features/auth/AuthProvider'
import { useApiMutation, useApiQuery } from '@/lib/hooks'
import type { Scheme } from '@/lib/types'
import { formatMoney } from '@/lib/utils'
import { SchemeForm } from './SchemeForm'
import { TERM_KEYS, toPayload, valuesFrom, type SchemeFormValues } from './schemeTerms'

const today = () => new Date().toISOString().slice(0, 10)

const methodLabel = { tiered: 'Tiered (gold)', monthly_penalty: 'Monthly + penalty', silver: 'Silver' } as const

export function SchemesPage() {
  const { can } = useAuth()
  const schemes = useApiQuery<Scheme[]>(['schemes'], '/api/v1/schemes')
  const [editing, setEditing] = useState<Scheme | null>(null)
  const [historyFor, setHistoryFor] = useState<Scheme | null>(null)
  const [adding, setAdding] = useState(false)

  return (
    <div>
      <PageHeader
        title="Pawn schemes"
        description="Receipt types. Gold types are picked by loan amount. Changing terms creates a new version — existing tickets keep the interest terms they were issued with."
        actions={can('schemes.manage') && <Button onClick={() => setAdding(true)}><Plus className="size-4" /> New scheme</Button>}
      />

      {schemes.isPending ? (
        <Spinner />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {schemes.data?.map((s) => {
            const v = s.current_version
            return (
              <Card key={s.id} className="p-5">
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="grid size-9 place-items-center rounded-lg bg-accent font-bold text-accent-foreground">{s.code}</span>
                      <div>
                        <h2 className="font-semibold">{s.name}</h2>
                        <p className="text-xs text-muted-foreground">
                          {methodLabel[s.interest_method]} · since {v?.effective_from}
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setHistoryFor(s)} aria-label="Version history"><History className="size-4" /></Button>
                    {can('schemes.manage') && (
                      <Button size="sm" variant="secondary" onClick={() => setEditing(s)}><Pencil className="size-4" /> Change terms</Button>
                    )}
                  </div>
                </div>
                {v && (
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
                    <Term label="Loan band">{formatMoney(v.min_amount)} – {v.max_amount ? formatMoney(v.max_amount) : 'no limit'}</Term>
                    <Term label="Interest">{Number(v.rate1)}% / {Number(v.rate2)}% / {Number(v.rate3)}% per month</Term>
                    <Term label="Periods (days)">{v.period1_days} / {v.period2_days} / {v.period3_days}</Term>
                    <Term label="Service charge">{formatMoney(v.service_charge)}</Term>
                    <Term label="Postage / letter">{formatMoney(v.postage_charge)}</Term>
                    <Term label="Letters (days)">{v.letter_1_days} · {v.letter_2_days} · {v.letter_3_days} → {v.forfeit_reminder_days}</Term>
                  </dl>
                )}
              </Card>
            )
          })}
        </div>
      )}

      <TermsDialog scheme={editing} schemes={schemes.data ?? []} onClose={() => setEditing(null)} />
      <HistoryDialog scheme={historyFor} onClose={() => setHistoryFor(null)} />
      <NewSchemeDialog open={adding} schemes={schemes.data ?? []} onClose={() => setAdding(false)} />
    </div>
  )
}

function Term({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{children}</dd>
    </div>
  )
}

/** Change terms of an existing scheme: saves a new version. */
function TermsDialog({ scheme, schemes, onClose }: { scheme: Scheme | null; schemes: Scheme[]; onClose: () => void }) {
  const [form, setForm] = useState<SchemeFormValues>({})
  const original = useMemo(() => (scheme ? valuesFrom(scheme.current_version) : null), [scheme])
  const save = useApiMutation<Record<string, string | null>>({
    url: () => `/api/v1/schemes/${scheme?.id}/versions`,
    invalidate: [['schemes'], ['lookups']],
    success: 'New terms saved',
    onSuccess: onClose,
  })

  useEffect(() => {
    if (original) {
      setForm({ ...original, effective_from: today() })
      save.clearErrors()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [original])

  const unchanged = !!original && TERM_KEYS.every((k) => Number(original[k]) === Number(form[k] ?? '')) && original.no_limit === form.no_limit
  const errorCount = Object.keys(save.fieldErrors).length

  return (
    <Dialog
      open={!!scheme}
      onClose={onClose}
      size="xl"
      title={`Change terms — ${scheme?.code ?? ''} · ${scheme?.name ?? ''}`}
      description="Changed values are highlighted. Hover or tap the ⓘ next to any field to see what it does."
      footer={
        <>
          {errorCount > 0 && <span className="mr-auto self-center text-xs text-destructive">Please fix {errorCount} field{errorCount === 1 ? '' : 's'} marked in red.</span>}
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={save.isPending} disabled={unchanged} onClick={() => save.mutate(toPayload(form))}>Save new version</Button>
        </>
      }
    >
      {scheme && (
        <SchemeForm mode="change" form={form} setForm={setForm} errors={save.fieldErrors} schemes={schemes} self={scheme} original={original} />
      )}
    </Dialog>
  )
}

/** Create a new receipt type with its first version of terms. */
function NewSchemeDialog({ open, schemes, onClose }: { open: boolean; schemes: Scheme[]; onClose: () => void }) {
  const [form, setForm] = useState<SchemeFormValues>({})
  const [copyFrom, setCopyFrom] = useState('')
  const save = useApiMutation<Record<string, string | null>>({
    url: '/api/v1/schemes',
    invalidate: [['schemes'], ['lookups']],
    success: 'Scheme created',
    onSuccess: onClose,
  })

  /** Copies the terms of another scheme, but leaves the loan band empty — it must differ anyway. */
  const fromScheme = (id: string, base: SchemeFormValues) => {
    const src = schemes.find((s) => String(s.id) === id)
    const terms = valuesFrom(src?.current_version)
    return {
      ...base,
      ...terms,
      min_amount: '',
      max_amount: '',
      no_limit: '0',
      interest_method: src?.interest_method ?? base.interest_method ?? 'tiered',
    }
  }

  useEffect(() => {
    if (!open) return
    const first = schemes.find((s) => s.interest_method === 'tiered') ?? schemes[0]
    const id = first ? String(first.id) : ''
    setCopyFrom(id)
    setForm(fromScheme(id, { code: '', name: '', interest_method: 'tiered', effective_from: today() }))
    save.clearErrors()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const errorCount = Object.keys(save.fieldErrors).length

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="xl"
      title="New pawn scheme"
      description="Fill in the steps on the left; the summary on the right updates as you type. Hover or tap ⓘ for help on any field."
      footer={
        <>
          {errorCount > 0 && <span className="mr-auto self-center text-xs text-destructive">Please fix {errorCount} field{errorCount === 1 ? '' : 's'} marked in red.</span>}
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={save.isPending} onClick={() => save.mutate(toPayload(form))}><Plus className="size-4" /> Create scheme</Button>
        </>
      }
    >
      {schemes.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg bg-secondary/60 px-3 py-2 text-sm">
          <label htmlFor="copy-from" className="font-medium">Start with the terms of</label>
          <Select
            id="copy-from"
            className="h-8 w-auto min-w-48"
            value={copyFrom}
            onChange={(e) => {
              setCopyFrom(e.target.value)
              setForm((f) => (e.target.value ? fromScheme(e.target.value, f) : { code: f.code, name: f.name, interest_method: f.interest_method, effective_from: f.effective_from }))
            }}
          >
            <option value="">nothing — start blank</option>
            {schemes.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
          </Select>
          <span className="text-xs text-muted-foreground">then change only what is different.</span>
        </div>
      )}
      <SchemeForm mode="create" form={form} setForm={setForm} errors={save.fieldErrors} schemes={schemes} />
    </Dialog>
  )
}

function HistoryDialog({ scheme, onClose }: { scheme: Scheme | null; onClose: () => void }) {
  const detail = useApiQuery<Scheme>(['schemes', scheme?.id], `/api/v1/schemes/${scheme?.id}`, !!scheme)
  return (
    <Dialog open={!!scheme} onClose={onClose} size="xl" title={`Version history — type ${scheme?.code ?? ''}`}>
      {detail.isPending ? (
        <Spinner />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Effective</Th><Th>Band</Th><Th>Rates %</Th><Th>Service</Th><Th>Postage</Th><Th>Letters</Th><Th>By</Th>
            </tr>
          </thead>
          <tbody>
            {detail.data?.versions?.map((v) => (
              <tr key={v.id}>
                <Td>
                  {v.effective_from} → {v.effective_to ?? <Badge tone="success">current</Badge>}
                </Td>
                <Td className="tabular-nums">{Number(v.min_amount).toLocaleString()} – {v.max_amount ? Number(v.max_amount).toLocaleString() : '∞'}</Td>
                <Td>{Number(v.rate1)} / {Number(v.rate2)} / {Number(v.rate3)}</Td>
                <Td>{Number(v.service_charge)}</Td>
                <Td>{Number(v.postage_charge)}</Td>
                <Td>{v.letter_1_days}/{v.letter_2_days}/{v.letter_3_days}/{v.forfeit_reminder_days}</Td>
                <Td>{v.creator?.name ?? 'seed'}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Dialog>
  )
}
