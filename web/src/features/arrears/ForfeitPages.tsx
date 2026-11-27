import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarClock, Gavel, PackageOpen, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge, Button, Card, Dialog, EmptyState, Field, Input, PageHeader, Spinner, Table, Td, Textarea, Th } from '@/components/ui'
import { useAuth } from '@/features/auth/AuthProvider'
import { ReasonDialog } from '@/features/pawning/ActionDialogs'
import { api, errorMessage } from '@/lib/api'
import { formatMoney } from '@/lib/utils'
import { reportSkipped, SelectAll, TicketCells, useSelection, type ArrearsRow, type Skipped, type TicketSummary } from './shared'
import { openPrintPreview } from '@/lib/print'

/* ================================================================ Reminders */

type ReminderRow = ArrearsRow & {
  letter_3_date: string | null
  reminder_due_date: string | null
  promise: { id: number; promise_date: string; remark: string | null; status: string; overdue: boolean } | null
}

export function ForfeitRemindersPage() {
  const { can } = useAuth()
  const qc = useQueryClient()
  const sel = useSelection()
  const [promiseFor, setPromiseFor] = useState<ReminderRow | null>(null)
  const [busy, setBusy] = useState(false)
  const list = useQuery({
    queryKey: ['forfeit-reminders'],
    queryFn: async () => (await api.get<{ data: ReminderRow[] }>('/api/v1/forfeit/reminders')).data.data,
  })

  const queue = async () => {
    setBusy(true)
    try {
      const r = await api.post<{ data: { queued: number[]; skipped: Skipped[] } }>('/api/v1/forfeit/queue', { ticket_ids: sel.ids() })
      reportSkipped(r.data.data.skipped)
      if (r.data.data.queued.length) toast.success(`${r.data.data.queued.length} ticket(s) moved to the forfeit queue`)
      sel.clear()
      qc.invalidateQueries({ queryKey: ['forfeit-reminders'] })
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  const rows = list.data ?? []
  return (
    <div>
      <PageHeader
        title="Forfeit reminders"
        description="Tickets whose reminder period after the 3rd letter has ended. Record the customer's promise to pay, or move the ticket to the forfeit queue once there is no promise or it was broken."
        actions={can('forfeit.queue') && (
          <Button variant="danger" disabled={sel.selected.size === 0} loading={busy} onClick={queue}>
            <Gavel className="size-4" /> Queue {sel.selected.size || ''} for forfeit
          </Button>
        )}
      />
      <Card>
        {list.isPending ? <div className="grid place-items-center py-14"><Spinner /></div> : rows.length === 0 ? <EmptyState title="No tickets on the reminder list" /> : (
          <Table>
            <thead>
              <tr>
                <Th><SelectAll ids={rows.map((r) => r.id)} sel={sel} /></Th>
                <Th>Receipt</Th><Th>Customer</Th><Th>Scheme</Th><Th>Maturity</Th><Th>3rd letter</Th>
                <Th className="text-right">To redeem</Th><Th>Promise</Th><Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={r.promise?.overdue ? 'bg-destructive/5' : ''}>
                  <Td><input type="checkbox" className="size-4" checked={sel.has(r.id)} onChange={() => sel.toggle(r.id)} aria-label={`Select ${r.receipt_no}`} /></Td>
                  <TicketCells t={r} />
                  <Td>{r.letter_3_date}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(r.total)}</Td>
                  <Td>
                    {r.promise ? (
                      <div>
                        <span>{r.promise.promise_date}</span>{' '}
                        {r.promise.overdue ? <Badge tone="danger">promise overdue</Badge> : <Badge tone="warning">promised</Badge>}
                        {r.promise.remark && <div className="text-xs text-muted-foreground">{r.promise.remark}</div>}
                      </div>
                    ) : <span className="text-muted-foreground">—</span>}
                  </Td>
                  <Td>
                    <Button size="sm" variant="secondary" onClick={() => setPromiseFor(r)}>
                      <CalendarClock className="size-4" /> {r.promise && !r.promise.overdue ? 'Extend' : 'Promise'}
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <PromiseDialog row={promiseFor} onClose={() => setPromiseFor(null)} onSaved={() => { setPromiseFor(null); qc.invalidateQueries({ queryKey: ['forfeit-reminders'] }) }} />
    </div>
  )
}

function PromiseDialog({ row, onClose, onSaved }: { row: ReminderRow | null; onClose: () => void; onSaved: () => void }) {
  const [date, setDate] = useState('')
  const [remark, setRemark] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await api.post(`/api/v1/pawn-tickets/${row!.id}/promises`, { promise_date: date, remark: remark || null })
      toast.success('Promise recorded')
      setDate('')
      setRemark('')
      onSaved()
    } catch (e) { setError(errorMessage(e)) } finally { setSaving(false) }
  }

  return (
    <Dialog
      open={!!row}
      onClose={onClose}
      size="sm"
      title={`Promise to pay — ${row?.receipt_no ?? ''}`}
      description={row?.promise && !row.promise.overdue ? `Current promise: ${row.promise.promise_date}. An extension must be later and is only possible before that date.` : 'The ticket cannot be queued for forfeit until this date has passed.'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={saving} disabled={!date} onClick={save}>Save promise</Button></>}
    >
      <div className="space-y-4">
        <Field label="Customer will pay by" required error={error ?? undefined}>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} min={new Date(Date.now() + 864e5).toISOString().slice(0, 10)} />
        </Field>
        <Field label="Remark"><Textarea value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="e.g. Will pay after salary" /></Field>
      </div>
    </Dialog>
  )
}

/* ================================================================ Forfeit queue */

type QueuedRow = ArrearsRow & { queued_at: string; is_blocked: boolean }

export function ForfeitQueuePage() {
  const { can } = useAuth()
  const qc = useQueryClient()
  const sel = useSelection()
  const [confirm, setConfirm] = useState(false)
  const [unqueue, setUnqueue] = useState<QueuedRow | null>(null)
  const [busy, setBusy] = useState(false)
  const list = useQuery({ queryKey: ['forfeit-queue'], queryFn: async () => (await api.get<{ data: QueuedRow[] }>('/api/v1/forfeit/queue')).data.data })

  const rows = list.data ?? []
  const chosen = rows.filter((r) => sel.has(r.id))
  const capital = chosen.reduce((s, r) => s + Number(r.principal_current), 0)

  const execute = async () => {
    setBusy(true)
    try {
      const r = await api.post<{ data: { forfeitures: number[]; skipped: Skipped[] } }>('/api/v1/forfeit/execute', { ticket_ids: sel.ids() })
      reportSkipped(r.data.data.skipped)
      if (r.data.data.forfeitures.length) toast.success(`${r.data.data.forfeitures.length} ticket(s) forfeited`)
      sel.clear()
      setConfirm(false)
      qc.invalidateQueries({ queryKey: ['forfeit-queue'] })
      qc.invalidateQueries({ queryKey: ['forfeit-awaiting'] })
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <div>
      <PageHeader
        title="Forfeit queue"
        description="Tickets approved for forfeiture. Forfeiting closes the loan: the capital moves to forfeited stock; unpaid interest is recorded but not counted as income."
        actions={can('forfeit.execute') && (
          <Button variant="danger" disabled={sel.selected.size === 0} onClick={() => setConfirm(true)}>
            <Gavel className="size-4" /> Forfeit {sel.selected.size || ''} selected
          </Button>
        )}
      />
      <Card>
        {list.isPending ? <div className="grid place-items-center py-14"><Spinner /></div> : rows.length === 0 ? <EmptyState title="The forfeit queue is empty" /> : (
          <Table>
            <thead>
              <tr>
                <Th><SelectAll ids={rows.map((r) => r.id)} sel={sel} /></Th>
                <Th>Receipt</Th><Th>Customer</Th><Th>Scheme</Th><Th>Maturity</Th><Th>Queued</Th>
                <Th className="text-right">Capital</Th><Th className="text-right">Interest & charges</Th><Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td><input type="checkbox" className="size-4" checked={sel.has(r.id)} onChange={() => sel.toggle(r.id)} disabled={r.is_blocked} aria-label={`Select ${r.receipt_no}`} /></Td>
                  <TicketCells t={r} />
                  <Td className="text-xs">{new Date(r.queued_at).toLocaleDateString()}{r.is_blocked && <Badge tone="danger">blocked</Badge>}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(r.principal_current)}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(r.arrears)}</Td>
                  <Td>{can('forfeit.queue') && <Button size="sm" variant="ghost" onClick={() => setUnqueue(r)}><Undo2 className="size-4" /> Remove</Button>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        size="sm"
        title="Forfeit tickets"
        description="This cannot be undone. The customer will no longer be able to redeem these articles."
        footer={<><Button variant="secondary" onClick={() => setConfirm(false)}>Back</Button><Button variant="danger" loading={busy} onClick={execute}>Forfeit {chosen.length} ticket(s)</Button></>}
      >
        <p className="text-sm">{chosen.map((r) => r.receipt_no).join(', ')}</p>
        <p className="mt-2 text-sm font-medium">Capital moved to forfeited stock: {formatMoney(capital)}</p>
      </Dialog>

      <ReasonDialog
        open={!!unqueue}
        onClose={() => setUnqueue(null)}
        title={`Remove ${unqueue?.receipt_no ?? ''} from queue`}
        description="The ticket goes back to the reminder list."
        confirmLabel="Remove"
        onConfirm={async (reason) => {
          try {
            await api.post(`/api/v1/pawn-tickets/${unqueue!.id}/unqueue`, { reason })
            toast.success('Removed from the forfeit queue')
            setUnqueue(null)
            qc.invalidateQueries({ queryKey: ['forfeit-queue'] })
          } catch (e) { toast.error(errorMessage(e)) }
        }}
      />
    </div>
  )
}

/* ================================================================ Transfer to stock */

type AwaitingRow = {
  id: number
  forfeit_no: string
  forfeit_date: string
  principal_at_forfeit: string
  interest_at_forfeit: string
  charges_at_forfeit: string
  ticket: TicketSummary
  items: { category: string | null; article_type: string | null; karat: string | null; quantity: number; net_weight: string }[]
}

export function TransferToStockPage() {
  const qc = useQueryClient()
  const sel = useSelection()
  const [busy, setBusy] = useState(false)
  const list = useQuery({ queryKey: ['forfeit-awaiting'], queryFn: async () => (await api.get<{ data: AwaitingRow[] }>('/api/v1/forfeit/awaiting-transfer')).data.data })
  const rows = list.data ?? []

  const transfer = async () => {
    setBusy(true)
    try {
      const r = await api.post<{ data: { id: number } }>('/api/v1/forfeit/transfer', { forfeiture_ids: sel.ids() })
      toast.success('Articles moved to sale stock')
      openPrintPreview(`/print/transfer/${r.data.data.id}`, 'Stock transfer')
      sel.clear()
      qc.invalidateQueries({ queryKey: ['forfeit-awaiting'] })
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <div>
      <PageHeader
        title="Transfer to sale stock"
        description="Move the articles of forfeited tickets into sale stock. Cost = the forfeited capital (split by article value); sale price = today's karat sale rate."
        actions={<Button disabled={sel.selected.size === 0} loading={busy} onClick={transfer}><PackageOpen className="size-4" /> Transfer {sel.selected.size || ''} & print</Button>}
      />
      <Card>
        {list.isPending ? <div className="grid place-items-center py-14"><Spinner /></div> : rows.length === 0 ? <EmptyState title="Nothing waiting to be transferred" /> : (
          <Table>
            <thead>
              <tr>
                <Th><SelectAll ids={rows.map((r) => r.id)} sel={sel} /></Th>
                <Th>Forfeit</Th><Th>Receipt</Th><Th>Customer</Th><Th>Articles</Th><Th className="text-right">Capital (cost)</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td><input type="checkbox" className="size-4" checked={sel.has(r.id)} onChange={() => sel.toggle(r.id)} aria-label={`Select ${r.forfeit_no}`} /></Td>
                  <Td><span className="font-mono text-xs">{r.forfeit_no}</span><div className="text-xs text-muted-foreground">{r.forfeit_date}</div></Td>
                  <Td className="font-mono">{r.ticket.receipt_no}</Td>
                  <Td>{r.ticket.customer.name}</Td>
                  <Td className="text-xs">{r.items.map((i, k) => <div key={k}>{i.quantity} × {i.article_type ?? i.category} · {i.karat} · {Number(i.net_weight).toFixed(3)} g</div>)}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(r.principal_at_forfeit)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  )
}
