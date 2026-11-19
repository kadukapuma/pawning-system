import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, ClipboardCheck, ScanBarcode } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Badge, Button, Card, EmptyState, Input, PageHeader, Spinner, Table, Td, Th } from '@/components/ui'
import { api, errorMessage } from '@/lib/api'
import { cn, formatMoney } from '@/lib/utils'

type Summary = {
  session: { id: number; status: string; started_at: string; completed_at: string | null; notes: string | null }
  checked_count: number
  missing_count: number
  checked: { id: number; receipt_no: string; stock_no: string; checked_at: string; checked_by: string | null }[]
  missing: { id: number; receipt_no: string; stock_no: string; customer: string | null; principal_current: string; pawn_date: string; net_weight: string }[]
}
type Overview = {
  current: Summary | null
  history: { id: number; started_at: string; completed_at: string | null; status: string; checked_count: number; started_by_name: string | null }[]
  active_tickets: number
}

/** Vault audit: scan every packet; whatever is active but not scanned is missing. */
export function StockCheckPage() {
  const qc = useQueryClient()
  const [code, setCode] = useState('')
  const [last, setLast] = useState<{ text: string; ok: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [viewing, setViewing] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const data = useQuery({ queryKey: ['stock-check'], queryFn: async () => (await api.get<{ data: Overview }>('/api/v1/stock-checks')).data.data })
  const past = useQuery({
    queryKey: ['stock-check', viewing],
    enabled: !!viewing,
    queryFn: async () => (await api.get<{ data: Summary }>(`/api/v1/stock-checks/${viewing}`)).data.data,
  })
  const cur = data.data?.current
  const refresh = () => qc.invalidateQueries({ queryKey: ['stock-check'] })

  const start = async () => {
    setBusy(true)
    try { await api.post('/api/v1/stock-checks', {}); refresh(); setTimeout(() => inputRef.current?.focus(), 200) } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  const scan = async () => {
    if (!cur || !code.trim()) return
    try {
      const r = await api.post<{ data: { ticket: { receipt_no: string; stock_no: string; customer: string | null }; already_checked: boolean } }>(`/api/v1/stock-checks/${cur.session.id}/scan`, { code })
      const t = r.data.data.ticket
      setLast({ ok: true, text: `${r.data.data.already_checked ? 'Already checked' : 'Checked'}: stock ${t.stock_no} · receipt ${t.receipt_no} · ${t.customer ?? ''}` })
      refresh()
    } catch (e) {
      setLast({ ok: false, text: errorMessage(e) })
    } finally {
      setCode('')
      inputRef.current?.focus()
    }
  }
  const complete = async () => {
    setBusy(true)
    try { await api.post(`/api/v1/stock-checks/${cur!.session.id}/complete`); toast.success('Stock check completed'); setViewing(cur!.session.id); refresh() } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  const shown = cur ?? past.data
  return (
    <div className="space-y-4">
      <PageHeader
        title="Vault stock check"
        description="Scan or type the stock number on every packet in the safe. When you finish, any active ticket not scanned is listed as missing."
        actions={!cur ? <Button loading={busy} onClick={start}><ClipboardCheck className="size-4" /> Start stock check</Button>
          : <Button variant="accent" loading={busy} onClick={complete}><CheckCircle2 className="size-4" /> Complete check</Button>}
      />
      {!data.data ? <Spinner /> : (
        <>
          {cur && (
            <Card className="p-4">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <ScanBarcode className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
                  <Input ref={inputRef} autoFocus value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), scan())} placeholder="Stock or receipt number, then Enter" className="pl-9 text-lg" />
                </div>
                <Button onClick={scan}>Check</Button>
              </div>
              {last && <p className={cn('mt-2 text-sm', last.ok ? 'text-success' : 'text-destructive')}>{last.text}</p>}
              <div className="mt-3 h-2 rounded-full bg-secondary">
                <div className="h-2 rounded-full bg-success" style={{ width: `${(cur.checked_count / Math.max(1, data.data.active_tickets)) * 100}%` }} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{cur.checked_count} of {data.data.active_tickets} active packets checked</p>
            </Card>
          )}

          {shown && (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <h2 className="px-4 pt-4 text-sm font-semibold">Not yet found ({shown.missing_count}) {shown.session.status === 'completed' && shown.missing_count > 0 && <Badge tone="danger">missing</Badge>}</h2>
                {shown.missing.length === 0 ? <EmptyState title="Every active packet is accounted for" /> : (
                  <div className="max-h-[420px] overflow-y-auto">
                    <Table className="mt-2">
                      <thead><tr><Th>Stock</Th><Th>Receipt</Th><Th>Customer</Th><Th className="text-right">Capital</Th></tr></thead>
                      <tbody>{shown.missing.map((m) => (
                        <tr key={m.id}><Td className="font-mono">{m.stock_no}</Td><Td><Link to={`/pawning/tickets/${m.id}`} className="text-primary hover:underline">{m.receipt_no}</Link></Td><Td>{m.customer}</Td><Td className="text-right tabular-nums">{formatMoney(m.principal_current)}</Td></tr>
                      ))}</tbody>
                    </Table>
                  </div>
                )}
              </Card>
              <Card>
                <h2 className="px-4 pt-4 text-sm font-semibold">Checked ({shown.checked_count})</h2>
                <div className="max-h-[420px] overflow-y-auto">
                  <Table className="mt-2">
                    <thead><tr><Th>Stock</Th><Th>Receipt</Th><Th>Time</Th><Th>By</Th></tr></thead>
                    <tbody>{shown.checked.map((c) => (
                      <tr key={c.id}><Td className="font-mono">{c.stock_no}</Td><Td>{c.receipt_no}</Td><Td className="text-xs">{new Date(c.checked_at).toLocaleTimeString()}</Td><Td className="text-xs">{c.checked_by}</Td></tr>
                    ))}</tbody>
                  </Table>
                </div>
              </Card>
            </div>
          )}

          <Card>
            <h2 className="px-4 pt-4 text-sm font-semibold">Previous checks</h2>
            {data.data.history.length === 0 ? <EmptyState title="No stock checks yet" /> : (
              <Table className="mt-2">
                <thead><tr><Th>Started</Th><Th>Completed</Th><Th>By</Th><Th className="text-right">Checked</Th><Th>Status</Th><Th /></tr></thead>
                <tbody>{data.data.history.map((h) => (
                  <tr key={h.id}>
                    <Td className="text-xs">{new Date(h.started_at).toLocaleString()}</Td>
                    <Td className="text-xs">{h.completed_at && new Date(h.completed_at).toLocaleString()}</Td>
                    <Td>{h.started_by_name}</Td>
                    <Td className="text-right">{h.checked_count}</Td>
                    <Td><Badge tone={h.status === 'completed' ? 'success' : 'warning'}>{h.status}</Badge></Td>
                    <Td>{h.status === 'completed' && <Button size="sm" variant="ghost" onClick={() => setViewing(h.id)}>View</Button>}</Td>
                  </tr>
                ))}</tbody>
              </Table>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
