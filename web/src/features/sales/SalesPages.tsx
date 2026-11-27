import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, Plus, Printer, ScanBarcode, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, Pagination, Spinner, Table, Td, Th } from '@/components/ui'
import { useAuth } from '@/features/auth/AuthProvider'
import { RequireAuth } from '@/features/auth/RequireAuth'
import { ReasonDialog } from '@/features/pawning/ActionDialogs'
import { api, errorMessage } from '@/lib/api'
import { useDebounced } from '@/lib/hooks'
import type { Paginated } from '@/lib/types'
import { formatMoney } from '@/lib/utils'
import type { StockItem } from './InventoryPage'
import { openPrintPreview, useAutoPrint } from '@/lib/print'

type Invoice = {
  id: number
  invoice_no: string
  invoice_date: string
  customer_name: string | null
  customer_phone: string | null
  gross_amount: string
  discount: string
  net_amount: string
  paid_cash: string
  paid_card: string
  status: 'completed' | 'voided'
  void_reason: string | null
  lines_count?: number
  creator?: { name: string } | null
}

/* ================================================================ Invoice list */

export function SalesListPage() {
  const { can } = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const [from, setFrom] = useState(new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10))
  const [page, setPage] = useState(1)
  const [voiding, setVoiding] = useState<Invoice | null>(null)
  const search = useDebounced(q)

  const list = useQuery({
    queryKey: ['sales', { search, from, page }],
    queryFn: async () => (await api.get<Paginated<Invoice>>('/api/v1/sales', { params: { q: search || undefined, from, page } })).data,
    placeholderData: keepPreviousData,
  })

  return (
    <div>
      <PageHeader
        title="Sales invoices"
        description="Sales of forfeited articles. Voiding reverses the accounts and returns the articles to stock."
        actions={<Button onClick={() => navigate('/sales/new')}><Plus className="size-4" /> New sale</Button>}
      />
      <Card>
        <div className="flex flex-wrap gap-2 border-b p-3">
          <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} placeholder="Invoice no or customer…" className="max-w-xs" />
          <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1) }} className="w-40" aria-label="From date" />
        </div>
        {list.isPending ? <div className="grid place-items-center py-14"><Spinner /></div> : list.data?.data.length === 0 ? <EmptyState title="No sales in this period" /> : (
          <Table>
            <thead><tr><Th>Invoice</Th><Th>Date</Th><Th>Customer</Th><Th className="text-right">Items</Th><Th className="text-right">Total</Th><Th>Paid</Th><Th>Status</Th><Th /></tr></thead>
            <tbody>
              {list.data?.data.map((i) => (
                <tr key={i.id} className={i.status === 'voided' ? 'opacity-60' : ''}>
                  <Td className="font-mono">{i.invoice_no}</Td>
                  <Td className="text-xs">{new Date(i.invoice_date).toLocaleString()}</Td>
                  <Td>{i.customer_name ?? '—'}</Td>
                  <Td className="text-right">{i.lines_count}</Td>
                  <Td className="text-right tabular-nums font-medium">{formatMoney(i.net_amount)}</Td>
                  <Td className="text-xs">{Number(i.paid_cash) > 0 && `Cash ${Number(i.paid_cash).toLocaleString()} `}{Number(i.paid_card) > 0 && `Card ${Number(i.paid_card).toLocaleString()}`}</Td>
                  <Td><Badge tone={i.status === 'completed' ? 'success' : 'danger'}>{i.status}</Badge></Td>
                  <Td className="text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" onClick={() => openPrintPreview(`/print/invoice/${i.id}`, 'Sales invoice')} aria-label="Print"><Printer className="size-4" /></Button>
                    {i.status === 'completed' && can('sales.void') && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setVoiding(i)} aria-label="Void"><Ban className="size-4" /></Button>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pagination meta={list.data?.meta} onPage={setPage} />
      </Card>
      <ReasonDialog
        open={!!voiding}
        onClose={() => setVoiding(null)}
        title={`Void ${voiding?.invoice_no ?? ''}`}
        description="The sale is reversed in the accounts and the articles go back into stock."
        confirmLabel="Void invoice"
        danger
        onConfirm={async (reason) => {
          try {
            await api.post(`/api/v1/sales/${voiding!.id}/void`, { reason })
            toast.success('Invoice voided')
            setVoiding(null)
            qc.invalidateQueries({ queryKey: ['sales'] })
            qc.invalidateQueries({ queryKey: ['inventory'] })
          } catch (e) { toast.error(errorMessage(e)) }
        }}
      />
    </div>
  )
}

/* ================================================================ New sale */

type CartLine = { item: StockItem; unit_price: string; discount: string }

export function NewSalePage() {
  const { can } = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [code, setCode] = useState('')
  const [cart, setCart] = useState<CartLine[]>([])
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [card, setCard] = useState('')
  const [saving, setSaving] = useState(false)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const codeRef = useRef<HTMLInputElement>(null)

  const total = useMemo(() => cart.reduce((s, l) => s + Number(l.unit_price || 0) - Number(l.discount || 0), 0), [cart])
  const cash = Math.max(0, total - Number(card || 0))
  useEffect(() => { codeRef.current?.focus() }, [cart.length])

  const add = async () => {
    const c = code.trim()
    if (!c) return
    setLookupError(null)
    try {
      const r = await api.get<{ data: StockItem }>(`/api/v1/inventory/code/${encodeURIComponent(c)}`)
      const item = r.data.data
      if (item.status !== 'in_stock') setLookupError(`${item.item_code} is already sold.`)
      else if (cart.some((l) => l.item.id === item.id)) setLookupError(`${item.item_code} is already in the sale.`)
      else setCart((x) => [...x, { item, unit_price: item.sale_price, discount: '' }])
      setCode('')
    } catch (e) {
      setLookupError((e as { response?: { status?: number } }).response?.status === 404 ? `No item "${c}" in this branch.` : errorMessage(e))
    }
  }

  const save = async () => {
    setSaving(true)
    try {
      const r = await api.post<{ data: { id: number; invoice_no: string } }>('/api/v1/sales', {
        lines: cart.map((l) => ({ inventory_item_id: l.item.id, unit_price: l.unit_price, discount: l.discount || 0 })),
        customer_name: customerName || null,
        customer_phone: customerPhone || null,
        paid_cash: cash.toFixed(2),
        paid_card: Number(card || 0).toFixed(2),
      })
      toast.success(`Invoice ${r.data.data.invoice_no} saved`)
      qc.invalidateQueries({ queryKey: ['inventory'] })
      qc.invalidateQueries({ queryKey: ['sales'] })
      openPrintPreview(`/print/invoice/${r.data.data.id}`, 'Sales invoice')
      navigate('/sales')
    } catch (e) { toast.error(errorMessage(e)) } finally { setSaving(false) }
  }

  const update = (id: number, patch: Partial<CartLine>) => setCart((x) => x.map((l) => (l.item.id === id ? { ...l, ...patch } : l)))

  return (
    <div className="space-y-5">
      <PageHeader title="New sale" description="Scan or type the item code. Each item is sold whole and only once." />
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="space-y-3">
          <Card className="p-3">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <ScanBarcode className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
                <Input ref={codeRef} value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())} placeholder="Item code or barcode, then Enter" className="pl-9" />
              </div>
              <Button variant="secondary" onClick={add}>Add</Button>
            </div>
            {lookupError && <p className="mt-2 text-sm text-destructive">{lookupError}</p>}
          </Card>
          <Card>
            {cart.length === 0 ? <EmptyState title="No items yet" /> : (
              <Table>
                <thead><tr><Th>Code</Th><Th>Article</Th><Th className="text-right">Net g</Th><Th className="text-right">Cost</Th><Th className="w-36">Price</Th>{can('pawn.discount') && <Th className="w-28">Discount</Th>}<Th className="text-right">Line</Th><Th /></tr></thead>
                <tbody>
                  {cart.map((l) => (
                    <tr key={l.item.id}>
                      <Td className="font-mono text-xs">{l.item.item_code}</Td>
                      <Td>{l.item.article_type ?? l.item.category} · {l.item.karat}</Td>
                      <Td className="text-right tabular-nums">{Number(l.item.net_weight).toFixed(3)}</Td>
                      <Td className="text-right tabular-nums text-muted-foreground">{Number(l.item.cost_price).toLocaleString()}</Td>
                      <Td><Input type="number" min={0} value={l.unit_price} onChange={(e) => update(l.item.id, { unit_price: e.target.value })} /></Td>
                      {can('pawn.discount') && <Td><Input type="number" min={0} value={l.discount} onChange={(e) => update(l.item.id, { discount: e.target.value })} /></Td>}
                      <Td className="text-right tabular-nums">{formatMoney(Number(l.unit_price || 0) - Number(l.discount || 0))}</Td>
                      <Td><Button size="sm" variant="ghost" onClick={() => setCart((x) => x.filter((y) => y.item.id !== l.item.id))} aria-label="Remove"><Trash2 className="size-4" /></Button></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
        <Card className="h-fit space-y-4 p-4">
          <Field label="Customer name"><Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Walk-in" /></Field>
          <Field label="Customer phone"><Input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} /></Field>
          <div className="flex items-baseline justify-between border-t pt-3"><span className="text-sm text-muted-foreground">Total</span><span className="text-2xl font-semibold tabular-nums">{formatMoney(total)}</span></div>
          <Field label="Paid by card (Rs.)" hint="The rest is cash."><Input type="number" min={0} max={total} value={card} onChange={(e) => setCard(e.target.value)} /></Field>
          <div className="flex justify-between text-sm"><span className="text-muted-foreground">Cash</span><span className="tabular-nums">{formatMoney(cash)}</span></div>
          <Button variant="accent" className="w-full" disabled={cart.length === 0 || total <= 0 || Number(card || 0) > total} loading={saving} onClick={save}>
            Complete sale & print
          </Button>
        </Card>
      </div>
    </div>
  )
}

/* ================================================================ Invoice print */

type InvoiceDetail = {
  invoice: Invoice & {
    branch: { code: string; name: string; address: string | null; phone: string | null }
    lines: { id: number; unit_price: string; discount: string; line_total: string; item: { item_code: string; net_weight: string; quantity: number; category?: { name: string }; article_type?: { name: string } | null; karat?: { name: string } } }[]
  }
  company: { name: string; phone: string | null; receipt_footer: string | null }
}

export function InvoicePrintPage() {
  const { id } = useParams()
  const data = useQuery({ queryKey: ['sale', id], queryFn: async () => (await api.get<{ data: InvoiceDetail }>(`/api/v1/sales/${id}`)).data.data })
  useAutoPrint(!!data.data)
  const d = data.data

  return (
    <RequireAuth>
      <div className="min-h-screen bg-white text-black">
        <style>{'@page { size: A5; margin: 10mm } @media print { .no-print { display: none } }'}</style>
        <div className="no-print flex justify-end gap-2 border-b p-3">
          <Button onClick={() => window.print()}><Printer className="size-4" /> Print</Button>
          <Button variant="secondary" onClick={() => window.close()}>Close</Button>
        </div>
        {!d ? <div className="p-6"><Spinner /></div> : (
          <div className="mx-auto max-w-[148mm] p-6 text-[12px]">
            <div className="mb-3 border-b-2 border-black pb-2 text-center">
              <p className="text-base font-bold uppercase">{d.company.name}</p>
              <p>{d.invoice.branch.name} branch · {d.invoice.branch.phone}</p>
              <p className="mt-1 font-semibold">SALES INVOICE {d.invoice.status === 'voided' && '— VOID'}</p>
              <p className="font-mono">{d.invoice.invoice_no} · {new Date(d.invoice.invoice_date).toLocaleString()}</p>
            </div>
            {d.invoice.customer_name && <p>Customer: {d.invoice.customer_name} {d.invoice.customer_phone && `· ${d.invoice.customer_phone}`}</p>}
            <table className="my-2 w-full">
              <thead><tr className="border-y border-black text-left"><th>Item</th><th>Article</th><th className="text-right">Net g</th><th className="text-right">Amount</th></tr></thead>
              <tbody>
                {d.invoice.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="font-mono">{l.item.item_code}</td>
                    <td>{l.item.article_type?.name ?? l.item.category?.name} · {l.item.karat?.name}</td>
                    <td className="text-right">{Number(l.item.net_weight).toFixed(3)}</td>
                    <td className="text-right">{Number(l.unit_price).toLocaleString(undefined, { minimumFractionDigits: 2 })}{Number(l.discount) > 0 && <div className="text-[10px]">less {Number(l.discount).toLocaleString()}</div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="ml-auto w-56 space-y-0.5">
              <div className="flex justify-between"><span>Gross</span><span>{formatMoney(d.invoice.gross_amount)}</span></div>
              {Number(d.invoice.discount) > 0 && <div className="flex justify-between"><span>Discount</span><span>− {formatMoney(d.invoice.discount)}</span></div>}
              <div className="flex justify-between border-t border-black pt-1 font-bold"><span>Total</span><span>{formatMoney(d.invoice.net_amount)}</span></div>
              {Number(d.invoice.paid_cash) > 0 && <div className="flex justify-between"><span>Cash</span><span>{formatMoney(d.invoice.paid_cash)}</span></div>}
              {Number(d.invoice.paid_card) > 0 && <div className="flex justify-between"><span>Card</span><span>{formatMoney(d.invoice.paid_card)}</span></div>}
            </div>
            {d.company.receipt_footer && <p className="mt-4 text-[10px]">{d.company.receipt_footer}</p>}
            <p className="mt-8 text-[10px]">Cashier: {d.invoice.creator?.name}</p>
          </div>
        )}
      </div>
    </RequireAuth>
  )
}
