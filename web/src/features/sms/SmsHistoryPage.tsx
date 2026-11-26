import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Button, Card, EmptyState, Input, PageHeader, Pagination, Select, Spinner, Table, Td, Th } from '@/components/ui'
import { useAuth } from '@/features/auth/AuthProvider'
import { api } from '@/lib/api'
import { useApiMutation, useDebounced } from '@/lib/hooks'
import type { Paginated } from '@/lib/types'
import { OffNotice, SmsStatusBadge, useSmsStatus } from './shared'

type Message = {
  id: number
  label: string
  phone: string
  body: string
  segments: number
  status: string
  error: string | null
  customer: { id: number; name: string } | null
  ticket: { id: number; receipt_no: string } | null
  created_by: string | null
  created_at: string
}

const STATUSES = ['queued', 'sending', 'sent', 'failed', 'cancelled']
const INVALIDATE = [['sms', 'messages'], ['sms', 'due']]

export function SmsHistoryPage() {
  const { can } = useAuth()
  const status = useSmsStatus()
  const [filters, setFilters] = useState({ q: '', type: '', status: '', from: '', to: '' })
  const [page, setPage] = useState(1)
  const debounced = useDebounced(filters)

  const messages = useQuery({
    queryKey: ['sms', 'messages', debounced, page],
    queryFn: async () =>
      (await api.get<Paginated<Message>>('/api/v1/sms/messages', {
        params: { ...Object.fromEntries(Object.entries(debounced).filter(([, v]) => v)), page },
      })).data,
    placeholderData: keepPreviousData,
  })

  const retry = useApiMutation<{ id: number }, { status: string; error: string | null }>({
    url: (b) => `/api/v1/sms/messages/${b.id}/retry`,
    invalidate: INVALIDATE,
    onSuccess: (r) => (r.status === 'sent' ? toast.success('SMS sent') : toast.error(r.error ?? `SMS ${r.status}`)),
  })
  const cancel = useApiMutation<{ id: number }>({ url: (b) => `/api/v1/sms/messages/${b.id}/cancel`, invalidate: INVALIDATE, success: 'Message cancelled' })
  const flush = useApiMutation<Record<string, never>, { sent: number; failed: number; waiting: number }>({
    url: '/api/v1/sms/messages/flush',
    invalidate: INVALIDATE,
    onSuccess: (r) => toast.success(`${r.sent} sent, ${r.failed} failed, ${r.waiting} still waiting`),
  })

  const set = (k: keyof typeof filters) => (e: { target: { value: string } }) => {
    setFilters((f) => ({ ...f, [k]: e.target.value }))
    setPage(1)
  }

  return (
    <div>
      <PageHeader
        title="SMS history"
        description="Messages for this branch. “Sent” means Notify.lk accepted the message."
        actions={can('sms.send') && (
          <Button variant="secondary" loading={flush.isPending} disabled={!status.data?.enabled} onClick={() => flush.mutate({})}>Send queued now</Button>
        )}
      />
      {status.data && !status.data.enabled && <OffNotice>SMS is switched off. Waiting messages are not being sent.</OffNotice>}
      <Card>
        <div className="flex flex-wrap gap-2 border-b p-3">
          <Input value={filters.q} onChange={set('q')} placeholder="Name, NIC or mobile" className="w-52" aria-label="Search" />
          <Select value={filters.type} onChange={set('type')} className="w-52" aria-label="Message type">
            <option value="">All types</option>
            {status.data?.types.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
          </Select>
          <Select value={filters.status} onChange={set('status')} className="w-40" aria-label="Status">
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </Select>
          <Input type="date" value={filters.from} onChange={set('from')} className="w-40" aria-label="From date" />
          <Input type="date" value={filters.to} onChange={set('to')} className="w-40" aria-label="To date" />
        </div>
        {messages.isPending ? (
          <div className="grid place-items-center py-14"><Spinner /></div>
        ) : !messages.data || messages.data.data.length === 0 ? (
          <EmptyState title="No messages" />
        ) : (
          <Table>
            <thead><tr><Th>When</Th><Th>To</Th><Th>Type</Th><Th>Message</Th><Th>Status</Th><Th /></tr></thead>
            <tbody>
              {messages.data.data.map((m) => (
                <tr key={m.id}>
                  <Td className="text-xs whitespace-nowrap">
                    {new Date(m.created_at).toLocaleString()}
                    {m.created_by && <div className="text-muted-foreground">by {m.created_by}</div>}
                  </Td>
                  <Td>
                    {m.customer && <Link to={`/customers/${m.customer.id}`} className="text-primary hover:underline">{m.customer.name}</Link>}
                    <div className="text-xs text-muted-foreground">{m.phone}</div>
                  </Td>
                  <Td className="text-xs">
                    {m.label}
                    {m.ticket && <div><Link to={`/pawning/tickets/${m.ticket.id}`} className="text-primary hover:underline">{m.ticket.receipt_no}</Link></div>}
                  </Td>
                  <Td className="max-w-md text-xs">
                    {m.body}
                    <div className="text-muted-foreground">{m.segments} part{m.segments === 1 ? '' : 's'}</div>
                  </Td>
                  <Td>
                    <SmsStatusBadge status={m.status} />
                    {m.error && <div className="mt-1 max-w-56 text-xs text-destructive">{m.error}</div>}
                  </Td>
                  <Td>
                    {can('sms.send') && m.status === 'failed' && (
                      <Button size="sm" variant="secondary" disabled={retry.isPending} onClick={() => retry.mutate({ id: m.id })}>Retry</Button>
                    )}
                    {can('sms.send') && m.status === 'queued' && (
                      <Button size="sm" variant="ghost" disabled={cancel.isPending} onClick={() => cancel.mutate({ id: m.id })}>Cancel</Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pagination meta={messages.data?.meta} onPage={setPage} />
      </Card>
    </div>
  )
}
