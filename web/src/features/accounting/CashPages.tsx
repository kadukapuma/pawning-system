import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Lock, Plus, Printer, Unlock, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge, Button, Card, Dialog, EmptyState, Field, Input, PageHeader, Pagination, Select, Spinner, Table, Td, Textarea, Th } from '@/components/ui'
import { useAuth } from '@/features/auth/AuthProvider'
import { ReasonDialog } from '@/features/pawning/ActionDialogs'
import { api, errorMessage } from '@/lib/api'
import { useApiMutation } from '@/lib/hooks'
import type { Paginated } from '@/lib/types'
import { cn, formatMoney } from '@/lib/utils'
import { AccountSelect, isCashOrBank, today } from './shared'

/* ================================================================ Vouchers */

type Voucher = {
  id: number
  voucher_no: string
  type: 'payment' | 'receipt' | 'expense' | 'petty_cash'
  voucher_date: string
  party_name: string | null
  amount: string
  description: string | null
  status: 'pending' | 'posted' | 'rejected'
  rejection_reason: string | null
  requested_by: number
  account: { code: string; name: string }
  cash_account: { code: string; name: string }
  requester?: { name: string } | null
  approver?: { name: string } | null
}

const typeLabel = { payment: 'Payment', receipt: 'Receipt', expense: 'Expense', petty_cash: 'Petty cash' } as const

export function VouchersPage() {
  const { can, user } = useAuth()
  const qc = useQueryClient()
  const [status, setStatus] = useState('pending')
  const [page, setPage] = useState(1)
  const [creating, setCreating] = useState(false)
  const [rejecting, setRejecting] = useState<Voucher | null>(null)

  const list = useQuery({
    queryKey: ['vouchers', { status, page }],
    queryFn: async () => (await api.get<Paginated<Voucher>>('/api/v1/accounting/vouchers', { params: { status: status || undefined, page } })).data,
  })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['vouchers'] }); qc.invalidateQueries({ queryKey: ['cash-book'] }) }

  const approve = async (v: Voucher) => {
    try {
      await api.post(`/api/v1/accounting/vouchers/${v.id}/approve`)
      toast.success(`${v.voucher_no} approved and posted`)
      refresh()
    } catch (e) { toast.error(errorMessage(e)) }
  }

  return (
    <div>
      <PageHeader
        title="Vouchers"
        description="Payments, receipts, expenses and petty cash. A voucher is posted only after someone other than the requester approves it."
        actions={<Button onClick={() => setCreating(true)}><Plus className="size-4" /> New voucher</Button>}
      />
      <div className="mb-3 flex gap-2">
        {['pending', 'posted', 'rejected', ''].map((s) => (
          <Button key={s || 'all'} size="sm" variant={status === s ? 'primary' : 'secondary'} onClick={() => { setStatus(s); setPage(1) }}>
            {s ? s[0].toUpperCase() + s.slice(1) : 'All'}
          </Button>
        ))}
      </div>
      <Card>
        {list.isPending ? <div className="grid place-items-center py-14"><Spinner /></div> : list.data?.data.length === 0 ? <EmptyState title="No vouchers" /> : (
          <Table>
            <thead><tr><Th>No.</Th><Th>Date</Th><Th>Type</Th><Th>Account</Th><Th>Party / description</Th><Th>From / into</Th><Th className="text-right">Amount</Th><Th>Status</Th><Th /></tr></thead>
            <tbody>
              {list.data?.data.map((v) => (
                <tr key={v.id}>
                  <Td className="font-mono text-xs">{v.voucher_no}</Td>
                  <Td>{v.voucher_date.slice(0, 10)}</Td>
                  <Td>{typeLabel[v.type]}</Td>
                  <Td className="text-xs">{v.account.code} · {v.account.name}</Td>
                  <Td><div>{v.party_name}</div><div className="text-xs text-muted-foreground">{v.description}</div></Td>
                  <Td className="text-xs">{v.cash_account.name}</Td>
                  <Td className="text-right tabular-nums font-medium">{formatMoney(v.amount)}</Td>
                  <Td>
                    <Badge tone={v.status === 'posted' ? 'success' : v.status === 'rejected' ? 'danger' : 'warning'}>{v.status}</Badge>
                    <div className="text-xs text-muted-foreground">{v.requester?.name}{v.approver && ` → ${v.approver.name}`}</div>
                    {v.rejection_reason && <div className="text-xs text-destructive">{v.rejection_reason}</div>}
                  </Td>
                  <Td className="whitespace-nowrap">
                    {v.status === 'pending' && can('vouchers.approve') && v.requested_by !== user?.id && (
                      <>
                        <Button size="sm" variant="ghost" className="text-success" onClick={() => approve(v)} aria-label="Approve"><Check className="size-4" /></Button>
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setRejecting(v)} aria-label="Reject"><X className="size-4" /></Button>
                      </>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pagination meta={list.data?.meta} onPage={setPage} />
      </Card>
      <VoucherDialog open={creating} onClose={() => setCreating(false)} />
      <ReasonDialog
        open={!!rejecting}
        onClose={() => setRejecting(null)}
        title={`Reject ${rejecting?.voucher_no ?? ''}`}
        description="The voucher will not be posted."
        confirmLabel="Reject"
        danger
        onConfirm={async (reason) => {
          try {
            await api.post(`/api/v1/accounting/vouchers/${rejecting!.id}/reject`, { reason })
            toast.success('Voucher rejected')
            setRejecting(null)
            refresh()
          } catch (e) { toast.error(errorMessage(e)) }
        }}
      />
    </div>
  )
}

function VoucherDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const blank = { type: 'expense', voucher_date: today(), account_id: '', cash_account_id: '', amount: '', party_name: '', description: '' }
  const [f, setF] = useState(blank)
  const save = useApiMutation<typeof blank>({
    url: '/api/v1/accounting/vouchers',
    invalidate: [['vouchers']],
    success: 'Voucher sent for approval',
    onSuccess: () => { setF(blank); onClose() },
  })
  const e = save.fieldErrors
  const receipt = f.type === 'receipt'

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New voucher"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate(f)}>Send for approval</Button></>}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type" required>
          <Select value={f.type} onChange={(x) => setF({ ...f, type: x.target.value, account_id: '' })}>
            {Object.entries(typeLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        <Field label="Date" required error={e.voucher_date}><Input type="date" max={today()} value={f.voucher_date} onChange={(x) => setF({ ...f, voucher_date: x.target.value })} /></Field>
        <Field label={receipt ? 'Income / source account' : 'Expense / payee account'} required error={e.account_id} className="sm:col-span-2">
          <AccountSelect
            value={f.account_id}
            onChange={(v) => setF({ ...f, account_id: v })}
            filter={(a) => !isCashOrBank(a) && (receipt ? ['income', 'liability', 'equity'] : ['expense', 'liability', 'asset']).includes(a.type)}
            invalid={!!e.account_id}
          />
        </Field>
        <Field label={receipt ? 'Received into' : 'Paid from'} required error={e.cash_account_id}>
          <AccountSelect value={f.cash_account_id} onChange={(v) => setF({ ...f, cash_account_id: v })} filter={isCashOrBank} />
        </Field>
        <Field label="Amount (Rs.)" required error={e.amount}><Input type="number" min={0} value={f.amount} onChange={(x) => setF({ ...f, amount: x.target.value })} /></Field>
        <Field label={receipt ? 'Received from' : 'Paid to'} error={e.party_name}><Input value={f.party_name} onChange={(x) => setF({ ...f, party_name: x.target.value })} /></Field>
        <Field label="Description" error={e.description} className="sm:col-span-2"><Textarea value={f.description} onChange={(x) => setF({ ...f, description: x.target.value })} /></Field>
      </div>
    </Dialog>
  )
}

/* ================================================================ Cash book & day closing */

type CashBook = {
  date: string
  opening: string
  total_in: string
  total_out: string
  closing: string
  lines: { entry_no: string; narration: string; description: string | null; source_type: string | null; time: string; user: string | null; cash_in: string; cash_out: string; balance: string }[]
  day_closing: { status: 'open' | 'closed'; physical_cash: string | null; variance: string; closed_at: string | null; closer?: { name: string } | null } | null
}

export function CashBookPage({ closing = false }: { closing?: boolean }) {
  const { can } = useAuth()
  const qc = useQueryClient()
  const [date, setDate] = useState(today())
  const [closeOpen, setCloseOpen] = useState(false)
  const [reopen, setReopen] = useState(false)
  const book = useQuery({
    queryKey: ['cash-book', date],
    queryFn: async () => (await api.get<{ data: CashBook }>('/api/v1/accounting/cash-book', { params: { date } })).data.data,
  })
  const b = book.data
  const closed = b?.day_closing?.status === 'closed'

  return (
    <div>
      <PageHeader
        title={closing ? 'Day closing' : 'Cash book'}
        description={closing ? 'Count the cash in the safe and close the day. After closing, nothing more can be posted to that day.' : 'Every cash movement of the branch for the day, with a running balance.'}
        actions={
          <>
            <Input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} className="w-40" aria-label="Date" />
            <Button variant="secondary" onClick={() => window.print()}><Printer className="size-4" /> Print</Button>
            {!closed && can('day_closing.close') && <Button onClick={() => setCloseOpen(true)}><Lock className="size-4" /> Close day</Button>}
            {closed && can('journals.manage') && <Button variant="ghost" onClick={() => setReopen(true)}><Unlock className="size-4" /> Reopen</Button>}
          </>
        }
      />
      {!b ? <Spinner /> : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label="Opening cash" value={b.opening} />
            <Stat label="Cash in" value={b.total_in} tone="success" />
            <Stat label="Cash out" value={b.total_out} tone="danger" />
            <Stat label="Closing cash (book)" value={b.closing} strong />
          </div>
          {b.day_closing && (
            <Card className={cn('p-4 text-sm', closed ? 'border-success' : '')}>
              {closed ? (
                <span>
                  <Badge tone="success">closed</Badge> by {b.day_closing.closer?.name} at {b.day_closing.closed_at && new Date(b.day_closing.closed_at).toLocaleString()} ·
                  counted {formatMoney(b.day_closing.physical_cash)} · variance{' '}
                  <span className={Number(b.day_closing.variance) === 0 ? 'text-success' : 'font-semibold text-destructive'}>{formatMoney(b.day_closing.variance)}</span>
                </span>
              ) : <span><Badge tone="warning">reopened</Badge> This day was closed and reopened.</span>}
            </Card>
          )}
          <Card>
            {b.lines.length === 0 ? <EmptyState title="No cash movements on this day" /> : (
              <Table>
                <thead><tr><Th>Time</Th><Th>Entry</Th><Th>Details</Th><Th>By</Th><Th className="text-right">In</Th><Th className="text-right">Out</Th><Th className="text-right">Balance</Th></tr></thead>
                <tbody>
                  {b.lines.map((l, i) => (
                    <tr key={i}>
                      <Td className="text-xs">{new Date(l.time).toLocaleTimeString()}</Td>
                      <Td className="font-mono text-xs">{l.entry_no}</Td>
                      <Td><div>{l.narration}</div>{l.description && <div className="text-xs text-muted-foreground">{l.description}</div>}</Td>
                      <Td className="text-xs">{l.user}</Td>
                      <Td className="text-right tabular-nums text-success">{Number(l.cash_in) ? formatMoney(l.cash_in) : ''}</Td>
                      <Td className="text-right tabular-nums text-destructive">{Number(l.cash_out) ? formatMoney(l.cash_out) : ''}</Td>
                      <Td className="text-right tabular-nums font-medium">{formatMoney(l.balance)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
      )}
      <CloseDayDialog open={closeOpen} onClose={() => setCloseOpen(false)} date={date} bookClosing={b?.closing ?? '0'} />
      <ReasonDialog
        open={reopen}
        onClose={() => setReopen(false)}
        title={`Reopen ${date}`}
        description="Allows postings to this day again. The reopening is recorded in the audit log."
        confirmLabel="Reopen day"
        onConfirm={async (reason) => {
          try {
            await api.post('/api/v1/accounting/day-closings/reopen', { date, reason })
            toast.success('Day reopened')
            setReopen(false)
            qc.invalidateQueries({ queryKey: ['cash-book'] })
          } catch (e) { toast.error(errorMessage(e)) }
        }}
      />
    </div>
  )
}

function Stat({ label, value, tone, strong }: { label: string; value: string; tone?: 'success' | 'danger'; strong?: boolean }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('text-lg tabular-nums', strong && 'font-semibold', tone === 'success' && 'text-success', tone === 'danger' && 'text-destructive')}>{formatMoney(value)}</p>
    </Card>
  )
}

function CloseDayDialog({ open, onClose, date, bookClosing }: { open: boolean; onClose: () => void; date: string; bookClosing: string }) {
  const [counted, setCounted] = useState('')
  const save = useApiMutation<{ date: string; physical_cash: string }>({
    url: '/api/v1/accounting/day-closings',
    invalidate: [['cash-book']],
    success: 'Day closed',
    onSuccess: () => { setCounted(''); onClose() },
  })
  const variance = counted ? Number(counted) - Number(bookClosing) : 0

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      title={`Close ${date}`}
      description={`Book closing cash is ${formatMoney(bookClosing)}. Count the cash and enter the actual amount.`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={counted === ''} onClick={() => save.mutate({ date, physical_cash: counted })}>Close day</Button></>}
    >
      <Field label="Cash counted (Rs.)" required error={save.fieldErrors.physical_cash ?? save.fieldErrors.date}>
        <Input type="number" min={0} value={counted} onChange={(e) => setCounted(e.target.value)} autoFocus />
      </Field>
      {counted !== '' && (
        <p className={cn('mt-2 text-sm', variance === 0 ? 'text-success' : 'text-destructive')}>
          {variance === 0 ? 'Cash matches the book.' : `${variance > 0 ? 'Over' : 'Short'} by ${formatMoney(Math.abs(variance))}`}
        </p>
      )}
    </Dialog>
  )
}

/* ================================================================ Statements */

type TB = { as_of: string; rows: { code: string; name: string; type: string; group: string | null; debit: string; credit: string }[]; total_debit: string; total_credit: string; balanced: boolean }
type PL = { income: { code: string; name: string; amount: string }[]; expenses: { code: string; name: string; amount: string }[]; total_income: string; total_expenses: string; net_profit: string }
type BS = { assets: Row[]; liabilities: Row[]; equity: Row[]; total_assets: string; total_liabilities: string; total_equity: string; current_profit: string; total_liabilities_and_equity: string; balanced: boolean }
type Row = { code: string; name: string; amount: string }

export function StatementsPage() {
  const { can } = useAuth()
  const [tab, setTab] = useState<'tb' | 'pl' | 'bs'>('tb')
  const [asOf, setAsOf] = useState(today())
  const [from, setFrom] = useState(today().slice(0, 8) + '01')
  const [all, setAll] = useState(false)
  const branch = all ? 'all' : undefined

  const tb = useQuery({ queryKey: ['tb', asOf, all], enabled: tab === 'tb', queryFn: async () => (await api.get<{ data: TB }>('/api/v1/accounting/trial-balance', { params: { as_of: asOf, branch } })).data.data })
  const pl = useQuery({ queryKey: ['pl', from, asOf, all], enabled: tab === 'pl', queryFn: async () => (await api.get<{ data: PL }>('/api/v1/accounting/profit-and-loss', { params: { from, to: asOf, branch } })).data.data })
  const bs = useQuery({ queryKey: ['bs', asOf, all], enabled: tab === 'bs', queryFn: async () => (await api.get<{ data: BS }>('/api/v1/accounting/balance-sheet', { params: { as_of: asOf, branch } })).data.data })

  return (
    <div>
      <PageHeader title="Financial statements" description="Straight from the double-entry ledger." actions={<Button variant="secondary" onClick={() => window.print()}><Printer className="size-4" /> Print</Button>} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {([['tb', 'Trial balance'], ['pl', 'Profit & loss'], ['bs', 'Balance sheet']] as const).map(([k, l]) => (
          <Button key={k} size="sm" variant={tab === k ? 'primary' : 'secondary'} onClick={() => setTab(k)}>{l}</Button>
        ))}
        {tab === 'pl' && <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" aria-label="From" />}
        <Input type="date" value={asOf} max={today()} onChange={(e) => setAsOf(e.target.value)} className="w-40" aria-label={tab === 'pl' ? 'To' : 'As of'} />
        {can('reports.all_branches') && (
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} className="size-4" /> All branches</label>
        )}
      </div>

      {tab === 'tb' && (tb.data ? (
        <Card>
          <Table>
            <thead><tr><Th>Code</Th><Th>Account</Th><Th>Type</Th><Th className="text-right">Debit</Th><Th className="text-right">Credit</Th></tr></thead>
            <tbody>
              {tb.data.rows.map((r) => (
                <tr key={r.code}><Td className="font-mono text-xs">{r.code}</Td><Td>{r.name}</Td><Td className="capitalize">{r.type}</Td>
                  <Td className="text-right tabular-nums">{Number(r.debit) ? formatMoney(r.debit) : ''}</Td><Td className="text-right tabular-nums">{Number(r.credit) ? formatMoney(r.credit) : ''}</Td></tr>
              ))}
              <tr className="font-semibold"><Td colSpan={3}>Total {tb.data.balanced ? <Badge tone="success">balanced</Badge> : <Badge tone="danger">not balanced</Badge>}</Td>
                <Td className="text-right tabular-nums">{formatMoney(tb.data.total_debit)}</Td><Td className="text-right tabular-nums">{formatMoney(tb.data.total_credit)}</Td></tr>
            </tbody>
          </Table>
        </Card>
      ) : <Spinner />)}

      {tab === 'pl' && (pl.data ? (
        <Card className="max-w-2xl p-5">
          <Section title="Income" rows={pl.data.income} total={pl.data.total_income} />
          <Section title="Expenses" rows={pl.data.expenses} total={pl.data.total_expenses} />
          <div className={cn('mt-3 flex justify-between border-t-2 pt-2 text-lg font-semibold', Number(pl.data.net_profit) < 0 && 'text-destructive')}>
            <span>Net {Number(pl.data.net_profit) < 0 ? 'loss' : 'profit'}</span><span className="tabular-nums">{formatMoney(pl.data.net_profit)}</span>
          </div>
        </Card>
      ) : <Spinner />)}

      {tab === 'bs' && (bs.data ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-5"><Section title="Assets" rows={bs.data.assets} total={bs.data.total_assets} /></Card>
          <Card className="p-5">
            <Section title="Liabilities" rows={bs.data.liabilities} total={bs.data.total_liabilities} />
            <Section title="Equity" rows={[...bs.data.equity, { code: '', name: 'Profit / (loss) to date', amount: bs.data.current_profit }]} total={(Number(bs.data.total_equity) + Number(bs.data.current_profit)).toFixed(2)} />
            <div className="mt-3 flex justify-between border-t-2 pt-2 font-semibold">
              <span>Liabilities + equity {bs.data.balanced ? <Badge tone="success">balanced</Badge> : <Badge tone="danger">not balanced</Badge>}</span>
              <span className="tabular-nums">{formatMoney(bs.data.total_liabilities_and_equity)}</span>
            </div>
          </Card>
        </div>
      ) : <Spinner />)}
    </div>
  )
}

function Section({ title, rows, total }: { title: string; rows: Row[]; total: string }) {
  return (
    <div className="mb-4">
      <h3 className="mb-1 text-sm font-semibold">{title}</h3>
      {rows.length === 0 && <p className="text-sm text-muted-foreground">None</p>}
      {rows.map((r, i) => (
        <div key={i} className="flex justify-between text-sm"><span>{r.code && <span className="mr-2 font-mono text-xs text-muted-foreground">{r.code}</span>}{r.name}</span><span className="tabular-nums">{formatMoney(r.amount)}</span></div>
      ))}
      <div className="mt-1 flex justify-between border-t pt-1 text-sm font-semibold"><span>Total {title.toLowerCase()}</span><span className="tabular-nums">{formatMoney(total)}</span></div>
    </div>
  )
}
