import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Button, Card, EmptyState, PageHeader, Spinner, Table, Td, Th } from '@/components/ui'
import { useApiMutation, useApiQuery } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import { OffNotice, SmsStatusBadge, useSmsStatus, type Mode } from './shared'

type Item = {
  key: string
  customer: { id: number; name: string; phone: string }
  ticket: { id: number; receipt_no: string; maturity_date: string } | null
  text: string | null
  status: string | null
  problem: string | null
}

const canSend = (i: Item) => !i.problem && (i.status === null || i.status === 'failed' || i.status === 'cancelled')

export function SmsRemindersPage() {
  const status = useSmsStatus()
  const [type, setType] = useState('birthday')

  if (status.isPending) return <Spinner />
  const types = status.data?.types.filter((t) => t.is_reminder) ?? []

  return (
    <div>
      <PageHeader title="SMS reminders" description="Customers due a message today in this branch." />
      {status.data && !status.data.enabled && <OffNotice>SMS is switched off, so nothing can be sent. An administrator can turn it on in SMS settings.</OffNotice>}
      <div role="tablist" aria-label="Reminder type" className="mb-3 flex flex-wrap gap-2">
        {types.map((t) => (
          <Button key={t.type} role="tab" aria-selected={type === t.type} size="sm" variant={type === t.type ? 'primary' : 'secondary'} onClick={() => setType(t.type)}>
            {t.label}
          </Button>
        ))}
      </div>
      <DueList key={type} type={type} enabled={status.data?.enabled ?? false} />
    </div>
  )
}

function DueList({ type, enabled }: { type: string; enabled: boolean }) {
  const due = useApiQuery<{ mode: Mode; items: Item[] }>(['sms', 'due', type], `/api/v1/sms/due/${type}`)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const send = useApiMutation<{ keys: string[] }, { queued: number; skipped: number }>({
    url: `/api/v1/sms/due/${type}`,
    invalidate: [['sms', 'due'], ['sms', 'messages']],
    onSuccess: (r) => {
      setPicked(new Set())
      toast.success(`${r.queued} message(s) being sent${r.skipped ? `, ${r.skipped} skipped` : ''}`)
    },
  })

  if (due.isPending) return <div className="grid place-items-center py-14"><Spinner /></div>
  if (!due.data) return <p className="text-destructive">Could not load the list.</p>

  const { mode, items } = due.data
  const sendable = items.filter(canSend)
  const selected = sendable.filter((i) => picked.has(i.key))
  const allPicked = sendable.length > 0 && selected.length === sendable.length

  const toggle = (key: string) => setPicked((current) => {
    const next = new Set(current)
    if (!next.delete(key)) next.add(key)
    return next
  })

  return (
    <>
      {mode === 'off' && <OffNotice>This message type is switched off.</OffNotice>}
      {mode === 'auto' && <p className="mb-3 text-sm text-muted-foreground">This type is sent automatically each day. You can also send from here.</p>}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3 text-sm">
          <span className="text-muted-foreground">{items.length} due · {selected.length} selected</span>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" loading={due.isFetching} onClick={() => due.refetch()}>Refresh</Button>
            <Button
              size="sm" loading={send.isPending} disabled={!enabled || mode === 'off' || selected.length === 0}
              onClick={() => window.confirm(`Send ${selected.length} SMS?`) && send.mutate({ keys: selected.map((i) => i.key) })}
            >
              Send selected
            </Button>
          </div>
        </div>
        {items.length === 0 ? (
          <EmptyState title="Nobody is due this message today" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th className="w-8">
                  <input type="checkbox" className="size-4" aria-label="Select all" checked={allPicked} disabled={sendable.length === 0}
                    onChange={() => setPicked(allPicked ? new Set() : new Set(sendable.map((i) => i.key)))} />
                </Th>
                <Th>Customer</Th><Th>Ticket</Th><Th>Message</Th><Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.key}>
                  <Td>
                    <input type="checkbox" className="size-4" aria-label={`Select ${i.customer.name}`} disabled={!canSend(i)}
                      checked={canSend(i) && picked.has(i.key)} onChange={() => toggle(i.key)} />
                  </Td>
                  <Td>
                    <Link to={`/customers/${i.customer.id}`} className="font-medium text-primary hover:underline">{i.customer.name}</Link>
                    <div className="text-xs text-muted-foreground">{i.customer.phone}</div>
                  </Td>
                  <Td className="whitespace-nowrap">
                    {i.ticket && <><Link to={`/pawning/tickets/${i.ticket.id}`} className="text-primary hover:underline">{i.ticket.receipt_no}</Link>
                      <div className="text-xs text-muted-foreground">due {i.ticket.maturity_date}</div></>}
                  </Td>
                  <Td className={cn('max-w-md text-xs', !i.text && 'text-muted-foreground')}>{i.text ?? '—'}</Td>
                  <Td>
                    {i.problem ? <span className="text-xs text-destructive">{i.problem}</span> : i.status ? <SmsStatusBadge status={i.status} /> : <span className="text-xs text-muted-foreground">not sent</span>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  )
}
