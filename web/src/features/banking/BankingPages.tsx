import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeftRight, Ban, CheckCheck, Landmark, Plus, Undo2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Badge, Button, Card, Dialog, EmptyState, Field, Input, PageHeader, Pagination, Select, Spinner, Table, Td, Th } from '@/components/ui'
import { AccountSelect, isCashOrBank, today } from '@/features/accounting/shared'
import { useAuth } from '@/features/auth/AuthProvider'
import { ReasonDialog } from '@/features/pawning/ActionDialogs'
import { api, errorMessage } from '@/lib/api'
import { useApiMutation, useLookups } from '@/lib/hooks'
import type { Paginated } from '@/lib/types'
import { cn, formatMoney } from '@/lib/utils'

type BankAccount = {
  id: number
  account_no: string
  account_name: string
  account_id: number
  balance: string
  bank_branch?: { name: string; bank?: { name: string } }
  ledger_account?: { code: string; name: string }
}

function useBankAccounts() {
  return useQuery({ queryKey: ['bank-accounts'], queryFn: async () => (await api.get<{ data: BankAccount[] }>('/api/v1/banking/accounts')).data.data })
}

/* ================================================================ Bank accounts & transfers */

export function BankAccountsPage() {
  const { can } = useAuth()
  const accounts = useBankAccounts()
  const [adding, setAdding] = useState(false)
  const [transferring, setTransferring] = useState(false)

  return (
    <div>
      <PageHeader
        title="Bank accounts"
        description="Each bank account has its own ledger account. Use a transfer to deposit cash to the bank or withdraw it."
        actions={can('banking.manage') && (
          <>
            <Button variant="secondary" onClick={() => setTransferring(true)}><ArrowLeftRight className="size-4" /> Transfer</Button>
            <Button onClick={() => setAdding(true)}><Plus className="size-4" /> Add account</Button>
          </>
        )}
      />
      {accounts.isPending ? <Spinner /> : accounts.data?.length === 0 ? (
        <Card><EmptyState title="No bank accounts yet">Add banks under Masters → Banks first.</EmptyState></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {accounts.data?.map((a) => (
            <Card key={a.id} className="p-5">
              <div className="mb-2 flex items-center gap-2"><Landmark className="size-5 text-primary" /><p className="font-semibold">{a.account_name}</p></div>
              <p className="text-sm text-muted-foreground">{a.bank_branch?.bank?.name} · {a.bank_branch?.name}</p>
              <p className="font-mono text-sm">{a.account_no}</p>
              <p className="mt-3 text-2xl font-semibold tabular-nums">{formatMoney(a.balance)}</p>
              <p className="text-xs text-muted-foreground">Ledger {a.ledger_account?.code}</p>
            </Card>
          ))}
        </div>
      )}
      <AddBankAccountDialog open={adding} onClose={() => setAdding(false)} />
      <TransferDialog open={transferring} onClose={() => setTransferring(false)} />
    </div>
  )
}

function AddBankAccountDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: lookups } = useLookups()
  const [f, setF] = useState({ bank_branch_id: '', account_no: '', account_name: '' })
  const save = useApiMutation<typeof f>({
    url: '/api/v1/banking/accounts',
    invalidate: [['bank-accounts'], ['account-options'], ['chart']],
    success: 'Bank account added',
    onSuccess: () => { setF({ bank_branch_id: '', account_no: '', account_name: '' }); onClose() },
  })
  const branches = (lookups?.banks ?? []).flatMap((b) => b.branches.map((br) => ({ id: br.id, label: `${b.name} — ${br.name}` })))

  return (
    <Dialog open={open} onClose={onClose} size="sm" title="Add bank account"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate(f)}>Add</Button></>}>
      <div className="space-y-4">
        <Field label="Bank branch" required error={save.fieldErrors.bank_branch_id}>
          <Select value={f.bank_branch_id} onChange={(e) => setF({ ...f, bank_branch_id: e.target.value })}>
            <option value="">Select…</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
          </Select>
        </Field>
        <Field label="Account number" required error={save.fieldErrors.account_no}><Input value={f.account_no} onChange={(e) => setF({ ...f, account_no: e.target.value })} /></Field>
        <Field label="Account name" required error={save.fieldErrors.account_name}><Input value={f.account_name} onChange={(e) => setF({ ...f, account_name: e.target.value })} placeholder="e.g. Sampath Current" /></Field>
      </div>
    </Dialog>
  )
}

function TransferDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [f, setF] = useState({ from_account_id: '', to_account_id: '', amount: '', date: today(), narration: '' })
  const save = useApiMutation<typeof f>({
    url: '/api/v1/banking/transfers',
    invalidate: [['bank-accounts'], ['cash-book']],
    success: 'Transfer posted',
    onSuccess: () => { setF({ ...f, amount: '', narration: '' }); onClose() },
  })
  return (
    <Dialog open={open} onClose={onClose} size="sm" title="Cash / bank transfer" description="E.g. cash deposited to the bank, or cash withdrawn."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate(f)}>Post transfer</Button></>}>
      <div className="space-y-4">
        <Field label="From" required error={save.fieldErrors.from_account_id}><AccountSelect value={f.from_account_id} onChange={(v) => setF({ ...f, from_account_id: v })} filter={isCashOrBank} /></Field>
        <Field label="To" required error={save.fieldErrors.to_account_id}><AccountSelect value={f.to_account_id} onChange={(v) => setF({ ...f, to_account_id: v })} filter={isCashOrBank} /></Field>
        <Field label="Amount (Rs.)" required error={save.fieldErrors.amount}><Input type="number" min={0} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="Date" error={save.fieldErrors.date}><Input type="date" max={today()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Narration"><Input value={f.narration} onChange={(e) => setF({ ...f, narration: e.target.value })} /></Field>
      </div>
    </Dialog>
  )
}

/* ================================================================ Cheques */

type Cheque = {
  id: number
  direction: 'received' | 'issued'
  cheque_no: string
  party_name: string
  amount: string
  cheque_date: string
  status: string
  return_reason: string | null
  bank_branch?: { name: string; bank?: { name: string } } | null
  bank_account?: { account_name: string; account_no: string } | null
  counter_account?: { code: string; name: string } | null
}

const statusTone = (s: string) => (['cleared', 'presented'].includes(s) ? 'success' : ['returned', 'cancelled'].includes(s) ? 'danger' : s === 'deposited' ? 'primary' : 'warning')

export function ChequesPage() {
  const { can } = useAuth()
  const qc = useQueryClient()
  const banks = useBankAccounts()
  const [direction, setDirection] = useState<'received' | 'issued'>('received')
  const [page, setPage] = useState(1)
  const [newOpen, setNewOpen] = useState(false)
  const [depositing, setDepositing] = useState<Cheque | null>(null)
  const [returning, setReturning] = useState<Cheque | null>(null)

  const list = useQuery({
    queryKey: ['cheques', direction, page],
    queryFn: async () => (await api.get<Paginated<Cheque>>('/api/v1/banking/cheques', { params: { direction, page } })).data,
  })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['cheques'] }); qc.invalidateQueries({ queryKey: ['bank-accounts'] }) }
  const act = async (url: string, body: object, msg: string) => {
    try { await api.post(url, body); toast.success(msg); refresh() } catch (e) { toast.error(errorMessage(e)) }
  }

  return (
    <div>
      <PageHeader
        title="Cheques"
        description="Received: in hand → deposited → cleared (or returned). Issued: issued → presented (or cancelled). Each step updates the ledger."
        actions={can('banking.manage') && <Button onClick={() => setNewOpen(true)}><Plus className="size-4" /> {direction === 'received' ? 'Record received cheque' : 'Issue cheque'}</Button>}
      />
      <div className="mb-3 flex gap-2">
        <Button size="sm" variant={direction === 'received' ? 'primary' : 'secondary'} onClick={() => { setDirection('received'); setPage(1) }}>Received</Button>
        <Button size="sm" variant={direction === 'issued' ? 'primary' : 'secondary'} onClick={() => { setDirection('issued'); setPage(1) }}>Issued</Button>
      </div>
      <Card>
        {list.isPending ? <div className="grid place-items-center py-14"><Spinner /></div> : list.data?.data.length === 0 ? <EmptyState title="No cheques" /> : (
          <Table>
            <thead><tr><Th>Cheque</Th><Th>Date</Th><Th>{direction === 'received' ? 'From' : 'To'}</Th><Th>Bank</Th><Th>For account</Th><Th className="text-right">Amount</Th><Th>Status</Th><Th /></tr></thead>
            <tbody>
              {list.data?.data.map((c) => (
                <tr key={c.id}>
                  <Td className="font-mono">{c.cheque_no}</Td>
                  <Td>{c.cheque_date.slice(0, 10)}</Td>
                  <Td>{c.party_name}</Td>
                  <Td className="text-xs">{c.direction === 'received' ? `${c.bank_branch?.bank?.name ?? ''} ${c.bank_branch?.name ?? ''}` : c.bank_account?.account_name}{c.direction === 'received' && c.bank_account && <div className="text-muted-foreground">→ {c.bank_account.account_name}</div>}</Td>
                  <Td className="text-xs">{c.counter_account?.code} · {c.counter_account?.name}</Td>
                  <Td className="text-right tabular-nums font-medium">{formatMoney(c.amount)}</Td>
                  <Td><Badge tone={statusTone(c.status)}>{c.status.replace('_', ' ')}</Badge>{c.return_reason && <div className="text-xs text-destructive">{c.return_reason}</div>}</Td>
                  <Td className="whitespace-nowrap">
                    {can('banking.manage') && (
                      <>
                        {c.status === 'in_hand' && <Button size="sm" variant="secondary" onClick={() => setDepositing(c)}>Deposit</Button>}
                        {(c.status === 'deposited' || c.status === 'issued') && (
                          <Button size="sm" variant="ghost" className="text-success" onClick={() => act(`/api/v1/banking/cheques/${c.id}/clear`, {}, 'Cheque cleared')} aria-label="Mark cleared"><CheckCheck className="size-4" /></Button>
                        )}
                        {['in_hand', 'deposited', 'issued'].includes(c.status) && (
                          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setReturning(c)} aria-label={c.direction === 'issued' ? 'Cancel cheque' : 'Returned'}>
                            {c.direction === 'issued' ? <Ban className="size-4" /> : <Undo2 className="size-4" />}
                          </Button>
                        )}
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

      <NewChequeDialog open={newOpen} direction={direction} banks={banks.data ?? []} onClose={() => setNewOpen(false)} onSaved={refresh} />
      <Dialog open={!!depositing} onClose={() => setDepositing(null)} size="sm" title={`Deposit cheque ${depositing?.cheque_no ?? ''}`}>
        <div className="space-y-2">
          {(banks.data ?? []).map((b) => (
            <Button key={b.id} variant="secondary" className="w-full justify-start" onClick={async () => { await act(`/api/v1/banking/cheques/${depositing!.id}/deposit`, { bank_account_id: b.id }, 'Cheque deposited'); setDepositing(null) }}>
              <Landmark className="size-4" /> {b.account_name} · {b.account_no}
            </Button>
          ))}
          {banks.data?.length === 0 && <p className="text-sm text-muted-foreground">Add a bank account first.</p>}
        </div>
      </Dialog>
      <ReasonDialog
        open={!!returning}
        onClose={() => setReturning(null)}
        title={returning?.direction === 'issued' ? `Cancel cheque ${returning?.cheque_no}` : `Cheque ${returning?.cheque_no ?? ''} returned`}
        description={returning?.direction === 'issued' ? 'The payment is reversed.' : 'The amount is owed again; the ledger entries are reversed.'}
        confirmLabel={returning?.direction === 'issued' ? 'Cancel cheque' : 'Mark returned'}
        danger
        onConfirm={async (reason) => { await act(`/api/v1/banking/cheques/${returning!.id}/return`, { reason }, 'Cheque updated'); setReturning(null) }}
      />
    </div>
  )
}

function NewChequeDialog({ open, direction, banks, onClose, onSaved }: { open: boolean; direction: 'received' | 'issued'; banks: BankAccount[]; onClose: () => void; onSaved: () => void }) {
  const { data: lookups } = useLookups()
  const blank = { cheque_no: '', party_name: '', amount: '', cheque_date: today(), counter_account_id: '', bank_branch_id: '', bank_account_id: '' }
  const [f, setF] = useState(blank)
  const save = useApiMutation<Record<string, string>>({
    url: direction === 'received' ? '/api/v1/banking/cheques/receive' : '/api/v1/banking/cheques/issue',
    invalidate: [['cheques']],
    success: 'Cheque recorded',
    onSuccess: () => { setF(blank); onSaved(); onClose() },
  })
  const e = save.fieldErrors
  const bankBranches = (lookups?.banks ?? []).flatMap((b) => b.branches.map((br) => ({ id: br.id, label: `${b.name} — ${br.name}` })))

  return (
    <Dialog open={open} onClose={onClose} title={direction === 'received' ? 'Record received cheque' : 'Issue cheque'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate(f)}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Cheque number" required error={e.cheque_no}><Input value={f.cheque_no} onChange={(x) => setF({ ...f, cheque_no: x.target.value })} /></Field>
        <Field label="Cheque date" required error={e.cheque_date}><Input type="date" value={f.cheque_date} onChange={(x) => setF({ ...f, cheque_date: x.target.value })} /></Field>
        <Field label={direction === 'received' ? 'Received from' : 'Pay to'} required error={e.party_name}><Input value={f.party_name} onChange={(x) => setF({ ...f, party_name: x.target.value })} /></Field>
        <Field label="Amount (Rs.)" required error={e.amount}><Input type="number" min={0} value={f.amount} onChange={(x) => setF({ ...f, amount: x.target.value })} /></Field>
        {direction === 'received' ? (
          <Field label="Drawer's bank" error={e.bank_branch_id}>
            <Select value={f.bank_branch_id} onChange={(x) => setF({ ...f, bank_branch_id: x.target.value })}>
              <option value="">—</option>
              {bankBranches.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
            </Select>
          </Field>
        ) : (
          <Field label="From our account" required error={e.bank_account_id}>
            <Select value={f.bank_account_id} onChange={(x) => setF({ ...f, bank_account_id: x.target.value })}>
              <option value="">Select…</option>
              {banks.map((b) => <option key={b.id} value={b.id}>{b.account_name} · {b.account_no}</option>)}
            </Select>
          </Field>
        )}
        <Field label={direction === 'received' ? 'Income / for account' : 'Expense / for account'} required error={e.counter_account_id}>
          <AccountSelect value={f.counter_account_id} onChange={(v) => setF({ ...f, counter_account_id: v })} filter={(a) => !a.is_cash && a.system_key !== 'cheques_in_hand'} />
        </Field>
      </div>
    </Dialog>
  )
}

/* ================================================================ Reconciliation */

type RecData = {
  book_balance: string
  cleared_before: string
  lines: { id: number; entry_date: string; entry_no: string; narration: string; debit: string; credit: string; reconciliation_id: number | null }[]
  reconciliation: { id: number; status: string; statement_balance: string } | null
  history: { id: number; statement_date: string; statement_balance: string; status: string }[]
}

export function ReconciliationPage() {
  const banks = useBankAccounts()
  const qc = useQueryClient()
  const [bankId, setBankId] = useState('')
  const [date, setDate] = useState(today())
  const [statement, setStatement] = useState('')
  const [ticked, setTicked] = useState<Set<number>>(new Set())
  const [saving, setSaving] = useState(false)

  const data = useQuery({
    queryKey: ['reconciliation', bankId, date],
    enabled: !!bankId,
    queryFn: async () => {
      const d = (await api.get<{ data: RecData }>(`/api/v1/banking/accounts/${bankId}/reconciliation`, { params: { statement_date: date } })).data.data
      setTicked(new Set(d.lines.filter((l) => l.reconciliation_id).map((l) => l.id)))
      if (d.reconciliation) setStatement(d.reconciliation.statement_balance)
      return d
    },
  })
  const d = data.data
  const tickedTotal = useMemo(() => (d?.lines ?? []).filter((l) => ticked.has(l.id)).reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0), [d, ticked])
  const cleared = Number(d?.cleared_before ?? 0) + tickedTotal
  const difference = Number(statement || 0) - cleared
  const done = d?.reconciliation?.status === 'completed'

  const save = async (complete: boolean) => {
    setSaving(true)
    try {
      await api.post(`/api/v1/banking/accounts/${bankId}/reconciliation`, { statement_date: date, statement_balance: statement, line_ids: Array.from(ticked), complete })
      toast.success(complete ? 'Reconciliation completed' : 'Draft saved')
      qc.invalidateQueries({ queryKey: ['reconciliation'] })
    } catch (e) { toast.error(errorMessage(e)) } finally { setSaving(false) }
  }

  return (
    <div>
      <PageHeader title="Bank reconciliation" description="Tick the ledger entries that appear on the bank statement. The statement balance must equal everything cleared." />
      <Card className="mb-4 grid gap-4 p-4 sm:grid-cols-3">
        <Field label="Bank account">
          <Select value={bankId} onChange={(e) => setBankId(e.target.value)}>
            <option value="">Select…</option>
            {banks.data?.map((b) => <option key={b.id} value={b.id}>{b.account_name} · {b.account_no}</option>)}
          </Select>
        </Field>
        <Field label="Statement date"><Input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Statement closing balance (Rs.)"><Input type="number" value={statement} onChange={(e) => setStatement(e.target.value)} disabled={done} /></Field>
      </Card>

      {!bankId ? <Card><EmptyState title="Choose a bank account" /></Card> : !d ? <Spinner /> : (
        <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
          <Card>
            {d.lines.length === 0 ? <EmptyState title="Nothing to reconcile up to this date" /> : (
              <Table>
                <thead><tr><Th /><Th>Date</Th><Th>Entry</Th><Th>Narration</Th><Th className="text-right">In</Th><Th className="text-right">Out</Th></tr></thead>
                <tbody>
                  {d.lines.map((l) => (
                    <tr key={l.id} className={cn(!done && 'cursor-pointer hover:bg-secondary/50')} onClick={() => !done && setTicked((s) => { const n = new Set(s); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); return n })}>
                      <Td><input type="checkbox" readOnly checked={ticked.has(l.id)} disabled={done} className="size-4" aria-label={`Cleared ${l.entry_no}`} /></Td>
                      <Td>{l.entry_date.slice(0, 10)}</Td>
                      <Td className="font-mono text-xs">{l.entry_no}</Td>
                      <Td>{l.narration}</Td>
                      <Td className="text-right tabular-nums">{Number(l.debit) ? formatMoney(l.debit) : ''}</Td>
                      <Td className="text-right tabular-nums">{Number(l.credit) ? formatMoney(l.credit) : ''}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
          <Card className="h-fit space-y-2 p-4 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Book balance</span><span className="tabular-nums">{formatMoney(d.book_balance)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Cleared earlier</span><span className="tabular-nums">{formatMoney(d.cleared_before)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Ticked now</span><span className="tabular-nums">{formatMoney(tickedTotal)}</span></div>
            <div className="flex justify-between border-t pt-2 font-semibold"><span>Cleared balance</span><span className="tabular-nums">{formatMoney(cleared)}</span></div>
            <div className={cn('flex justify-between font-semibold', Math.abs(difference) < 0.005 ? 'text-success' : 'text-destructive')}><span>Difference</span><span className="tabular-nums">{formatMoney(difference)}</span></div>
            {done ? <Badge tone="success">completed</Badge> : (
              <div className="flex gap-2 pt-2">
                <Button variant="secondary" loading={saving} disabled={statement === ''} onClick={() => save(false)}>Save draft</Button>
                <Button loading={saving} disabled={statement === '' || Math.abs(difference) >= 0.005} onClick={() => save(true)}>Complete</Button>
              </div>
            )}
            {d.history.length > 0 && (
              <div className="border-t pt-2">
                <p className="mb-1 text-xs font-semibold text-muted-foreground">Recent statements</p>
                {d.history.map((h) => <p key={h.id} className="text-xs">{h.statement_date.slice(0, 10)} · {formatMoney(h.statement_balance)} · {h.status}</p>)}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  )
}
