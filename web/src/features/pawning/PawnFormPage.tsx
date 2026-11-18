import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Badge, Button, Card, Field, Input, PageHeader, Select, Spinner, Textarea } from '@/components/ui'
import { api, errorMessage } from '@/lib/api'
import { useDebounced, useLookups } from '@/lib/hooks'
import type { Customer } from '@/lib/types'
import { cn, formatMoney } from '@/lib/utils'
import { CustomerPicker } from './CustomerPicker'
import type { PawnQuote, PawnTicket } from './types'

type Row = {
  key: number
  category_id: string
  article_type_id: string
  karat_id: string
  condition_id: string
  description: string
  quantity: string
  gross_weight: string
  net_weight: string
}

let rowKey = 1
const newRow = (): Row => ({
  key: rowKey++, category_id: '', article_type_id: '', karat_id: '', condition_id: '', description: '',
  quantity: '1', gross_weight: '', net_weight: '',
})

const rowComplete = (r: Row) => r.category_id && r.karat_id && Number(r.gross_weight) > 0 && Number(r.net_weight) > 0

function toItem(r: Row) {
  return {
    category_id: Number(r.category_id),
    article_type_id: r.article_type_id ? Number(r.article_type_id) : null,
    karat_id: Number(r.karat_id),
    condition_id: r.condition_id ? Number(r.condition_id) : null,
    description: r.description || null,
    quantity: Number(r.quantity) || 1,
    gross_weight: r.gross_weight,
    net_weight: r.net_weight,
  }
}

/**
 * New pawn (mode "new") or opening ticket carried over from the old system
 * (mode "opening"). All money is calculated by the API; this screen only
 * shows the quote and sends the inputs.
 */
export function PawnFormPage({ mode }: { mode: 'new' | 'opening' }) {
  const opening = mode === 'opening'
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { data: lookups } = useLookups()
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [rows, setRows] = useState<Row[]>([newRow()])
  const [amount, setAmount] = useState('')
  const [months, setMonths] = useState('')
  const [pawnDate, setPawnDate] = useState('')
  const [legacyNo, setLegacyNo] = useState('')
  const [remarks, setRemarks] = useState('')
  const [quote, setQuote] = useState<PawnQuote | null>(null)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [quoting, setQuoting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const complete = rows.filter(rowComplete)
  const quoteInput = useDebounced(JSON.stringify({ items: complete.map(toItem), amount: amount || null }), 400)

  useEffect(() => {
    const body = JSON.parse(quoteInput) as { items: unknown[]; amount: string | null }
    if (body.items.length === 0) {
      setQuote(null)
      return
    }
    let cancelled = false
    setQuoting(true)
    api
      .post<{ data: PawnQuote }>('/api/v1/pawn-tickets/quote', body)
      .then((r) => {
        if (cancelled) return
        setQuote(r.data.data)
        setQuoteError(null)
      })
      .catch((e) => !cancelled && setQuoteError(errorMessage(e)))
      .finally(() => !cancelled && setQuoting(false))
    return () => {
      cancelled = true
    }
  }, [quoteInput])

  // Default the term to the longest allowed one.
  useEffect(() => {
    if (!opening && quote && amount && quote.max_term > 0 && (!months || Number(months) > quote.max_term)) {
      setMonths(String(quote.max_term))
    }
  }, [quote, amount, months, opening])

  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const typesFor = (categoryId: string) => (lookups?.article_types ?? []).filter((t) => String(t.category_id) === categoryId)

  const overValue = quote && amount && Number(amount) > Number(quote.assessed_value)
  const canSubmit = customer && complete.length === rows.length && Number(amount) > 0 && Number(months) > 0 && (!opening || (pawnDate && legacyNo))

  const submit = async () => {
    setSaving(true)
    setErrors({})
    try {
      const body = opening
        ? { customer_id: customer!.id, items: rows.map(toItem), principal: amount, months: Number(months), pawn_date: pawnDate, legacy_receipt_no: legacyNo, remarks: remarks || null }
        : { customer_id: customer!.id, items: rows.map(toItem), amount, months: Number(months), remarks: remarks || null }
      const r = await api.post<{ data: PawnTicket }>(opening ? '/api/v1/pawn-tickets/opening' : '/api/v1/pawn-tickets', body)
      toast.success(`Ticket ${r.data.data.receipt_no} saved`)
      navigate(`/pawning/tickets/${r.data.data.id}${opening ? '' : '?print=1'}`)
    } catch (e) {
      const data = (e as { response?: { data?: { errors?: Record<string, string[]> } } }).response?.data
      if (data?.errors) setErrors(Object.fromEntries(Object.entries(data.errors).map(([k, v]) => [k, v[0]])))
      toast.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const monthOptions = useMemo(() => {
    const max = opening ? 12 : quote?.max_term ?? 0
    return Array.from({ length: Math.max(0, max) }, (_, i) => i + 1)
  }, [quote, opening])

  return (
    <div className="space-y-5">
      <PageHeader
        title={opening ? 'Opening ticket' : 'New pawn'}
        description={
          opening
            ? 'Enter a loan that was given before this system (paper / old system). The ledger records it against the head-office account, not today\'s cash.'
            : 'Values use today\'s karat rates (rate ÷ 8 × net weight). The scheme is chosen from the loan amount.'
        }
      />

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">1. Customer</h2>
        <CustomerPicker value={customer} onChange={setCustomer} initialCustomerId={params.get('customer')} />
        {errors.customer_id && <p className="text-sm text-destructive">{errors.customer_id}</p>}
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">2. Articles</h2>
          <Button size="sm" variant="secondary" onClick={() => setRows((r) => [...r, newRow()])}><Plus className="size-4" /> Add article</Button>
        </div>
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="bg-secondary/60 text-left text-xs text-muted-foreground">
                <th className="px-2 py-2">Category *</th><th className="px-2">Article</th><th className="px-2">Karat *</th>
                <th className="px-2">Condition</th><th className="w-16 px-2">Qty</th><th className="w-24 px-2">Gross g *</th>
                <th className="w-24 px-2">Net g *</th><th className="px-2 text-right">Value</th><th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => {
                const qIdx = complete.indexOf(r)
                const value = qIdx >= 0 ? quote?.items[qIdx]?.assessed_value : undefined
                const err = (f: string) => errors[`items.${idx}.${f}`]
                return (
                  <tr key={r.key} className="border-b align-top">
                    <td className="p-1.5">
                      <Select value={r.category_id} onChange={(e) => update(r.key, { category_id: e.target.value, article_type_id: '' })} aria-invalid={!!err('category_id')}>
                        <option value="">Select…</option>
                        {lookups?.article_categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </Select>
                    </td>
                    <td className="p-1.5">
                      <Select value={r.article_type_id} onChange={(e) => update(r.key, { article_type_id: e.target.value })} disabled={!r.category_id}>
                        <option value="">—</option>
                        {typesFor(r.category_id).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </Select>
                    </td>
                    <td className="p-1.5">
                      <Select value={r.karat_id} onChange={(e) => update(r.key, { karat_id: e.target.value })} aria-invalid={!!err('karat_id')}>
                        <option value="">Select…</option>
                        {lookups?.karats.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
                      </Select>
                      {err('karat_id') && <span className="text-xs text-destructive">{err('karat_id')}</span>}
                    </td>
                    <td className="p-1.5">
                      <Select value={r.condition_id} onChange={(e) => update(r.key, { condition_id: e.target.value })}>
                        <option value="">—</option>
                        {lookups?.article_conditions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </Select>
                    </td>
                    <td className="p-1.5"><Input type="number" min={1} value={r.quantity} onChange={(e) => update(r.key, { quantity: e.target.value })} /></td>
                    <td className="p-1.5"><Input type="number" min={0} step="0.001" value={r.gross_weight} onChange={(e) => update(r.key, { gross_weight: e.target.value })} /></td>
                    <td className="p-1.5">
                      <Input type="number" min={0} step="0.001" value={r.net_weight} onChange={(e) => update(r.key, { net_weight: e.target.value })} aria-invalid={!!err('net_weight')} />
                      {err('net_weight') && <span className="text-xs text-destructive">{err('net_weight')}</span>}
                    </td>
                    <td className="p-1.5 pt-3.5 text-right tabular-nums">{value ? formatMoney(value) : '—'}</td>
                    <td className="p-1.5">
                      <Button size="sm" variant="ghost" onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : rs))} aria-label="Remove article" disabled={rows.length === 1}>
                        <Trash2 className="size-4" />
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
        {quoteError && <p className="text-sm text-destructive">{quoteError}</p>}
      </section>

      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">3. Loan</h2>
          <Card className="grid gap-4 p-4 sm:grid-cols-2">
            <Field label={opening ? 'Outstanding capital (Rs.)' : 'Loan amount (Rs.)'} required error={errors.amount || errors.principal || (overValue ? 'More than the article value.' : undefined)}>
              <Input type="number" min={0} step="1" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!!overValue} className="text-lg font-semibold" />
            </Field>
            <Field label="Term (months)" required error={errors.months} hint={!opening && quote && amount ? `Up to ${quote.max_term} month(s) for this loan` : undefined}>
              <Select value={months} onChange={(e) => setMonths(e.target.value)}>
                <option value="">Select…</option>
                {monthOptions.map((m) => <option key={m} value={m}>{m}</option>)}
              </Select>
            </Field>
            {opening && (
              <>
                <Field label="Original pawn date" required error={errors.pawn_date}>
                  <Input type="date" value={pawnDate} onChange={(e) => setPawnDate(e.target.value)} max={new Date().toISOString().slice(0, 10)} />
                </Field>
                <Field label="Old receipt number" required error={errors.legacy_receipt_no}>
                  <Input value={legacyNo} onChange={(e) => setLegacyNo(e.target.value)} />
                </Field>
              </>
            )}
            <Field label="Remarks" className="sm:col-span-2" error={errors.remarks}>
              <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} className="min-h-14" />
            </Field>
          </Card>
          <div className="flex justify-end">
            <Button variant="accent" size="md" disabled={!canSubmit || !!overValue} loading={saving} onClick={submit}>
              {opening ? 'Save opening ticket' : 'Save pawn & print'}
            </Button>
          </div>
        </section>

        <aside className="space-y-2">
          <h2 className="text-sm font-semibold">Valuation {quoting && <Spinner className="ml-1 inline size-3.5" />}</h2>
          <Card className="space-y-3 p-4">
            {!quote ? (
              <p className="text-sm text-muted-foreground">Enter at least one complete article to see its value.</p>
            ) : (
              <>
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-muted-foreground">Article value (max loan)</span>
                  <span className="text-xl font-semibold tabular-nums">{formatMoney(quote.assessed_value)}</span>
                </div>
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">Market value</span><span className="tabular-nums">{formatMoney(quote.market_value)}</span></div>
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">Net weight</span><span>{Number(quote.net_weight).toFixed(3)} g</span></div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Scheme</span>
                  <span><Badge tone="primary">{quote.scheme.code}</Badge> {Number(quote.monthly_rate)}% / month</span>
                </div>
                {!opening && (
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">Maximum loan by term</p>
                    <div className="grid grid-cols-3 gap-1 text-xs">
                      {Object.entries(quote.term_capacities).map(([m, cap]) => {
                        const ok = !amount || Number(cap) >= Number(amount)
                        return (
                          <button
                            key={m}
                            type="button"
                            disabled={!ok}
                            onClick={() => setMonths(m)}
                            className={cn(
                              'rounded border px-1.5 py-1 text-left tabular-nums',
                              ok ? 'hover:bg-secondary' : 'opacity-40',
                              months === m && 'border-primary bg-primary/10',
                            )}
                          >
                            <span className="font-medium">{m} mo</span>
                            <span className="block">{Number(cap).toLocaleString()}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </Card>
        </aside>
      </div>
    </div>
  )
}
