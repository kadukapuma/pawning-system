import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Search, ShoppingCart } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Badge, Button, Card, Dialog, EmptyState, Field, Input, PageHeader, Pagination, Select, Spinner, Table, Td, Th } from '@/components/ui'
import { useAuth } from '@/features/auth/AuthProvider'
import { api, errorMessage } from '@/lib/api'
import { useDebounced, useLookups } from '@/lib/hooks'
import { formatMoney } from '@/lib/utils'

export type StockItem = {
  id: number
  item_code: string
  barcode: string
  status: 'in_stock' | 'sold'
  category: string | null
  article_type: string | null
  karat: string | null
  description: string | null
  quantity: number
  gross_weight: string
  net_weight: string
  cost_price: string
  sale_price: string
  received_at: string | null
  sold_at: string | null
  receipt_no: string | null
}

type StockPage = {
  data: StockItem[]
  meta: { current_page: number; last_page: number; total: number; from: number | null; to: number | null; totals: { items: number; cost: string; sale: string; weight: string } }
}

export function InventoryPage() {
  const { can } = useAuth()
  const navigate = useNavigate()
  const { data: lookups } = useLookups()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('in_stock')
  const [category, setCategory] = useState('')
  const [page, setPage] = useState(1)
  const [pricing, setPricing] = useState<StockItem | null>(null)
  const search = useDebounced(q)

  const list = useQuery({
    queryKey: ['inventory', { search, status, category, page }],
    queryFn: async () => (await api.get<StockPage>('/api/v1/inventory', { params: { q: search || undefined, status, category_id: category || undefined, page } })).data,
    placeholderData: keepPreviousData,
  })
  const t = list.data?.meta.totals

  return (
    <div>
      <PageHeader
        title="Sale stock"
        description="Forfeited articles available for sale. Cost = forfeited capital; sale price = karat sale rate at transfer (managers can re-price)."
        actions={can('sales.create') && <Button onClick={() => navigate('/sales/new')}><ShoppingCart className="size-4" /> New sale</Button>}
      />

      {t && (
        <div className="mb-4 grid gap-3 sm:grid-cols-4">
          <Card className="p-4"><p className="text-xs text-muted-foreground">Items</p><p className="text-lg font-semibold">{t.items}</p></Card>
          <Card className="p-4"><p className="text-xs text-muted-foreground">Net weight</p><p className="text-lg font-semibold">{Number(t.weight).toFixed(3)} g</p></Card>
          <Card className="p-4"><p className="text-xs text-muted-foreground">Cost</p><p className="text-lg font-semibold">{formatMoney(t.cost)}</p></Card>
          <Card className="p-4"><p className="text-xs text-muted-foreground">Sale value</p><p className="text-lg font-semibold">{formatMoney(t.sale)}</p></Card>
        </div>
      )}

      <Card>
        <div className="flex flex-wrap gap-2 border-b p-3">
          <div className="relative min-w-60 flex-1">
            <Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
            <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} placeholder="Item code, barcode or description…" className="pl-9" />
          </div>
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }} className="w-36">
            <option value="in_stock">In stock</option>
            <option value="sold">Sold</option>
          </Select>
          <Select value={category} onChange={(e) => { setCategory(e.target.value); setPage(1) }} className="w-44">
            <option value="">All categories</option>
            {lookups?.article_categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </div>
        {list.isPending ? <div className="grid place-items-center py-14"><Spinner /></div> : list.data?.data.length === 0 ? <EmptyState title="No items" /> : (
          <Table>
            <thead>
              <tr><Th>Code</Th><Th>Article</Th><Th>Karat</Th><Th className="text-right">Net g</Th><Th>From ticket</Th><Th className="text-right">Cost</Th><Th className="text-right">Sale price</Th><Th>Status</Th><Th /></tr>
            </thead>
            <tbody>
              {list.data?.data.map((i) => (
                <tr key={i.id}>
                  <Td className="font-mono text-xs">{i.item_code}</Td>
                  <Td>{i.article_type ?? i.category}{i.quantity > 1 && ` × ${i.quantity}`}</Td>
                  <Td>{i.karat}</Td>
                  <Td className="text-right tabular-nums">{Number(i.net_weight).toFixed(3)}</Td>
                  <Td className="font-mono text-xs">{i.receipt_no}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(i.cost_price)}</Td>
                  <Td className="text-right tabular-nums font-medium">{formatMoney(i.sale_price)}</Td>
                  <Td><Badge tone={i.status === 'in_stock' ? 'success' : 'neutral'}>{i.status.replace('_', ' ')}</Badge></Td>
                  <Td>{i.status === 'in_stock' && can('sales.void') && <Button size="sm" variant="ghost" onClick={() => setPricing(i)} aria-label="Change price"><Pencil className="size-4" /></Button>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pagination meta={list.data?.meta} onPage={setPage} />
      </Card>
      <PriceDialog item={pricing} onClose={() => setPricing(null)} />
    </div>
  )
}

function PriceDialog({ item, onClose }: { item: StockItem | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [price, setPrice] = useState('')
  const [saving, setSaving] = useState(false)
  const save = async () => {
    setSaving(true)
    try {
      await api.put(`/api/v1/inventory/${item!.id}/price`, { sale_price: price })
      toast.success('Price updated')
      qc.invalidateQueries({ queryKey: ['inventory'] })
      onClose()
    } catch (e) { toast.error(errorMessage(e)) } finally { setSaving(false) }
  }
  return (
    <Dialog
      open={!!item}
      onClose={onClose}
      size="sm"
      title={`Sale price — ${item?.item_code ?? ''}`}
      description={item ? `Cost ${formatMoney(item.cost_price)}. Current price ${formatMoney(item.sale_price)}.` : undefined}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={saving} disabled={!Number(price)} onClick={save}>Save</Button></>}
    >
      <Field label="New sale price (Rs.)">
        <Input type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} autoFocus />
      </Field>
      {item && Number(price) > 0 && Number(price) < Number(item.cost_price) && <p className="mt-2 text-sm text-destructive">Below cost — this sale will make a loss.</p>}
    </Dialog>
  )
}
