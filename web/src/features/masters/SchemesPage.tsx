import { History, Pencil } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge, Button, Card, Dialog, Field, Input, PageHeader, Spinner, Table, Td, Th } from '@/components/ui'
import { useAuth } from '@/features/auth/AuthProvider'
import { useApiMutation, useApiQuery } from '@/lib/hooks'
import type { Scheme, SchemeVersion } from '@/lib/types'
import { formatMoney } from '@/lib/utils'

type TermKey = Exclude<keyof SchemeVersion, 'id' | 'scheme_id' | 'effective_from' | 'effective_to' | 'created_at' | 'creator'>

/** Form layout for scheme terms, grouped as the business thinks about them. */
const GROUPS: { title: string; fields: [TermKey, string, string?][] }[] = [
  {
    title: 'Loan amount band & term',
    fields: [
      ['min_amount', 'Minimum loan (Rs.)'],
      ['max_amount', 'Maximum loan (Rs.)', 'Empty = no limit'],
      ['valid_days', 'Valid days', 'Used for Silver expiry'],
      ['max_term_months', 'Maximum term (months)'],
    ],
  },
  {
    title: 'Interest',
    fields: [
      ['period1_days', 'Period 1 (days)'], ['rate1', 'Rate 1 (%)'],
      ['period2_days', 'Period 2 (days)'], ['rate2', 'Rate 2 (%)'],
      ['period3_days', 'Period 3 (days)'], ['rate3', 'Rate 3 (% per month)'],
      ['penalty_rate_monthly', 'Penalty after valid period (% / month)'],
    ],
  },
  {
    title: 'Charges',
    fields: [
      ['service_charge', 'Service charge (Rs.)'],
      ['service_charge_threshold', 'Service charge threshold (Rs.)'],
      ['service_charge_below_threshold', 'Service charge below threshold (Rs.)'],
      ['service_charge_above_percent', 'Service charge above threshold (%)'],
      ['document_charge', 'Document charge (Rs.)'],
      ['stamp_duty', 'Stamp duty (Rs.)'],
      ['postage_charge', 'Postage per letter (Rs.)'],
      ['min_capital_after_part_payment', 'Min. capital after part payment (Rs.)'],
    ],
  },
  {
    title: 'Arrears schedule (days)',
    fields: [
      ['letter_1_days', 'Letter 1 after expiry'],
      ['letter_2_days', 'Letter 2 after letter 1'],
      ['letter_3_days', 'Letter 3 after letter 2'],
      ['forfeit_reminder_days', 'Forfeit reminder after letter 3'],
    ],
  },
]

const methodLabel = { tiered: 'Tiered (gold)', monthly_penalty: 'Monthly + penalty', silver: 'Silver' } as const

export function SchemesPage() {
  const { can } = useAuth()
  const schemes = useApiQuery<Scheme[]>(['schemes'], '/api/v1/schemes')
  const [editing, setEditing] = useState<Scheme | null>(null)
  const [historyFor, setHistoryFor] = useState<Scheme | null>(null)

  return (
    <div>
      <PageHeader
        title="Pawn schemes"
        description="Receipt types. Gold types are picked by loan amount. Changing terms creates a new version — existing tickets keep the interest terms they were issued with."
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

      <TermsDialog scheme={editing} onClose={() => setEditing(null)} />
      <HistoryDialog scheme={historyFor} onClose={() => setHistoryFor(null)} />
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

function TermsDialog({ scheme, onClose }: { scheme: Scheme | null; onClose: () => void }) {
  const [form, setForm] = useState<Record<string, string>>({})
  const save = useApiMutation<Record<string, string | null>>({
    url: () => `/api/v1/schemes/${scheme?.id}/versions`,
    invalidate: [['schemes'], ['lookups']],
    success: 'New terms saved',
    onSuccess: onClose,
  })

  useEffect(() => {
    const v = scheme?.current_version
    if (v) {
      const f: Record<string, string> = { effective_from: new Date().toISOString().slice(0, 10) }
      GROUPS.flatMap((g) => g.fields).forEach(([k]) => (f[k] = v[k] === null ? '' : String(v[k])))
      setForm(f)
      save.clearErrors()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheme])

  const submit = () => save.mutate(Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v === '' ? null : v])))

  return (
    <Dialog
      open={!!scheme}
      onClose={onClose}
      size="xl"
      title={`Change terms — type ${scheme?.code ?? ''}`}
      description="Saves a new version from the effective date. Tickets already issued keep their interest terms."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={submit}>Save new version</Button></>}
    >
      <div className="space-y-5">
        <Field label="Effective from" className="max-w-xs" error={save.fieldErrors.effective_from} hint="Today or earlier; not before the current version.">
          <Input type="date" value={form.effective_from ?? ''} onChange={(e) => setForm((f) => ({ ...f, effective_from: e.target.value }))} />
        </Field>
        {GROUPS.map((g) => (
          <fieldset key={g.title}>
            <legend className="mb-2 text-sm font-semibold">{g.title}</legend>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {g.fields.map(([k, label, hint]) => (
                <Field key={k} label={label} hint={hint} error={save.fieldErrors[k]}>
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    value={form[k] ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
                    aria-invalid={!!save.fieldErrors[k]}
                  />
                </Field>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
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
