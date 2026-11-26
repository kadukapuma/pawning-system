import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Ban, Banknote, Lock, MessageSquare, Printer, RefreshCw, Unlock, Wallet } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Badge, Button, Card, Input, Spinner, Table, Td, Th } from '@/components/ui'
import { useAuth } from '@/features/auth/AuthProvider'
import { api, errorMessage } from '@/lib/api'
import { formatMoney } from '@/lib/utils'
import { PartPaymentDialog, ReasonDialog, RedemptionDialog, RenewalDialog } from './ActionDialogs'
import { statusTone, txnLabel, type PawnTicket, type Statement } from './types'

type DialogName = 'part-payment' | 'renewal' | 'redeem' | 'block' | 'unblock' | 'cancel' | null

const SMS_SLIP_TYPES = ['pawn', 'part_payment', 'renewal', 'redemption']

export function TicketDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { can } = useAuth()
  const qc = useQueryClient()
  const [dialog, setDialog] = useState<DialogName>(null)
  const [asOf, setAsOf] = useState('')

  const ticket = useQuery({
    queryKey: ['ticket', id],
    queryFn: async () => (await api.get<{ data: PawnTicket }>(`/api/v1/pawn-tickets/${id}`)).data.data,
  })
  const projected = useQuery({
    queryKey: ['ticket', id, 'statement', asOf],
    queryFn: async () => (await api.get<{ data: Statement }>(`/api/v1/pawn-tickets/${id}/statement`, { params: { date: asOf } })).data.data,
    enabled: !!asOf,
  })

  // Open an action straight from the menu (?action=...) or print after saving (?print=1).
  useEffect(() => {
    const action = params.get('action') as DialogName
    if (action && ticket.data?.status === 'active') setDialog(action)
    if (params.get('print') === '1' && ticket.data) window.open(`/print/ticket/${ticket.data.id}`, '_blank')
    if (action || params.get('print')) setParams({}, { replace: true })
  }, [ticket.data]) // eslint-disable-line react-hooks/exhaustive-deps

  if (ticket.isPending) return <div className="grid place-items-center py-20"><Spinner /></div>
  if (ticket.isError || !ticket.data) return <p className="text-destructive">Ticket not found in this branch.</p>
  const t = ticket.data
  const s = asOf && projected.data ? projected.data : t.statement
  const active = t.status === 'active'

  const done = (txnId: number) => {
    setDialog(null)
    window.open(`/print/transaction/${txnId}`, '_blank')
  }
  const refresh = () => qc.invalidateQueries({ queryKey: ['ticket', id] })
  const sendSlip = async (txnId: number, txnNo: string) => {
    if (!window.confirm(`Send the SMS slip for ${txnNo} to ${t.customer?.phone1}?`)) return
    try {
      const r = (await api.post<{ data: { status: string; error: string | null } }>(`/api/v1/pawn-transactions/${txnId}/sms`)).data.data
      if (r.status === 'sent') toast.success('SMS slip sent')
      else toast.error(r.error ?? 'The SMS slip was not sent')
    } catch (e) { toast.error(errorMessage(e)) }
  }

  return (
    <div className="space-y-5">
      <Link to="/pawning/search" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Tickets
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Ticket {t.receipt_no}</h1>
            <Badge tone={statusTone(t.status)}>{t.status}</Badge>
            <Badge tone="primary">Scheme {t.scheme?.code}</Badge>
            {t.is_opening && <Badge>opening · old {t.legacy_receipt_no}</Badge>}
            {t.is_blocked && <Badge tone="danger">blocked</Badge>}
            {t.is_overdue && <Badge tone="danger">overdue</Badge>}
            {t.arrears_stage !== 'none' && <Badge tone="warning">{t.arrears_stage.replace('_', ' ')}</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">
            Stock {t.stock_no} · Ticket {t.ticket_no} · Branch {t.branch?.code} · Pawned {t.pawn_date}{t.created_by && ` by ${t.created_by}`}
          </p>
          {t.is_blocked && <p className="mt-1 text-sm text-destructive">Blocked: {t.block_reason}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {active && can('pawn.part_payment') && <Button onClick={() => setDialog('part-payment')}><Wallet className="size-4" /> Part payment</Button>}
          {active && can('pawn.renew') && <Button variant="secondary" disabled={t.is_blocked} onClick={() => setDialog('renewal')}><RefreshCw className="size-4" /> Renew</Button>}
          {active && can('pawn.redeem') && <Button variant="accent" disabled={t.is_blocked} onClick={() => setDialog('redeem')}><Banknote className="size-4" /> Redeem</Button>}
          <Button variant="secondary" onClick={() => window.open(`/print/ticket/${t.id}`, '_blank')}><Printer className="size-4" /> Print ticket</Button>
          {active && can('pawn.block') && (
            t.is_blocked
              ? <Button variant="ghost" onClick={() => setDialog('unblock')}><Unlock className="size-4" /> Unblock</Button>
              : <Button variant="ghost" onClick={() => setDialog('block')}><Lock className="size-4" /> Block</Button>
          )}
          {active && can('pawn.cancel') && (t.transactions?.length ?? 0) === 1 && new Date(t.created_at).toDateString() === new Date().toDateString() && (
            <Button variant="ghost" className="text-destructive" onClick={() => setDialog('cancel')}><Ban className="size-4" /> Cancel</Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-1">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">{active ? 'Owed' : 'Final position'}</h2>
            {active && <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="h-8 w-40 text-xs" aria-label="Calculate as of date" />}
          </div>
          {active && s ? (
            <dl className="space-y-1 text-sm">
              <Row label="As of">{s.calculation_date} ({s.days} day{s.days === 1 ? '' : 's'})</Row>
              <Row label="Capital">{formatMoney(s.principal)}</Row>
              <Row label="Interest">{formatMoney(s.interest)}</Row>
              <Row label="Service charge">{formatMoney(s.service_charge)}</Row>
              <Row label="Letter postage">{formatMoney(s.letter_charge)}</Row>
              <Row label="Arrears (excl. capital)">{formatMoney(s.arrears_total)}</Row>
              <div className="flex justify-between border-t pt-2 text-base font-semibold"><dt>To redeem</dt><dd className="tabular-nums">{formatMoney(s.redemption_total)}</dd></div>
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">This ticket is {t.status}. Capital now {formatMoney(t.principal_current)}.</p>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="mb-2 text-sm font-semibold">Customer</h2>
          {t.customer && (
            <div className="space-y-1 text-sm">
              <Link to={`/customers/${t.customer.id}`} className="font-medium text-primary hover:underline">
                {[t.customer.title, t.customer.full_name].filter(Boolean).join(' ')}
              </Link>
              <p>NIC {t.customer.nic} · {t.customer.phone1}</p>
              <p className="text-muted-foreground">{t.customer.address}</p>
            </div>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="mb-2 text-sm font-semibold">Loan</h2>
          <dl className="space-y-1 text-sm">
            <Row label="Original loan">{formatMoney(t.principal_original)}</Row>
            <Row label="Current capital">{formatMoney(t.principal_current)}</Row>
            <Row label="Interest period from">{t.cycle_start_date}</Row>
            <Row label="Maturity">{t.maturity_date} ({t.valid_months} mo)</Row>
            <Row label="Rate">{Number(t.monthly_interest_rate)}% / month</Row>
            <Row label="Article value">{formatMoney(t.assessed_value)}</Row>
          </dl>
        </Card>
      </div>

      <Card>
        <h2 className="px-4 pt-4 text-sm font-semibold">Articles ({t.items?.length}) · {Number(t.net_weight).toFixed(3)} g net</h2>
        <Table className="mt-2">
          <thead><tr><Th>Category</Th><Th>Article</Th><Th>Karat</Th><Th>Condition</Th><Th>Qty</Th><Th className="text-right">Gross g</Th><Th className="text-right">Net g</Th><Th className="text-right">Density</Th><Th className="text-right">Value</Th><Th>Status</Th></tr></thead>
          <tbody>
            {t.items?.map((i) => (
              <tr key={i.id}>
                <Td>{i.category}</Td><Td>{i.article_type ?? i.description}</Td><Td>{i.karat}</Td><Td>{i.condition}</Td><Td>{i.quantity}</Td>
                <Td className="text-right tabular-nums">{Number(i.gross_weight).toFixed(3)}</Td>
                <Td className="text-right tabular-nums">{Number(i.net_weight).toFixed(3)}</Td>
                <Td className="text-right tabular-nums">{i.density_reading != null ? Number(i.density_reading) : <span className="text-muted-foreground">—</span>}</Td>
                <Td className="text-right tabular-nums">{formatMoney(i.assessed_value)}</Td>
                <Td><Badge>{i.status}</Badge></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card>
        <h2 className="px-4 pt-4 text-sm font-semibold">Transactions</h2>
        <Table className="mt-2">
          <thead><tr><Th>Date</Th><Th>No.</Th><Th>Type</Th><Th className="text-right">Days</Th><Th className="text-right">Interest</Th><Th className="text-right">Charges</Th><Th className="text-right">Cash in</Th><Th className="text-right">Cash out</Th><Th className="text-right">Capital after</Th><Th>By</Th><Th /></tr></thead>
          <tbody>
            {t.transactions?.map((x) => (
              <tr key={x.id}>
                <Td className="text-xs whitespace-nowrap">{new Date(x.txn_at).toLocaleString()}</Td>
                <Td className="font-mono text-xs">{x.txn_no}</Td>
                <Td>{txnLabel[x.type] ?? x.type}</Td>
                <Td className="text-right">{x.interest_days || ''}</Td>
                <Td className="text-right tabular-nums">{Number(x.interest_due) ? formatMoney(x.interest_due) : ''}</Td>
                <Td className="text-right tabular-nums">{Number(x.service_charge) + Number(x.postage_charge) + Number(x.stamp_duty) ? formatMoney(Number(x.service_charge) + Number(x.postage_charge) + Number(x.stamp_duty)) : ''}</Td>
                <Td className="text-right tabular-nums text-success">{Number(x.cash_received) ? formatMoney(x.cash_received) : ''}</Td>
                <Td className="text-right tabular-nums text-destructive">{Number(x.cash_paid) ? formatMoney(x.cash_paid) : ''}</Td>
                <Td className="text-right tabular-nums font-medium">{formatMoney(x.principal_after)}</Td>
                <Td className="text-xs">{x.created_by}</Td>
                <Td className="whitespace-nowrap">
                  {x.type !== 'rounding' && (
                    <Button size="sm" variant="ghost" onClick={() => window.open(`/print/transaction/${x.id}`, '_blank')} aria-label="Print receipt"><Printer className="size-3.5" /></Button>
                  )}
                  {can('sms.send') && SMS_SLIP_TYPES.includes(x.type) && (
                    <Button size="sm" variant="ghost" onClick={() => sendSlip(x.id, x.txn_no)} aria-label="Send SMS slip" title="Send SMS slip"><MessageSquare className="size-3.5" /></Button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      {(t.events?.length ?? 0) > 0 && (
        <Card className="p-5">
          <h2 className="mb-2 text-sm font-semibold">History</h2>
          <ol className="space-y-1.5 text-sm">
            {t.events?.map((e, i) => (
              <li key={i} className="flex flex-wrap gap-x-3">
                <span className="w-40 text-xs text-muted-foreground">{new Date(e.at).toLocaleString()}</span>
                <span className="font-medium capitalize">{e.type.replace(/_/g, ' ')}</span>
                <span className="text-muted-foreground">{e.description}{e.user && ` · ${e.user}`}</span>
              </li>
            ))}
          </ol>
        </Card>
      )}

      {active && (
        <>
          <PartPaymentDialog ticket={t} open={dialog === 'part-payment'} onClose={() => setDialog(null)} onDone={done} />
          <RenewalDialog ticket={t} open={dialog === 'renewal'} onClose={() => setDialog(null)} onDone={done} />
          <RedemptionDialog ticket={t} open={dialog === 'redeem'} onClose={() => setDialog(null)} onDone={done} />
          <ReasonDialog
            open={dialog === 'block' || dialog === 'unblock'}
            onClose={() => setDialog(null)}
            title={dialog === 'block' ? 'Block ticket' : 'Unblock ticket'}
            description={dialog === 'block' ? 'A blocked ticket cannot be redeemed or renewed. Part payments are still allowed.' : 'Allow redemption and renewal again.'}
            confirmLabel={dialog === 'block' ? 'Block' : 'Unblock'}
            danger={dialog === 'block'}
            onConfirm={async (reason) => {
              try {
                await api.put(`/api/v1/pawn-tickets/${t.id}/block`, { blocked: dialog === 'block', reason })
                toast.success(dialog === 'block' ? 'Ticket blocked' : 'Ticket unblocked')
                setDialog(null)
                refresh()
              } catch (e) { toast.error(errorMessage(e)) }
            }}
          />
          <ReasonDialog
            open={dialog === 'cancel'}
            onClose={() => setDialog(null)}
            title="Cancel ticket"
            description="Only for a pawn entered in error today. The cash entry is reversed and the ticket is kept as cancelled."
            confirmLabel="Cancel ticket"
            danger
            onConfirm={async (reason) => {
              try {
                await api.post(`/api/v1/pawn-tickets/${t.id}/cancel`, { reason })
                toast.success('Ticket cancelled')
                setDialog(null)
                refresh()
                navigate(`/pawning/tickets/${t.id}`)
              } catch (e) { toast.error(errorMessage(e)) }
            }}
          />
        </>
      )}
    </div>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right tabular-nums">{children}</dd>
    </div>
  )
}
