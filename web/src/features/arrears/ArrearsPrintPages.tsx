import { useQuery } from '@tanstack/react-query'
import { Printer } from 'lucide-react'
import { useEffect } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { Button, Spinner } from '@/components/ui'
import { RequireAuth } from '@/features/auth/RequireAuth'
import { api } from '@/lib/api'
import { formatMoney } from '@/lib/utils'

type Company = { name: string; address: string | null; phone: string | null }

type LetterData = {
  id: number
  letter_no: number
  issued_at: string
  ticket: { receipt_no: string; stock_no: string; pawn_date: string; maturity_date: string }
  branch: { code: string; name: string; address: string | null; phone: string | null }
  customer: { name: string; address: string[] }
  capital: string
  interest: string
  service_charge: string
  letter_charge: string
  arrears: string
  total: string
}

const ordinal = ['', 'FIRST', 'SECOND', 'THIRD']

function Toolbar() {
  return (
    <div className="no-print flex justify-end gap-2 border-b p-3">
      <Button onClick={() => window.print()}><Printer className="size-4" /> Print</Button>
      <Button variant="secondary" onClick={() => window.close()}>Close</Button>
    </div>
  )
}

/**
 * Arrears letters, one per A5 page. Plain layout for blank paper; the old
 * trilingual pre-printed stationery alignment is a separate follow-up.
 */
export function LettersPrintPage() {
  const [params] = useSearchParams()
  const ids = (params.get('ids') ?? '').split(',').map(Number).filter(Boolean)
  const reprint = params.get('reprint') === '1'

  const data = useQuery({
    queryKey: ['letters-print', ids.join(','), reprint],
    queryFn: async () => (await api.post<{ data: { company: Company; letters: LetterData[] } }>('/api/v1/arrears/letters/print', { letter_ids: ids, reprint })).data.data,
    staleTime: Infinity,
    refetchOnMount: false,
  })
  useEffect(() => { if (data.data) setTimeout(() => window.print(), 300) }, [data.data])

  return (
    <RequireAuth>
      <div className="min-h-screen bg-white text-black">
        <style>{'@page { size: A5; margin: 12mm } @media print { .no-print { display: none } .letter { break-after: page } }'}</style>
        <Toolbar />
        {!data.data ? <div className="p-6"><Spinner /></div> : data.data.letters.map((l) => (
          <div key={l.id} className="letter mx-auto max-w-[148mm] p-6 text-[12px] leading-relaxed">
            <div className="mb-4 border-b-2 border-black pb-2 text-center">
              <p className="text-base font-bold uppercase">{data.data.company.name}</p>
              <p>{l.branch.name} branch · {l.branch.address} · {l.branch.phone}</p>
            </div>
            <p className="text-right">{l.issued_at}</p>
            <div className="my-3">
              <p className="font-semibold">{l.customer.name}</p>
              {l.customer.address.map((a, i) => <p key={i}>{a}</p>)}
            </div>
            <p className="mb-2 text-center font-bold underline">{ordinal[l.letter_no]} NOTICE OF ARREARS — PAWN RECEIPT {l.ticket.receipt_no}</p>
            <p>
              Dear customer, the pawn loan on receipt <b>{l.ticket.receipt_no}</b> (stock {l.ticket.stock_no}) dated {l.ticket.pawn_date} matured on <b>{l.ticket.maturity_date}</b>.
              Please settle the arrears below, or redeem your articles, at your earliest convenience.
            </p>
            <table className="my-3 w-full">
              <tbody>
                <tr><td>Capital</td><td className="text-right">{formatMoney(l.capital)}</td></tr>
                <tr><td>Interest</td><td className="text-right">{formatMoney(l.interest)}</td></tr>
                <tr><td>Service charge</td><td className="text-right">{formatMoney(l.service_charge)}</td></tr>
                <tr><td>Letter / postage charges</td><td className="text-right">{formatMoney(l.letter_charge)}</td></tr>
                <tr className="border-t border-black font-semibold"><td>Arrears (to keep the loan)</td><td className="text-right">{formatMoney(l.arrears)}</td></tr>
                <tr className="font-bold"><td>Total to redeem</td><td className="text-right">{formatMoney(l.total)}</td></tr>
              </tbody>
            </table>
            {l.letter_no === 3 && (
              <p className="font-semibold">This is the final notice. If the arrears are not settled, the pledged articles may be forfeited without further notice.</p>
            )}
            <p className="mt-8">Branch Manager</p>
          </div>
        ))}
      </div>
    </RequireAuth>
  )
}

type BatchData = {
  company: Company
  batch: { batch_no: string; transferred_at: string; user: string | null; notes: string | null }
  items: { item_code: string; receipt_no: string | null; category: string | null; article_type: string | null; karat: string | null; quantity: number; net_weight: string; cost_price: string; sale_price: string }[]
}

export function TransferPrintPage() {
  const { id } = useParams()
  const data = useQuery({ queryKey: ['transfer-batch', id], queryFn: async () => (await api.get<{ data: BatchData }>(`/api/v1/stock-transfer-batches/${id}`)).data.data })
  useEffect(() => { if (data.data) setTimeout(() => window.print(), 300) }, [data.data])
  const d = data.data

  return (
    <RequireAuth>
      <div className="min-h-screen bg-white text-black">
        <style>{'@page { size: A4; margin: 12mm } @media print { .no-print { display: none } }'}</style>
        <Toolbar />
        {!d ? <div className="p-6"><Spinner /></div> : (
          <div className="mx-auto max-w-[190mm] p-6 text-[12px]">
            <div className="mb-3 border-b-2 border-black pb-2 text-center">
              <p className="text-base font-bold uppercase">{d.company.name}</p>
              <p className="font-semibold">FORFEITED ARTICLES — TRANSFER TO SALE STOCK</p>
              <p>Batch {d.batch.batch_no} · {new Date(d.batch.transferred_at).toLocaleString()} · by {d.batch.user}</p>
            </div>
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-y border-black text-left"><th>Item code</th><th>Receipt</th><th>Article</th><th>Karat</th><th>Qty</th><th className="text-right">Net g</th><th className="text-right">Cost</th><th className="text-right">Sale price</th></tr>
              </thead>
              <tbody>
                {d.items.map((i) => (
                  <tr key={i.item_code} className="border-b">
                    <td className="font-mono">{i.item_code}</td><td>{i.receipt_no}</td><td>{i.article_type ?? i.category}</td><td>{i.karat}</td><td>{i.quantity}</td>
                    <td className="text-right">{Number(i.net_weight).toFixed(3)}</td><td className="text-right">{Number(i.cost_price).toLocaleString()}</td><td className="text-right">{Number(i.sale_price).toLocaleString()}</td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td colSpan={6}>Total ({d.items.length} items)</td>
                  <td className="text-right">{d.items.reduce((s, i) => s + Number(i.cost_price), 0).toLocaleString()}</td>
                  <td className="text-right">{d.items.reduce((s, i) => s + Number(i.sale_price), 0).toLocaleString()}</td>
                </tr>
              </tbody>
            </table>
            <div className="mt-12 flex justify-between text-center"><div className="w-48 border-t border-dotted border-black pt-1">Transferred by</div><div className="w-48 border-t border-dotted border-black pt-1">Checked by</div></div>
          </div>
        )}
      </div>
    </RequireAuth>
  )
}
