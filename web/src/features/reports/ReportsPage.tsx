import { useQuery } from '@tanstack/react-query'
import { Download, FileBarChart, Printer } from 'lucide-react'
import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Button, Card, EmptyState, Input, PageHeader, Spinner, Table, Td, Th } from '@/components/ui'
import { useAuth } from '@/features/auth/AuthProvider'
import { api, errorMessage } from '@/lib/api'
import { cn, formatMoney } from '@/lib/utils'
import { printCurrentPage } from '@/lib/print'

type Column = { key: string; label: string; type: 'text' | 'date' | 'money' | 'weight' | 'int' }
type Report = { report: string; title: string; from: string; to: string; columns: Column[]; rows: Record<string, unknown>[]; totals: Record<string, string | number> }

const today = () => new Date().toISOString().slice(0, 10)
const monthStart = () => today().slice(0, 8) + '01'

function fmt(v: unknown, type: Column['type']) {
  if (v === null || v === undefined || v === '') return ''
  if (type === 'money') return formatMoney(String(v)).replace('Rs. ', '')
  if (type === 'weight') return Number(v).toFixed(3)
  if (type === 'date') return String(v).slice(0, 10)
  return String(v)
}

export function ReportsPage() {
  const { report } = useParams()
  const navigate = useNavigate()
  const { can } = useAuth()
  const [from, setFrom] = useState(monthStart())
  const [to, setTo] = useState(today())
  const [all, setAll] = useState(false)
  const [downloading, setDownloading] = useState(false)

  const list = useQuery({ queryKey: ['reports'], queryFn: async () => (await api.get<{ data: { key: string; title: string }[] }>('/api/v1/reports')).data.data })
  const params = { from, to, branch: all ? 'all' : undefined }
  const data = useQuery({
    queryKey: ['report', report, from, to, all],
    enabled: !!report,
    queryFn: async () => (await api.get<{ data: Report }>(`/api/v1/reports/${report}`, { params })).data.data,
  })

  const download = async () => {
    setDownloading(true)
    try {
      const res = await api.get(`/api/v1/reports/${report}`, { params: { ...params, format: 'csv' }, responseType: 'blob' })
      const url = URL.createObjectURL(res.data as Blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${report}_${from}_${to}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) { toast.error(errorMessage(e)) } finally { setDownloading(false) }
  }

  const r = data.data
  return (
    <div className="grid gap-5 lg:grid-cols-[240px_1fr]">
      <div className="print:hidden">
        <h1 className="mb-3 text-2xl font-semibold tracking-tight">Reports</h1>
        <nav className="space-y-0.5">
          {list.data?.map((x) => (
            <button key={x.key} onClick={() => navigate(`/reports/${x.key}`)}
              className={cn('flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-secondary', report === x.key && 'bg-primary/10 font-medium text-primary')}>
              <FileBarChart className="size-4 shrink-0" /> {x.title}
            </button>
          ))}
        </nav>
      </div>

      <div className="min-w-0">
        {!report ? (
          <Card><EmptyState title="Choose a report">Pick a report on the left. Every report can be exported to Excel (CSV) or printed / saved as PDF.</EmptyState></Card>
        ) : (
          <>
            <PageHeader
              title={r?.title ?? '…'}
              description={report === 'portfolio' || report === 'top_customers' ? 'As of today. The date range filters by pawn date.' : `From ${from} to ${to}`}
              actions={
                <div className="flex flex-wrap items-center gap-2 print:hidden">
                  <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" aria-label="From" />
                  <Input type="date" value={to} max={today()} onChange={(e) => setTo(e.target.value)} className="w-40" aria-label="To" />
                  {can('reports.all_branches') && (
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={all} onChange={(e) => setAll(e.target.checked)} /> All branches</label>
                  )}
                  <Button variant="secondary" loading={downloading} disabled={!r} onClick={download}><Download className="size-4" /> Excel</Button>
                  <Button variant="secondary" disabled={!r} onClick={() => printCurrentPage('Report')}><Printer className="size-4" /> Print / PDF</Button>
                </div>
              }
            />
            <Card>
              {data.isPending ? <div className="grid place-items-center py-14"><Spinner /></div> : data.isError ? (
                <p className="p-4 text-sm text-destructive">{errorMessage(data.error)}</p>
              ) : !r || r.rows.length === 0 ? <EmptyState title="No records for this period" /> : (
                <Table>
                  <thead>
                    <tr>{r.columns.map((c) => <Th key={c.key} className={cn(['money', 'weight', 'int'].includes(c.type) && 'text-right')}>{c.label}</Th>)}</tr>
                  </thead>
                  <tbody>
                    {r.rows.map((row, i) => (
                      <tr key={i}>
                        {r.columns.map((c) => (
                          <Td key={c.key} className={cn(['money', 'weight', 'int'].includes(c.type) && 'text-right tabular-nums', c.type === 'date' && 'whitespace-nowrap')}>
                            {fmt(row[c.key], c.type)}
                          </Td>
                        ))}
                      </tr>
                    ))}
                    <tr className="bg-secondary/50 font-semibold">
                      {r.columns.map((c, i) => (
                        <Td key={c.key} className={cn(['money', 'weight', 'int'].includes(c.type) && 'text-right tabular-nums')}>
                          {i === 0 ? `Total (${r.totals.count})` : r.totals[c.key] !== undefined ? fmt(r.totals[c.key], c.type) : ''}
                        </Td>
                      ))}
                    </tr>
                  </tbody>
                </Table>
              )}
            </Card>
          </>
        )}
      </div>
    </div>
  )
}
