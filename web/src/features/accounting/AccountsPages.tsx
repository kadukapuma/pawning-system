import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, ChevronDown, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react'
import { Fragment, useState } from 'react'
import { toast } from 'sonner'
import { Badge, Button, Card, Checkbox, Dialog, EmptyState, Field, Input, PageHeader, Pagination, Select, Spinner, Table, Td, Th } from '@/components/ui'
import { useAuth } from '@/features/auth/AuthProvider'
import { ReasonDialog } from '@/features/pawning/ActionDialogs'
import { api, errorMessage } from '@/lib/api'
import { useApiMutation } from '@/lib/hooks'
import type { Paginated } from '@/lib/types'
import { cn, formatMoney } from '@/lib/utils'
import { AccountSelect, today } from './shared'

/* ================================================================ Chart of accounts */

type Group = { id: number; code: string; name: string; type: string; parent_id: number | null }
type Acc = { id: number; code: string; name: string; account_group_id: number; type: string; normal_balance: string; is_system: boolean; system_key: string | null; is_active: boolean; is_cash: boolean; is_bank: boolean; opening_balance: string; balance: string }

export function ChartOfAccountsPage() {
  const { can } = useAuth()
  const [editing, setEditing] = useState<Acc | 'new' | null>(null)
  const data = useQuery({
    queryKey: ['chart'],
    queryFn: async () => (await api.get<{ data: { groups: Group[]; accounts: Acc[] } }>('/api/v1/accounting/accounts')).data.data,
  })

  const groups = data.data?.groups ?? []
  const leafGroups = groups.filter((g) => !groups.some((c) => c.parent_id === g.id) || data.data?.accounts.some((a) => a.account_group_id === g.id))

  return (
    <div>
      <PageHeader
        title="Chart of accounts"
        description="Balances for the working branch as of today, shown in each account's normal direction. System accounts are used automatically by pawning, sales and banking."
        actions={can('accounts.manage') && <Button onClick={() => setEditing('new')}><Plus className="size-4" /> New account</Button>}
      />
      {data.isPending ? <Spinner /> : (
        <Card>
          <Table>
            <thead><tr><Th>Code</Th><Th>Account</Th><Th>Type</Th><Th className="text-right">Balance</Th><Th /></tr></thead>
            <tbody>
              {leafGroups.map((g) => {
                const accounts = data.data!.accounts.filter((a) => a.account_group_id === g.id)
                if (accounts.length === 0) return null
                return (
                  <Fragment key={g.id}>
                    <tr className="bg-secondary/40"><Td colSpan={5} className="text-xs font-semibold uppercase text-muted-foreground">{g.code} · {g.name}</Td></tr>
                    {accounts.map((a) => (
                      <tr key={a.id} className={a.is_active ? '' : 'opacity-50'}>
                        <Td className="font-mono text-xs">{a.code}</Td>
                        <Td>
                          {a.name} {a.is_system && <Badge>system</Badge>} {a.is_bank && <Badge tone="primary">bank</Badge>} {a.is_cash && <Badge tone="primary">cash</Badge>}
                        </Td>
                        <Td className="capitalize">{a.type}</Td>
                        <Td className={cn('text-right tabular-nums', Number(a.balance) < 0 && 'text-destructive')}>{formatMoney(a.balance)}</Td>
                        <Td>{can('accounts.manage') && <Button size="sm" variant="ghost" onClick={() => setEditing(a)} aria-label="Edit"><Pencil className="size-4" /></Button>}</Td>
                      </tr>
                    ))}
                  </Fragment>
                )
              })}
            </tbody>
          </Table>
        </Card>
      )}
      <AccountDialog account={editing} groups={groups} onClose={() => setEditing(null)} />
    </div>
  )
}

function AccountDialog({ account, groups, onClose }: { account: Acc | 'new' | null; groups: Group[]; onClose: () => void }) {
  const isNew = account === 'new'
  const [f, setF] = useState({ code: '', name: '', account_group_id: '', opening_balance: '', is_active: true })
  const save = useApiMutation<Record<string, unknown>>({
    method: isNew ? 'post' : 'put',
    url: () => (isNew ? '/api/v1/accounting/accounts' : `/api/v1/accounting/accounts/${(account as Acc).id}`),
    invalidate: [['chart'], ['account-options']],
    success: 'Account saved',
    onSuccess: onClose,
  })
  const [last, setLast] = useState<unknown>(null)
  if (account !== last) {
    setLast(account)
    if (account) setF(isNew ? { code: '', name: '', account_group_id: '', opening_balance: '', is_active: true }
      : { code: account.code, name: account.name, account_group_id: String(account.account_group_id), opening_balance: account.opening_balance, is_active: account.is_active })
  }
  const e = save.fieldErrors

  return (
    <Dialog
      open={!!account}
      onClose={onClose}
      size="sm"
      title={isNew ? 'New account' : `Edit ${(account as Acc | null)?.code ?? ''}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate(isNew ? f : { name: f.name, is_active: f.is_active, opening_balance: f.opening_balance || 0 })}>Save</Button></>}
    >
      <div className="space-y-4">
        {isNew && (
          <>
            <Field label="Group" required error={e.account_group_id}>
              <Select value={f.account_group_id} onChange={(x) => setF({ ...f, account_group_id: x.target.value })}>
                <option value="">Select…</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.code} · {g.name} ({g.type})</option>)}
              </Select>
            </Field>
            <Field label="Code" required error={e.code}><Input value={f.code} onChange={(x) => setF({ ...f, code: x.target.value })} /></Field>
          </>
        )}
        <Field label="Name" required error={e.name}><Input value={f.name} onChange={(x) => setF({ ...f, name: x.target.value })} /></Field>
        <Field label="Opening balance (company-wide)" error={e.opening_balance}><Input type="number" value={f.opening_balance} onChange={(x) => setF({ ...f, opening_balance: x.target.value })} /></Field>
        {account && account !== 'new' && !account.is_system && <Checkbox label="Active" checked={f.is_active} onChange={(x) => setF({ ...f, is_active: x.target.checked })} />}
      </div>
    </Dialog>
  )
}

/* ================================================================ Journals */

type JournalLine = { id: number; debit: string; credit: string; description: string | null; account: { code: string; name: string } }
type Journal = { id: number; entry_no: string; entry_date: string; narration: string; status: string; source_type: string | null; reversal_of_id: number | null; poster?: { name: string } | null; lines: JournalLine[] }

export function JournalsPage() {
  const { can } = useAuth()
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const [manual, setManual] = useState(false)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [reversing, setReversing] = useState<Journal | null>(null)

  const list = useQuery({
    queryKey: ['journals', { page, manual, q }],
    queryFn: async () => (await api.get<Paginated<Journal>>('/api/v1/accounting/journals', { params: { page, manual: manual ? 1 : undefined, q: q || undefined } })).data,
  })

  return (
    <div>
      <PageHeader
        title="Journal entries"
        description="Every money movement as a balanced double entry. Pawning, sales, vouchers and banking post here automatically; manual journals are for corrections and opening balances."
        actions={can('journals.manage') && <Button onClick={() => setCreating(true)}><Plus className="size-4" /> Manual journal</Button>}
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b p-3">
          <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} placeholder="Entry no or narration…" className="max-w-xs" />
          <Checkbox label="Manual journals only" checked={manual} onChange={(e) => { setManual(e.target.checked); setPage(1) }} />
        </div>
        {list.isPending ? <div className="grid place-items-center py-14"><Spinner /></div> : list.data?.data.length === 0 ? <EmptyState title="No journals" /> : (
          <Table>
            <thead><tr><Th /><Th>Entry</Th><Th>Date</Th><Th>Narration</Th><Th>Source</Th><Th className="text-right">Amount</Th><Th>By</Th><Th /></tr></thead>
            <tbody>
              {list.data?.data.map((j) => {
                const amount = j.lines.reduce((s, l) => s + Number(l.debit), 0)
                return (
                  <Fragment key={j.id}>
                    <tr className="cursor-pointer hover:bg-secondary/50" onClick={() => setOpen(open === j.id ? null : j.id)}>
                      <Td className="w-6">{open === j.id ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</Td>
                      <Td className="font-mono text-xs">{j.entry_no}</Td>
                      <Td>{j.entry_date.slice(0, 10)}</Td>
                      <Td>{j.narration} {j.status === 'reversed' && <Badge tone="danger">reversed</Badge>}</Td>
                      <Td className="text-xs">{j.source_type?.replace(/_/g, ' ') ?? 'manual'}</Td>
                      <Td className="text-right tabular-nums">{formatMoney(amount)}</Td>
                      <Td className="text-xs">{j.poster?.name}</Td>
                      <Td>
                        {!j.source_type && j.status === 'posted' && !j.reversal_of_id && can('journals.manage') && (
                          <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setReversing(j) }} aria-label="Reverse"><Ban className="size-4" /></Button>
                        )}
                      </Td>
                    </tr>
                    {open === j.id && (
                      <tr><Td colSpan={8} className="bg-secondary/30">
                        <table className="w-full text-xs">
                          <tbody>
                            {j.lines.map((l) => (
                              <tr key={l.id}>
                                <td className="py-0.5 pr-4 font-mono">{l.account.code}</td>
                                <td className={cn('pr-4', Number(l.credit) > 0 && 'pl-6')}>{l.account.name}</td>
                                <td className="pr-4 text-muted-foreground">{l.description}</td>
                                <td className="w-28 text-right tabular-nums">{Number(l.debit) > 0 ? formatMoney(l.debit) : ''}</td>
                                <td className="w-28 text-right tabular-nums">{Number(l.credit) > 0 ? formatMoney(l.credit) : ''}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </Td></tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </Table>
        )}
        <Pagination meta={list.data?.meta} onPage={setPage} />
      </Card>
      <JournalDialog open={creating} onClose={() => setCreating(false)} />
      <ReasonDialog
        open={!!reversing}
        onClose={() => setReversing(null)}
        title={`Reverse ${reversing?.entry_no ?? ''}`}
        description="Posts a mirror entry; the original stays visible as reversed."
        confirmLabel="Reverse"
        danger
        onConfirm={async (reason) => {
          try {
            await api.post(`/api/v1/accounting/journals/${reversing!.id}/reverse`, { reason })
            toast.success('Journal reversed')
            setReversing(null)
            qc.invalidateQueries({ queryKey: ['journals'] })
          } catch (e) { toast.error(errorMessage(e)) }
        }}
      />
    </div>
  )
}

type Line = { key: number; account_id: string; debit: string; credit: string; description: string }
let k = 1
const blankLine = (): Line => ({ key: k++, account_id: '', debit: '', credit: '', description: '' })

function JournalDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [date, setDate] = useState(today())
  const [narration, setNarration] = useState('')
  const [lines, setLines] = useState<Line[]>([blankLine(), blankLine()])
  const save = useApiMutation<Record<string, unknown>>({
    url: '/api/v1/accounting/journals',
    invalidate: [['journals'], ['chart']],
    success: 'Journal posted',
    onSuccess: () => { setLines([blankLine(), blankLine()]); setNarration(''); onClose() },
  })
  const dr = lines.reduce((s, l) => s + Number(l.debit || 0), 0)
  const cr = lines.reduce((s, l) => s + Number(l.credit || 0), 0)
  const set = (key: number, p: Partial<Line>) => setLines((x) => x.map((l) => (l.key === key ? { ...l, ...p } : l)))

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="xl"
      title="Manual journal"
      description="Debits must equal credits."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={dr <= 0 || Math.abs(dr - cr) > 0.001 || !narration} onClick={() => save.mutate({ entry_date: date, narration, lines: lines.filter((l) => l.account_id) })}>Post journal</Button></>}
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
          <Field label="Date" error={save.fieldErrors.entry_date}><Input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Narration" required error={save.fieldErrors.narration}><Input value={narration} onChange={(e) => setNarration(e.target.value)} /></Field>
        </div>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-muted-foreground"><th className="pb-1">Account</th><th>Description</th><th className="w-32">Debit</th><th className="w-32">Credit</th><th /></tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.key}>
                <td className="p-1"><AccountSelect value={l.account_id} onChange={(v) => set(l.key, { account_id: v })} /></td>
                <td className="p-1"><Input value={l.description} onChange={(e) => set(l.key, { description: e.target.value })} /></td>
                <td className="p-1"><Input type="number" min={0} value={l.debit} onChange={(e) => set(l.key, { debit: e.target.value, credit: '' })} /></td>
                <td className="p-1"><Input type="number" min={0} value={l.credit} onChange={(e) => set(l.key, { credit: e.target.value, debit: '' })} /></td>
                <td className="p-1"><Button size="sm" variant="ghost" disabled={lines.length <= 2} onClick={() => setLines((x) => x.filter((y) => y.key !== l.key))} aria-label="Remove line"><Trash2 className="size-4" /></Button></td>
              </tr>
            ))}
            <tr className="font-medium">
              <td className="p-1"><Button size="sm" variant="secondary" onClick={() => setLines((x) => [...x, blankLine()])}><Plus className="size-4" /> Line</Button></td>
              <td className="p-1 text-right text-xs text-muted-foreground">Totals</td>
              <td className="p-1 tabular-nums">{formatMoney(dr)}</td>
              <td className="p-1 tabular-nums">{formatMoney(cr)}</td><td />
            </tr>
          </tbody>
        </table>
        {Math.abs(dr - cr) > 0.001 && <p className="text-sm text-destructive">Difference {formatMoney(Math.abs(dr - cr))}</p>}
        {save.fieldErrors.lines && <p className="text-sm text-destructive">{save.fieldErrors.lines}</p>}
      </div>
    </Dialog>
  )
}
