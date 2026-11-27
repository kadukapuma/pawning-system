import { useQuery } from '@tanstack/react-query'
import { Printer } from 'lucide-react'
import { type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { Button, Spinner } from '@/components/ui'
import { RequireAuth } from '@/features/auth/RequireAuth'
import { api } from '@/lib/api'
import { useAutoPrint } from '@/lib/print'
import { formatMoney } from '@/lib/utils'
import { txnLabel, type PawnTicket, type TicketTxn } from './types'

type Company = { name: string; address: string | null; phone: string | null; email: string | null; receipt_footer: string | null }

/**
 * Plain A5 print layouts (browser print). Exact positioning for the old
 * pre-printed stationery can be added later; these print on blank paper.
 */
function Sheet({ children, ready }: { children: ReactNode; ready: boolean }) {
  useAutoPrint(ready)

  return (
    <div className="min-h-screen bg-white text-black print:bg-white">
      <style>{'@page { size: A5; margin: 10mm } @media print { .no-print { display: none } }'}</style>
      <div className="no-print flex justify-end gap-2 border-b p-3">
        <Button onClick={() => window.print()}><Printer className="size-4" /> Print</Button>
        <Button variant="secondary" onClick={() => window.close()}>Close</Button>
      </div>
      <div className="mx-auto max-w-[148mm] p-6 text-[12px] leading-snug">{ready ? children : <Spinner />}</div>
    </div>
  )
}

function Header({ company, branch, title, no }: { company?: Company; branch?: PawnTicket['branch']; title: string; no: string }) {
  return (
    <div className="mb-3 border-b-2 border-black pb-2 text-center">
      <p className="text-base font-bold uppercase">{company?.name}</p>
      <p>{branch ? `${branch.name} branch` : ''}{company?.phone && ` · Tel ${company.phone}`}</p>
      <p className="mt-1 text-sm font-semibold">{title}</p>
      <p className="font-mono text-sm">{no}</p>
    </div>
  )
}

function KV({ k, v, bold }: { k: string; v: ReactNode; bold?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${bold ? 'border-t border-black pt-1 text-[13px] font-bold' : ''}`}>
      <span>{k}</span>
      <span className="text-right tabular-nums">{v}</span>
    </div>
  )
}

function Articles({ t }: { t: PawnTicket }) {
  return (
    <table className="my-2 w-full border-collapse text-[11px]">
      <thead>
        <tr className="border-y border-black text-left"><th>Article</th><th>Karat</th><th>Qty</th><th className="text-right">Net g</th><th className="text-right">Value</th></tr>
      </thead>
      <tbody>
        {t.items?.map((i) => (
          <tr key={i.id}>
            <td>{i.article_type ?? i.category}{i.condition && ` (${i.condition})`}</td><td>{i.karat}</td><td>{i.quantity}</td>
            <td className="text-right">{Number(i.net_weight).toFixed(3)}</td><td className="text-right">{Number(i.assessed_value).toLocaleString()}</td>
          </tr>
        ))}
        <tr className="border-t border-black font-semibold">
          <td colSpan={3}>Total</td><td className="text-right">{Number(t.net_weight).toFixed(3)}</td><td className="text-right">{Number(t.assessed_value).toLocaleString()}</td>
        </tr>
      </tbody>
    </table>
  )
}

function Signatures({ labels }: { labels: string[] }) {
  return (
    <div className="mt-10 flex justify-between gap-4 text-center text-[11px]">
      {labels.map((l) => <div key={l} className="flex-1 border-t border-dotted border-black pt-1">{l}</div>)}
    </div>
  )
}

function useCompany() {
  return useQuery({ queryKey: ['company'], queryFn: async () => (await api.get<{ data: Company }>('/api/v1/company')).data.data })
}

export function TicketPrintPage() {
  const { id } = useParams()
  const company = useCompany()
  const ticket = useQuery({ queryKey: ['ticket', id], queryFn: async () => (await api.get<{ data: PawnTicket }>(`/api/v1/pawn-tickets/${id}`)).data.data })
  const t = ticket.data
  const v = t?.scheme_version

  return (
    <RequireAuth>
      <Sheet ready={!!t && !!company.data}>
        {t && (
          <>
            <Header company={company.data} branch={t.branch} title="PAWN TICKET" no={`Receipt ${t.receipt_no} · Stock ${t.stock_no}`} />
            <KV k="Customer" v={[t.customer?.title, t.customer?.full_name].filter(Boolean).join(' ')} />
            <KV k="NIC / Phone" v={`${t.customer?.nic} · ${t.customer?.phone1}`} />
            <KV k="Address" v={t.customer?.address} />
            <Articles t={t} />
            <KV k="Pawn date" v={t.pawn_date} />
            <KV k="Term / maturity" v={`${t.valid_months} month(s) · ${t.maturity_date}`} />
            <KV k="Scheme" v={t.scheme?.code} />
            {v && <KV k="Interest" v={`${Number(v.rate1)}% up to ${v.period1_days} days, ${Number(v.rate2)}% up to ${v.period2_days} days, then ${Number(v.rate3)}% per month`} />}
            <KV k="Loan amount" v={formatMoney(t.principal_original)} bold />
            {company.data?.receipt_footer && <p className="mt-3 text-[10px]">{company.data.receipt_footer}</p>}
            <Signatures labels={['Customer', 'Valuer', 'Authorised officer']} />
          </>
        )}
      </Sheet>
    </RequireAuth>
  )
}

export function TransactionPrintPage() {
  const { id } = useParams()
  const data = useQuery({
    queryKey: ['pawn-transaction', id],
    queryFn: async () => (await api.get<{ data: { transaction: TicketTxn & { creator?: { name: string } }; ticket: PawnTicket; company: Company } }>(`/api/v1/pawn-transactions/${id}`)).data.data,
  })
  const d = data.data
  const x = d?.transaction
  const t = d?.ticket
  const n = (v?: string) => Number(v ?? 0)

  return (
    <RequireAuth>
      <Sheet ready={!!d}>
        {x && t && (
          <>
            <Header company={d.company} branch={t.branch} title={`${txnLabel[x.type] ?? x.type} receipt`.toUpperCase()} no={`${x.txn_no} · Ticket ${t.receipt_no}`} />
            <KV k="Date" v={new Date(x.txn_at).toLocaleString()} />
            <KV k="Customer" v={`${t.customer?.full_name} (${t.customer?.nic})`} />
            {x.type === 'pawn' && <Articles t={t} />}
            <div className="my-2 space-y-0.5">
              {n(x.principal_before) > 0 && <KV k="Capital before" v={formatMoney(x.principal_before)} />}
              {n(x.interest_due) > 0 && <KV k={`Interest (${x.interest_days} days)`} v={formatMoney(x.interest_due)} />}
              {n(x.service_charge) > 0 && <KV k="Service charge" v={formatMoney(x.service_charge)} />}
              {n(x.postage_charge) > 0 && <KV k="Letter postage" v={formatMoney(x.postage_charge)} />}
              {n(x.stamp_duty) > 0 && <KV k="Stamp duty" v={formatMoney(x.stamp_duty)} />}
              {n(x.discount) > 0 && <KV k="Discount" v={`− ${formatMoney(x.discount)}`} />}
              {n(x.interest_paid) > 0 && x.type === 'part_payment' && <KV k="Interest paid" v={formatMoney(x.interest_paid)} />}
              {n(x.principal_paid) > 0 && <KV k="Capital repaid" v={formatMoney(x.principal_paid)} />}
              {n(x.principal_added) > 0 && x.type !== 'pawn' && <KV k="Added to capital" v={formatMoney(x.principal_added)} />}
              {n(x.cash_received) > 0 && <KV k="Cash received" v={formatMoney(x.cash_received)} bold />}
              {n(x.cash_paid) > 0 && <KV k="Cash paid to customer" v={formatMoney(x.cash_paid)} bold />}
              <KV k="Capital now" v={formatMoney(x.principal_after)} bold />
              {x.new_maturity_date && <KV k="Next maturity" v={x.new_maturity_date} />}
            </div>
            {x.remarks && <p className="text-[11px]">Remarks: {x.remarks}</p>}
            <p className="mt-2 text-[10px]">Cashier: {x.creator?.name}</p>
            <Signatures labels={['Customer', 'Cashier']} />
          </>
        )}
      </Sheet>
    </RequireAuth>
  )
}
