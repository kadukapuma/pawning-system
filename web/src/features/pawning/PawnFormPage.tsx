import { Check, Circle, Gem, Plus, Scale, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Badge, Button, Card, InfoTip, Input, PageHeader, Select, Spinner, Textarea } from '@/components/ui'
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
  density_reading: string
}

let rowKey = 1
const newRow = (): Row => ({
  key: rowKey++, category_id: '', article_type_id: '', karat_id: '', condition_id: '', description: '',
  quantity: '1', gross_weight: '', net_weight: '', density_reading: '',
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
    density_reading: r.density_reading === '' ? null : r.density_reading,
  }
}

/* ================================================================ layout bits */

/** Numbered form section; the number turns into a tick once the step is complete. */
function Step({ n, title, done, action, children }: { n: number; title: string; done?: boolean; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-3">
        <span
          className={cn(
            'grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold',
            done ? 'bg-primary text-primary-foreground' : 'border border-border bg-popover text-muted-foreground',
          )}
        >
          {done ? <Check className="size-3.5" /> : n}
        </span>
        <h2 className="text-[15px] font-medium tracking-tight">{title}</h2>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {children}
    </section>
  )
}

/** Compact label + control used inside article cards. */
function Mini({ label, required, error, tip, className, children }: { label: string; required?: boolean; error?: string; tip?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <div className={cn('min-w-0 space-y-1', className)}>
      <span className="flex items-center gap-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
        {required && <span className="text-destructive">*</span>}
        {tip}
      </span>
      {children}
      {error && <span className="block text-xs text-destructive">{error}</span>}
    </div>
  )
}

function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right tabular-nums">{children}</span>
    </div>
  )
}

/* ================================================================ page */

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
  const articlesDone = complete.length === rows.length
  const loanDone = Number(amount) > 0 && Number(months) > 0 && !overValue && (!opening || (!!pawnDate && !!legacyNo))
  const canSubmit = customer && articlesDone && Number(amount) > 0 && Number(months) > 0 && (!opening || (pawnDate && legacyNo))

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

  // Share of the article value being lent (display only; the API enforces the limit).
  const ltv = quote && Number(quote.assessed_value) > 0 && Number(amount) > 0 ? Math.min(100, (Number(amount) / Number(quote.assessed_value)) * 100) : 0

  const checklist: { label: string; ok: boolean }[] = [
    { label: 'Customer selected', ok: !!customer },
    { label: 'All articles complete', ok: articlesDone },
    { label: opening ? 'Outstanding capital entered' : 'Loan amount entered', ok: Number(amount) > 0 && !overValue },
    { label: 'Term chosen', ok: Number(months) > 0 },
    ...(opening ? [{ label: 'Pawn date & old receipt no.', ok: !!pawnDate && !!legacyNo }] : []),
  ]

  return (
    <div className="mx-auto max-w-[1500px]">
      <PageHeader
        title={opening ? 'Opening ticket' : 'New pawn'}
        description={
          opening
            ? 'Enter a loan that was given before this system (paper / old system). The ledger records it against the head-office account, not today\'s cash.'
            : 'Values use today\'s karat rates (rate ÷ 8 × net weight). The scheme is chosen from the loan amount.'
        }
      />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* ---------------------------------------------------------------- form */}
        <div className="min-w-0 space-y-7">
          <Step n={1} title="Customer" done={!!customer}>
            <CustomerPicker value={customer} onChange={setCustomer} initialCustomerId={params.get('customer')} />
            {errors.customer_id && <p className="text-sm text-destructive">{errors.customer_id}</p>}
          </Step>

          <Step
            n={2}
            title={`Articles${rows.length > 1 ? ` (${rows.length})` : ''}`}
            done={articlesDone}
            action={
              <Button size="sm" variant="secondary" onClick={() => setRows((r) => [...r, newRow()])}>
                <Plus className="size-4" /> Add article
              </Button>
            }
          >
            <div className="space-y-3">
              {rows.map((r, idx) => {
                const qIdx = complete.indexOf(r)
                const value = qIdx >= 0 ? quote?.items[qIdx]?.assessed_value : undefined
                const err = (f: string) => errors[`items.${idx}.${f}`]
                const netOverGross = Number(r.net_weight) > 0 && Number(r.gross_weight) > 0 && Number(r.net_weight) > Number(r.gross_weight)
                const isDone = !!rowComplete(r)
                return (
                  <Card key={r.key} className="p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <span className={cn('grid size-6 place-items-center rounded-md text-[11px] font-semibold', isDone ? 'bg-primary/15 text-primary' : 'bg-secondary text-muted-foreground')}>
                        {idx + 1}
                      </span>
                      <span className="min-w-0 truncate text-sm font-medium">
                        {lookups?.article_categories.find((c) => String(c.id) === r.category_id)?.name ?? 'New article'}
                        {r.article_type_id && (
                          <span className="font-normal text-muted-foreground"> · {typesFor(r.category_id).find((t) => String(t.id) === r.article_type_id)?.name}</span>
                        )}
                      </span>
                      <span className="ml-auto text-sm whitespace-nowrap tabular-nums">
                        {value ? (
                          <span className="rounded-full bg-primary/10 px-2.5 py-1 font-medium text-primary">{formatMoney(value)}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">{isDone ? 'Valuing…' : 'Not valued yet'}</span>
                        )}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="size-8 px-0 text-muted-foreground hover:text-destructive"
                        onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : rs))}
                        aria-label="Remove article"
                        title="Remove article"
                        disabled={rows.length === 1}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>

                    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                      <Mini label="Category" required error={err('category_id')}>
                        <Select value={r.category_id} onChange={(e) => update(r.key, { category_id: e.target.value, article_type_id: '' })} aria-invalid={!!err('category_id')}>
                          <option value="">Select…</option>
                          {lookups?.article_categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </Select>
                      </Mini>
                      <Mini label="Article">
                        <Select value={r.article_type_id} onChange={(e) => update(r.key, { article_type_id: e.target.value })} disabled={!r.category_id}>
                          <option value="">—</option>
                          {typesFor(r.category_id).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </Select>
                      </Mini>
                      <Mini label="Karat" required error={err('karat_id')}>
                        <Select value={r.karat_id} onChange={(e) => update(r.key, { karat_id: e.target.value })} aria-invalid={!!err('karat_id')}>
                          <option value="">Select…</option>
                          {lookups?.karats.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
                        </Select>
                      </Mini>
                      <Mini label="Condition">
                        <Select value={r.condition_id} onChange={(e) => update(r.key, { condition_id: e.target.value })}>
                          <option value="">—</option>
                          {lookups?.article_conditions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </Select>
                      </Mini>

                      <Mini label="Qty">
                        <Input type="number" min={1} value={r.quantity} onChange={(e) => update(r.key, { quantity: e.target.value })} />
                      </Mini>
                      <Mini label="Gross (g)" required>
                        <Input type="number" min={0} step="0.001" inputMode="decimal" value={r.gross_weight} onChange={(e) => update(r.key, { gross_weight: e.target.value })} />
                      </Mini>
                      <Mini label="Net (g)" required error={err('net_weight') ?? (netOverGross ? 'More than gross weight.' : undefined)}>
                        <Input type="number" min={0} step="0.001" inputMode="decimal" value={r.net_weight} onChange={(e) => update(r.key, { net_weight: e.target.value })} aria-invalid={!!err('net_weight') || netOverGross} />
                      </Mini>
                      <Mini
                        label="Density"
                        error={err('density_reading')}
                        tip={
                          <InfoTip label="Density meter reading">
                            The reading shown on the density meter when this item is tested. Optional — it is saved on the ticket for the record and does not change the value.
                          </InfoTip>
                        }
                      >
                        <Input
                          type="number"
                          min={0}
                          step="0.001"
                          inputMode="decimal"
                          placeholder="Optional"
                          aria-label="Density meter reading"
                          value={r.density_reading}
                          onChange={(e) => update(r.key, { density_reading: e.target.value })}
                          aria-invalid={!!err('density_reading')}
                        />
                      </Mini>
                    </div>
                  </Card>
                )
              })}
            </div>
            {quoteError && <p className="text-sm text-destructive">{quoteError}</p>}
          </Step>

          <Step n={3} title="Loan" done={loanDone}>
            <Card className="space-y-5 p-5">
              <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                {/* Amount */}
                <div className="space-y-1.5">
                  <label htmlFor="loan-amount" className="text-sm font-medium">
                    {opening ? 'Outstanding capital' : 'Loan amount'} <span className="text-destructive">*</span>
                  </label>
                  <div className={cn('flex h-14 items-center rounded-xl border bg-popover/80 px-4 transition focus-within:border-ring focus-within:ring-4 focus-within:ring-ring/15', overValue && 'border-destructive')}>
                    <span className="mr-2 text-sm text-muted-foreground">Rs.</span>
                    <input
                      id="loan-amount"
                      type="number"
                      min={0}
                      step="1"
                      inputMode="numeric"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      aria-invalid={!!overValue}
                      placeholder="0"
                      className="w-full min-w-0 bg-transparent text-2xl font-light tabular-nums outline-none"
                    />
                  </div>
                  {errors.amount || errors.principal || overValue ? (
                    <p className="text-xs text-destructive">{errors.amount || errors.principal || 'More than the article value.'}</p>
                  ) : quote ? (
                    <button type="button" onClick={() => setAmount(String(Math.floor(Number(quote.assessed_value))))} className="text-xs font-medium text-primary hover:underline">
                      Use maximum · {formatMoney(quote.assessed_value)}
                    </button>
                  ) : (
                    <p className="text-xs text-muted-foreground">Add an article to see how much can be lent.</p>
                  )}
                </div>

                {/* Term */}
                <div className="space-y-1.5">
                  <span className="text-sm font-medium">
                    Term (months) <span className="text-destructive">*</span>
                  </span>
                  {!opening && quote ? (
                    <div className="grid grid-cols-[repeat(auto-fit,minmax(5.25rem,1fr))] gap-2">
                      {Object.entries(quote.term_capacities).map(([m, cap]) => {
                        const ok = !amount || Number(cap) >= Number(amount)
                        const active = months === m
                        return (
                          <button
                            key={m}
                            type="button"
                            disabled={!ok}
                            onClick={() => setMonths(m)}
                            title={ok ? `Up to ${formatMoney(cap)} for ${m} month(s)` : 'Loan amount is above the limit for this term'}
                            className={cn(
                              'rounded-xl border px-2.5 py-2 text-left transition-[border-color]',
                              active ? 'border-primary bg-primary text-primary-foreground shadow-[0_6px_16px_-8px_var(--primary)]' : ok ? 'bg-popover/60 hover:border-ring' : 'cursor-not-allowed opacity-35',
                            )}
                          >
                            <span className="block text-sm font-medium">{m} mo</span>
                            <span className={cn('block text-[11px] tabular-nums', active ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
                              ≤ {Number(cap).toLocaleString()}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  ) : (
                    <Select value={months} onChange={(e) => setMonths(e.target.value)} disabled={!opening && !quote} className="h-14 rounded-xl">
                      <option value="">{!opening && !quote ? 'Add an article first' : 'Select…'}</option>
                      {monthOptions.map((m) => <option key={m} value={m}>{m} month{m > 1 ? 's' : ''}</option>)}
                    </Select>
                  )}
                  {errors.months ? (
                    <p className="text-xs text-destructive">{errors.months}</p>
                  ) : (
                    !opening && quote && amount && <p className="text-xs text-muted-foreground">Up to {quote.max_term} month(s) for this loan</p>
                  )}
                </div>
              </div>

              {opening && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Mini label="Original pawn date" required error={errors.pawn_date}>
                    <Input type="date" value={pawnDate} onChange={(e) => setPawnDate(e.target.value)} max={new Date().toISOString().slice(0, 10)} />
                  </Mini>
                  <Mini label="Old receipt number" required error={errors.legacy_receipt_no}>
                    <Input value={legacyNo} onChange={(e) => setLegacyNo(e.target.value)} />
                  </Mini>
                </div>
              )}

              <Mini label="Remarks" error={errors.remarks}>
                <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} className="min-h-16" placeholder="Optional note printed on the ticket record" />
              </Mini>
            </Card>
          </Step>
        </div>

        {/* ---------------------------------------------------------------- summary */}
        <aside className="lg:sticky lg:top-20">
          <Card className="overflow-hidden">
            <div className="border-b border-[var(--glass-edge)] p-5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Article value</span>
                {quoting && <Spinner className="size-3.5" />}
              </div>
              {quote ? (
                <>
                  <p className="mt-1 text-3xl font-light tracking-tight tabular-nums">{formatMoney(quote.assessed_value)}</p>
                  <p className="text-xs text-muted-foreground">Maximum loan</p>
                </>
              ) : (
                <div className="mt-2 flex items-center gap-3 text-sm text-muted-foreground">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary">
                    <Gem className="size-4" />
                  </span>
                  Complete an article to see its value.
                </div>
              )}
            </div>

            {quote && (
              <div className="space-y-2.5 border-b border-[var(--glass-edge)] p-5">
                <SummaryRow label="Market value">{formatMoney(quote.market_value)}</SummaryRow>
                <SummaryRow label="Net weight">
                  <span className="inline-flex items-center gap-1.5">
                    <Scale className="size-3.5 text-muted-foreground" />
                    {Number(quote.net_weight).toFixed(3)} g
                  </span>
                </SummaryRow>
                <SummaryRow label="Scheme">
                  <Badge tone="primary">{quote.scheme.code}</Badge> <span className="ml-1">{Number(quote.monthly_rate)}% / month</span>
                </SummaryRow>
              </div>
            )}

            <div className="space-y-4 p-5">
              <div>
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-muted-foreground">{opening ? 'Capital' : 'Loan'}</span>
                  <span className={cn('text-xl font-medium tabular-nums', overValue && 'text-destructive')}>{Number(amount) > 0 ? formatMoney(amount) : '—'}</span>
                </div>
                {Number(months) > 0 && <p className="text-right text-xs text-muted-foreground">for {months} month{Number(months) > 1 ? 's' : ''}</p>}
                {quote && Number(amount) > 0 && (
                  <div className="mt-3">
                    <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                      <div className={cn('h-full rounded-full transition-all', overValue ? 'bg-destructive' : ltv > 90 ? 'bg-warning' : 'bg-primary')} style={{ width: `${overValue ? 100 : ltv}%` }} />
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">{overValue ? 'Above the article value' : `${ltv.toFixed(0)}% of article value`}</p>
                  </div>
                )}
              </div>

              {!canSubmit && (
                <ul className="space-y-1.5 text-xs">
                  {checklist.map((c) => (
                    <li key={c.label} className={cn('flex items-center gap-2', c.ok ? 'text-muted-foreground line-through decoration-muted-foreground/40' : 'text-foreground')}>
                      {c.ok ? <Check className="size-3.5 text-primary" /> : <Circle className="size-3.5 text-muted-foreground" />}
                      {c.label}
                    </li>
                  ))}
                </ul>
              )}

              <Button variant="primary" className="h-12 w-full text-[15px]" disabled={!canSubmit || !!overValue} loading={saving} onClick={submit}>
                {opening ? 'Save opening ticket' : 'Save pawn & print'}
              </Button>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  )
}
