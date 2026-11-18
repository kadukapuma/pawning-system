import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge, Card, Checkbox, EmptyState, Input, PageHeader, Pagination, Select, Spinner, Table, Td, Th } from '@/components/ui'
import { api } from '@/lib/api'
import { useDebounced } from '@/lib/hooks'
import type { Paginated } from '@/lib/types'
import { formatMoney } from '@/lib/utils'
import { statusTone, type PawnTicket } from './types'

type Action = 'part-payment' | 'renewal' | 'redeem'

const TITLES: Record<Action | 'search' | 'blocked', [string, string]> = {
  search: ['Ticket search', 'Find a ticket by receipt, ticket, stock or old receipt number, or by customer NIC / name.'],
  'part-payment': ['Part payment', 'Find the ticket to take a part payment on.'],
  renewal: ['Renewal', 'Find the ticket to renew.'],
  redeem: ['Redemption', 'Find the ticket to redeem.'],
  blocked: ['Blocked tickets', 'Blocked tickets cannot be redeemed or renewed until unblocked.'],
}

export function TicketSearchPage({ mode = 'search' }: { mode?: Action | 'search' | 'blocked' }) {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState(mode === 'search' ? '' : 'active')
  const [overdue, setOverdue] = useState(false)
  const [page, setPage] = useState(1)
  const search = useDebounced(q)

  const list = useQuery({
    queryKey: ['tickets', { search, status, overdue, page, mode }],
    queryFn: async () =>
      (await api.get<Paginated<PawnTicket>>('/api/v1/pawn-tickets', {
        params: {
          q: search || undefined, status: status || undefined, page,
          overdue: overdue ? 1 : undefined, blocked: mode === 'blocked' ? 1 : undefined,
        },
      })).data,
    placeholderData: keepPreviousData,
  })

  const open = (t: PawnTicket) =>
    navigate(`/pawning/tickets/${t.id}${mode !== 'search' && mode !== 'blocked' ? `?action=${mode}` : ''}`)

  const [title, description] = TITLES[mode]

  return (
    <div>
      <PageHeader title={title} description={description} />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <div className="relative min-w-60 flex-1">
            <Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(1) }}
              onKeyDown={(e) => e.key === 'Enter' && list.data?.data.length === 1 && open(list.data.data[0])}
              placeholder="Receipt / ticket / stock no, NIC or name…"
              className="pl-9"
              autoFocus
            />
          </div>
          {mode === 'search' && (
            <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }} className="w-40">
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="redeemed">Redeemed</option>
              <option value="forfeited">Forfeited</option>
              <option value="cancelled">Cancelled</option>
            </Select>
          )}
          {mode !== 'blocked' && <Checkbox label="Overdue only" checked={overdue} onChange={(e) => { setOverdue(e.target.checked); setPage(1) }} />}
        </div>

        {list.isPending ? (
          <div className="grid place-items-center py-14"><Spinner /></div>
        ) : list.data?.data.length === 0 ? (
          <EmptyState title="No tickets found" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Receipt</Th><Th>Stock</Th><Th>Customer</Th><Th>Scheme</Th><Th>Pawned</Th><Th>Maturity</Th>
                <Th className="text-right">Capital</Th><Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {list.data?.data.map((t) => (
                <tr key={t.id} className="cursor-pointer hover:bg-secondary/50" onClick={() => open(t)}>
                  <Td className="font-mono">{t.receipt_no}{t.legacy_receipt_no && <div className="text-xs text-muted-foreground">old {t.legacy_receipt_no}</div>}</Td>
                  <Td className="font-mono text-xs">{t.stock_no}</Td>
                  <Td>
                    <div className="font-medium">{t.customer?.full_name}</div>
                    <div className="text-xs text-muted-foreground">{t.customer?.nic}</div>
                  </Td>
                  <Td><Badge tone="primary">{t.scheme?.code}</Badge></Td>
                  <Td>{t.pawn_date}</Td>
                  <Td className={t.is_overdue ? 'font-medium text-destructive' : ''}>{t.maturity_date}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(t.principal_current)}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      <Badge tone={statusTone(t.status)}>{t.status}</Badge>
                      {t.is_blocked && <Badge tone="danger">blocked</Badge>}
                      {t.arrears_stage !== 'none' && <Badge tone="warning">{t.arrears_stage.replace('_', ' ')}</Badge>}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pagination meta={list.data?.meta} onPage={setPage} />
      </Card>
    </div>
  )
}
