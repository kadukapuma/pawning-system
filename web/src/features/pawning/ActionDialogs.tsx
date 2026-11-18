import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Button, Dialog, Field, Input, Select, Spinner, Textarea } from '@/components/ui'
import { useAuth } from '@/features/auth/AuthProvider'
import { api, errorMessage } from '@/lib/api'
import { useDebounced } from '@/lib/hooks'
import { cn, formatMoney } from '@/lib/utils'
import type { PawnTicket, Statement } from './types'

type Common = { ticket: PawnTicket; open: boolean; onClose: () => void; onDone: (txnId: number) => void }

function Line({ label, value, strong, tone }: { label: ReactNode; value: ReactNode; strong?: boolean; tone?: 'muted' | 'danger' | 'success' }) {
  return (
    <div className={cn('flex justify-between gap-4 py-1 text-sm', strong && 'border-t pt-2 text-base font-semibold')}>
      <span className={tone === 'muted' ? 'text-muted-foreground' : ''}>{label}</span>
      <span className={cn('tabular-nums', tone === 'danger' && 'text-destructive', tone === 'success' && 'text-success')}>{value}</span>
    </div>
  )
}

function StatementLines({ s }: { s: Statement }) {
  return (
    <>
      <Line label="Capital" value={formatMoney(s.principal)} />
      <Line label={`Interest (${s.days} day${s.days === 1 ? '' : 's'})`} value={formatMoney(s.interest)} />
      {Number(s.service_charge) > 0 && <Line label="Service charge" value={formatMoney(s.service_charge)} />}
      {Number(s.letter_charge) > 0 && <Line label="Letter postage" value={formatMoney(s.letter_charge)} />}
    </>
  )
}

/** Submit helper shared by the three dialogs. */
function useSubmit(url: string, ticket: PawnTicket, onDone: (id: number) => void, success: string) {
  const qc = useQueryClient()
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const submit = async (body: Record<string, unknown>) => {
    setSaving(true)
    setErrors({})
    try {
      const r = await api.post<{ data: { id: number } }>(url, body)
      await qc.invalidateQueries({ queryKey: ['tickets'] })
      await qc.invalidateQueries({ queryKey: ['ticket', String(ticket.id)] })
      toast.success(success)
      onDone(r.data.data.id)
    } catch (e) {
      const data = (e as { response?: { data?: { errors?: Record<string, string[]> } } }).response?.data
      if (data?.errors) setErrors(Object.fromEntries(Object.entries(data.errors).map(([k, v]) => [k, v[0]])))
      toast.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }
  return { saving, errors, submit, setErrors }
}

function useQuote<T>(key: unknown[], url: string, params: Record<string, string | number>, enabled: boolean) {
  const debounced = useDebounced(params, 350)
  return useQuery({
    queryKey: [...key, debounced],
    queryFn: async () => (await api.get<{ data: T }>(url, { params: debounced })).data.data,
    enabled,
    retry: false,
  })
}

/* ================================================================ Part payment */

type PartQuote = {
  statement: Statement
  allocation: { paymentReceived: string; paidInterest: string; paidCharges: string; principalPaid: string; newPrincipal: string; capitalisedInterest: string; capitalisedCharges: string; redemptionTotal: string }
  new_scheme: string
  new_cycle_start: string
  new_maturity: string
  min_capital: string
}

export function PartPaymentDialog({ ticket, open, onClose, onDone }: Common) {
  const { can } = useAuth()
  const [amount, setAmount] = useState('')
  const [discount, setDiscount] = useState('')
  const [months, setMonths] = useState(String(ticket.valid_months || 1))
  const [remarks, setRemarks] = useState('')
  const max = ticket.scheme_version?.max_term_months ?? 12
  const quote = useQuote<PartQuote>(['pp-quote', ticket.id], `/api/v1/pawn-tickets/${ticket.id}/part-payment/quote`,
    { amount: amount || 0, discount: discount || 0, months: months || 1 }, open)
  const { saving, errors, submit, setErrors } = useSubmit(`/api/v1/pawn-tickets/${ticket.id}/part-payment`, ticket, onDone, 'Part payment saved')
  useEffect(() => { if (open) { setAmount(''); setDiscount(''); setRemarks(''); setErrors({}) } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const q = quote.data
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={`Part payment — ${ticket.receipt_no}`}
      description="Interest and letter postage are paid first, then capital. Unpaid interest is added to capital. The new interest period starts tomorrow."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={saving} disabled={!Number(amount)} onClick={() => submit({ amount, discount: discount || 0, months: Number(months), remarks: remarks || null })}>Save & print</Button></>}
    >
      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-4">
          <Field label="Amount paid (Rs.)" required error={errors.amount}>
            <Input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus className="text-lg font-semibold" />
          </Field>
          {can('pawn.discount') && (
            <Field label="Discount on interest (Rs.)" error={errors.discount}>
              <Input type="number" min={0} value={discount} onChange={(e) => setDiscount(e.target.value)} />
            </Field>
          )}
          <Field label="New term (months)" error={errors.months}>
            <Select value={months} onChange={(e) => setMonths(e.target.value)}>
              {Array.from({ length: max }, (_, i) => i + 1).map((m) => <option key={m}>{m}</option>)}
            </Select>
          </Field>
          <Field label="Remarks"><Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} className="min-h-14" /></Field>
        </div>
        <div className="rounded-lg bg-secondary/50 p-4">
          {!q ? <Spinner /> : (
            <>
              <p className="mb-1 text-xs font-semibold text-muted-foreground uppercase">Owed today</p>
              <StatementLines s={q.statement} />
              <Line label="To redeem fully" value={formatMoney(q.statement.redemption_total)} strong />
              {Number(amount) > 0 && (
                <>
                  <p className="mt-4 mb-1 text-xs font-semibold text-muted-foreground uppercase">This payment</p>
                  <Line label="Interest & postage paid" value={formatMoney(q.allocation.paidCharges)} />
                  <Line label="Capital repaid" value={formatMoney(q.allocation.principalPaid)} tone="success" />
                  {Number(q.allocation.capitalisedInterest) + Number(q.allocation.capitalisedCharges) > 0 && (
                    <Line label="Unpaid, added to capital" value={formatMoney(Number(q.allocation.capitalisedInterest) + Number(q.allocation.capitalisedCharges))} tone="danger" />
                  )}
                  <Line label="New capital" value={formatMoney(q.allocation.newPrincipal)} strong />
                  <Line label="Scheme / next maturity" value={`${q.new_scheme} · ${q.new_maturity}`} tone="muted" />
                </>
              )}
            </>
          )}
        </div>
      </div>
    </Dialog>
  )
}

/* ================================================================ Renewal */

type RenewalQuote = {
  statement: Statement
  stamp_duty: string
  preview: { article_value: string; total_due: string; available_amount: string; monthly_interest: string; valid_months: number; month_options: Record<string, string | null> }
  new_principal: string
  new_scheme: string
  new_maturity: string
}

export function RenewalDialog({ ticket, open, onClose, onDone }: Common) {
  const { can } = useAuth()
  const [extra, setExtra] = useState('')
  const [discount, setDiscount] = useState('')
  const [months, setMonths] = useState('1')
  const quote = useQuote<RenewalQuote>(['rn-quote', ticket.id], `/api/v1/pawn-tickets/${ticket.id}/renewal/quote`,
    { extra_cash: extra || 0, discount: discount || 0, months }, open)
  const { saving, errors, submit, setErrors } = useSubmit(`/api/v1/pawn-tickets/${ticket.id}/renewal`, ticket, onDone, 'Ticket renewed')
  useEffect(() => { if (open) { setExtra(''); setDiscount(''); setMonths('1'); setErrors({}) } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const q = quote.data
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="xl"
      title={`Renewal — ${ticket.receipt_no}`}
      description="Everything owed is added to the capital. The articles are re-valued at today's rates and the customer may take extra cash up to what they cover for the term."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={saving} onClick={() => submit({ extra_cash: extra || 0, discount: discount || 0, months: Number(months) })}>Renew & print</Button></>}
    >
      {!q ? <Spinner /> : (
        <div className="grid gap-5 md:grid-cols-[1fr_1.2fr]">
          <div className="space-y-4">
            <div className="rounded-lg bg-secondary/50 p-4">
              <StatementLines s={q.statement} />
              {Number(q.stamp_duty) > 0 && <Line label="Stamp duty" value={formatMoney(q.stamp_duty)} />}
              <Line label="Total owed" value={formatMoney(q.preview.total_due)} strong />
              <Line label="Article value today" value={formatMoney(q.preview.article_value)} tone="muted" />
            </div>
            <Field label="Extra cash to customer (Rs.)" error={errors.extra_cash}>
              <Input type="number" min={0} value={extra} onChange={(e) => setExtra(e.target.value)} />
            </Field>
            {can('pawn.discount') && (
              <Field label="Discount (Rs.)" error={errors.discount}>
                <Input type="number" min={0} value={discount} onChange={(e) => setDiscount(e.target.value)} />
              </Field>
            )}
            <div className="rounded-lg border p-3">
              <Line label="New capital" value={formatMoney(q.new_principal)} strong />
              <Line label="Scheme / maturity" value={`${q.new_scheme} · ${q.new_maturity}`} tone="muted" />
            </div>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">Choose the term — maximum extra cash per term {errors.months && <span className="text-destructive">({errors.months})</span>}</p>
            <div className="grid grid-cols-3 gap-2">
              {Object.entries(q.preview.month_options).map(([m, cap]) => {
                const ok = cap !== null && Number(cap) >= Number(extra || 0) && Number(cap) >= 0
                return (
                  <button
                    key={m}
                    type="button"
                    disabled={!ok}
                    onClick={() => setMonths(m)}
                    className={cn('rounded-lg border p-2 text-left text-sm', ok ? 'hover:bg-secondary' : 'opacity-40', months === m && 'border-primary bg-primary/10')}
                  >
                    <span className="font-medium">{m} month{m === '1' ? '' : 's'}</span>
                    <span className="block tabular-nums text-muted-foreground">{cap === null ? 'n/a' : formatMoney(cap)}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </Dialog>
  )
}

/* ================================================================ Redemption */

type RedemptionQuote = {
  statement: Statement
  totals: { principal: string; interest: string; service_charge: string; letter_charge: string; stamp_duty: string; discount: string; payable: string }
}

export function RedemptionDialog({ ticket, open, onClose, onDone }: Common) {
  const { can } = useAuth()
  const [discount, setDiscount] = useState('')
  const [cash, setCash] = useState('')
  const quote = useQuote<RedemptionQuote>(['rd-quote', ticket.id], `/api/v1/pawn-tickets/${ticket.id}/redemption/quote`, { discount: discount || 0 }, open)
  const { saving, errors, submit, setErrors } = useSubmit(`/api/v1/pawn-tickets/${ticket.id}/redemption`, ticket, onDone, 'Ticket redeemed')
  useEffect(() => { if (open) { setDiscount(''); setCash(''); setErrors({}) } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const q = quote.data
  const diff = q && cash ? Number(cash) - Number(q.totals.payable) : 0
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="md"
      title={`Redeem — ${ticket.receipt_no}`}
      description="Closes the ticket and releases all articles to the customer."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="accent" loading={saving} onClick={() => submit({ discount: discount || 0, cash_received: cash || null })}>Redeem & print</Button></>}
    >
      {!q ? <Spinner /> : (
        <div className="space-y-4">
          <div className="rounded-lg bg-secondary/50 p-4">
            <StatementLines s={q.statement} />
            {Number(q.totals.stamp_duty) > 0 && <Line label="Stamp duty" value={formatMoney(q.totals.stamp_duty)} />}
            {Number(q.totals.discount) > 0 && <Line label="Discount" value={`− ${formatMoney(q.totals.discount)}`} tone="success" />}
            <Line label="Payable" value={formatMoney(q.totals.payable)} strong />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {can('pawn.discount') && (
              <Field label="Discount (Rs.)" error={errors.discount}>
                <Input type="number" min={0} value={discount} onChange={(e) => setDiscount(e.target.value)} />
              </Field>
            )}
            <Field label="Cash received (Rs.)" error={errors.cash_received} hint="Leave empty if exactly the payable amount. Up to Rs. 5 difference is booked as rounding.">
              <Input type="number" min={0} value={cash} onChange={(e) => setCash(e.target.value)} placeholder={q.totals.payable} />
            </Field>
          </div>
          {cash && diff !== 0 && (
            <p className={cn('text-sm', Math.abs(diff) < 5 ? 'text-muted-foreground' : 'text-destructive')}>
              Rounding {diff > 0 ? '+' : '−'}{formatMoney(Math.abs(diff))}{Math.abs(diff) >= 5 && ' — too large'}
            </p>
          )}
        </div>
      )}
    </Dialog>
  )
}

/* ================================================================ Block / cancel */

export function ReasonDialog({
  open, onClose, title, description, confirmLabel, danger, onConfirm,
}: {
  open: boolean
  onClose: () => void
  title: string
  description: string
  confirmLabel: string
  danger?: boolean
  onConfirm: (reason: string) => Promise<void>
}) {
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (open) setReason('') }, [open])

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Back</Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            loading={saving}
            disabled={!reason.trim()}
            onClick={async () => { setSaving(true); try { await onConfirm(reason.trim()) } finally { setSaving(false) } }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <Field label="Reason" required>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </Field>
    </Dialog>
  )
}
