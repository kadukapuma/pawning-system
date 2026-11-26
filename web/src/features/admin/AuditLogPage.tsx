import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Fragment, useState } from 'react'
import { Badge, Card, EmptyState, Input, PageHeader, Pagination, Select, Spinner, Table, Td, Th } from '@/components/ui'
import { api } from '@/lib/api'
import type { AuditLog, Paginated } from '@/lib/types'

const TYPES = ['customer', 'user', 'branch', 'company', 'karat', 'pawn_scheme', 'article_category', 'article_type', 'article_condition', 'bank', 'bank_branch', 'account', 'sms_setting', 'sms_rule', 'sms_template']
const EVENTS = ['created', 'updated', 'deleted', 'login', 'logout', 'status_changed', 'role_changed', 'password_reset']

const eventTone = (e: string) =>
  e === 'created' ? 'success' : e === 'deleted' ? 'danger' : e.includes('login') || e.includes('logout') ? 'neutral' : 'primary'

export function AuditLogPage() {
  const [filters, setFilters] = useState({ type: '', event: '', from: '', to: '' })
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<number | null>(null)

  const logs = useQuery({
    queryKey: ['audit-logs', filters, page],
    queryFn: async () =>
      (await api.get<Paginated<AuditLog>>('/api/v1/admin/audit-logs', {
        params: { ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)), page },
      })).data,
    placeholderData: keepPreviousData,
  })

  const set = (k: keyof typeof filters) => (e: { target: { value: string } }) => {
    setFilters((f) => ({ ...f, [k]: e.target.value }))
    setPage(1)
  }

  return (
    <div>
      <PageHeader title="Audit log" description="Who changed what, and when. Passwords are never recorded." />
      <Card>
        <div className="flex flex-wrap gap-2 border-b p-3">
          <Select value={filters.type} onChange={set('type')} className="w-44">
            <option value="">All records</option>
            {TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
          </Select>
          <Select value={filters.event} onChange={set('event')} className="w-44">
            <option value="">All events</option>
            {EVENTS.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
          </Select>
          <Input type="date" value={filters.from} onChange={set('from')} className="w-40" aria-label="From date" />
          <Input type="date" value={filters.to} onChange={set('to')} className="w-40" aria-label="To date" />
        </div>
        {logs.isPending ? (
          <div className="grid place-items-center py-14"><Spinner /></div>
        ) : logs.data?.data.length === 0 ? (
          <EmptyState title="No entries" />
        ) : (
          <Table>
            <thead>
              <tr><Th /><Th>When</Th><Th>User</Th><Th>Event</Th><Th>Record</Th><Th>IP</Th></tr>
            </thead>
            <tbody>
              {logs.data?.data.map((l) => {
                const hasDetail = !!(l.old_values || l.new_values)
                return (
                  <Fragment key={l.id}>
                    <tr className={hasDetail ? 'cursor-pointer hover:bg-secondary/50' : ''} onClick={() => hasDetail && setOpen(open === l.id ? null : l.id)}>
                      <Td className="w-6">{hasDetail && (open === l.id ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />)}</Td>
                      <Td className="text-xs whitespace-nowrap">{new Date(l.created_at).toLocaleString()}</Td>
                      <Td>{l.user ? `${l.user.name} (${l.user.username})` : <span className="text-muted-foreground">system</span>}</Td>
                      <Td><Badge tone={eventTone(l.event)}>{l.event.replace(/_/g, ' ')}</Badge></Td>
                      <Td className="text-xs">{l.auditable_type.replace(/_/g, ' ')} #{l.auditable_id}</Td>
                      <Td className="font-mono text-xs">{l.ip_address}</Td>
                    </tr>
                    {open === l.id && (
                      <tr>
                        <Td colSpan={6} className="bg-secondary/30">
                          <Diff before={l.old_values} after={l.new_values} />
                        </Td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </Table>
        )}
        <Pagination meta={logs.data?.meta} onPage={setPage} />
      </Card>
    </div>
  )
}

function Diff({ before, after }: { before: Record<string, unknown> | null; after: Record<string, unknown> | null }) {
  const keys = Array.from(new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]))
  const show = (v: unknown) => (v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v))
  return (
    <table className="text-xs">
      <thead>
        <tr className="text-muted-foreground"><th className="pr-6 text-left">Field</th><th className="pr-6 text-left">Before</th><th className="text-left">After</th></tr>
      </thead>
      <tbody>
        {keys.map((k) => (
          <tr key={k}>
            <td className="pr-6 font-mono">{k}</td>
            <td className="pr-6 text-destructive">{before ? show(before[k]) : ''}</td>
            <td className="text-success">{after ? show(after[k]) : ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
