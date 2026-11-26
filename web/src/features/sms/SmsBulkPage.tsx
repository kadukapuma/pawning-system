import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Button, Card, Checkbox, Field, Input, PageHeader, Select } from '@/components/ui'
import { useAuth } from '@/features/auth/AuthProvider'
import { api } from '@/lib/api'
import { useApiMutation, useApiQuery, useDebounced } from '@/lib/hooks'
import type { Customer, Paginated } from '@/lib/types'
import { emptyTexts, LANGUAGES, MessageEditor, OffNotice, useSmsStatus, type Texts } from './shared'

type Audience = 'customer' | 'active_tickets' | 'overdue' | 'all'
type Input_ = { audience: Audience; customer_id: number | null; all_branches: boolean; messages: Texts }
type Preview = { recipients: number; no_mobile: number; segments: number; sample: string | null }

const PLACEHOLDERS = ['customer_name', 'first_name', 'company', 'branch', 'branch_phone']

/** Identifies one send, so a double click cannot queue it twice. */
function newBatch(): string {
  // crypto.randomUUID() is missing on plain-http network addresses.
  return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) =>
    (Number(c) ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(c) / 4)))).toString(16))
}

export function SmsBulkPage() {
  const { can } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const preset = Number(params.get('customer')) || null
  const status = useSmsStatus()
  const [input, setInput] = useState<Input_>({ audience: preset ? 'customer' : 'active_tickets', customer_id: preset, all_branches: false, messages: emptyTexts })
  const [checked, setChecked] = useState<{ result: Preview; batch: string } | null>(null)

  // Any change makes the recipient check out of date.
  const change = (patch: Partial<Input_>) => {
    setInput((i) => ({ ...i, ...patch }))
    setChecked(null)
  }

  const preview = useApiMutation<Input_, Preview>({
    url: '/api/v1/sms/bulk/preview',
    onSuccess: (result) => setChecked({ result, batch: newBatch() }),
  })
  const send = useApiMutation<Input_ & { batch: string }, { queued: number }>({
    url: '/api/v1/sms/bulk',
    invalidate: [['sms', 'messages']],
    onSuccess: (r) => {
      toast.success(`${r.queued} message(s) queued`)
      navigate('/sms/history')
    },
  })

  const errors = { ...preview.fieldErrors, ...send.fieldErrors }
  const ready = input.audience !== 'customer' || input.customer_id !== null

  return (
    <div>
      <PageHeader title="Custom SMS" description="Write a message and send it to one customer or a group." />
      {status.data && !status.data.enabled && <OffNotice>SMS is switched off, so nothing can be sent. An administrator can turn it on in SMS settings.</OffNotice>}
      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <Card className="space-y-5 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Send to" error={errors.audience}>
              <Select value={input.audience} onChange={(e) => change({ audience: e.target.value as Audience })}>
                <option value="customer">One customer</option>
                <option value="active_tickets">Customers with active tickets</option>
                <option value="overdue">Customers with overdue tickets</option>
                <option value="all">All active customers</option>
              </Select>
            </Field>
            {input.audience === 'customer' ? (
              <CustomerSearch value={input.customer_id} onChange={(customer_id) => change({ customer_id })} error={errors.customer_id} />
            ) : can('reports.all_branches') ? (
              <div className="self-end pb-2">
                <Checkbox label="All branches" checked={input.all_branches} onChange={(e) => change({ all_branches: e.target.checked })} />
              </div>
            ) : null}
          </div>
          {LANGUAGES.map(([k, label]) => (
            <MessageEditor
              key={k}
              type="custom"
              label={label}
              value={input.messages[k]}
              onChange={(v) => change({ messages: { ...input.messages, [k]: v } })}
              placeholders={PLACEHOLDERS}
              error={errors[`messages.${k}`]}
              hint={k === 'en' ? 'Customers get their own language when it is filled in, otherwise the default language or English.' : 'Optional.'}
            />
          ))}
        </Card>

        <Card className="h-fit space-y-3 p-5 text-sm">
          <h2 className="font-semibold">Check and send</h2>
          <Button variant="secondary" className="w-full" loading={preview.isPending} disabled={!ready} onClick={() => preview.mutate(input)}>
            Check recipients
          </Button>
          {checked && (
            <>
              <p><span className="text-lg font-semibold">{checked.result.recipients}</span> recipient(s), {checked.result.segments} SMS part(s) in total.</p>
              {checked.result.no_mobile > 0 && <p className="text-destructive">{checked.result.no_mobile} left out: no valid mobile number or no text.</p>}
              {checked.result.sample && <p className="rounded-md bg-secondary/50 p-3 whitespace-pre-wrap">{checked.result.sample}</p>}
              <Button
                className="w-full" loading={send.isPending} disabled={!status.data?.enabled || checked.result.recipients === 0}
                onClick={() => window.confirm(`Send to ${checked.result.recipients} customer(s) (${checked.result.segments} SMS parts)?`) && send.mutate({ ...input, batch: checked.batch })}
              >
                Send
              </Button>
              <p className="text-xs text-muted-foreground">Large groups are sent in the background. Check progress in SMS history.</p>
            </>
          )}
        </Card>
      </div>
    </div>
  )
}

function CustomerSearch({ value, onChange, error }: { value: number | null; onChange: (id: number | null) => void; error?: string }) {
  const [term, setTerm] = useState('')
  const q = useDebounced(term.trim())
  const chosen = useApiQuery<Customer>(['customers', String(value)], `/api/v1/customers/${value}`, value !== null)
  const matches = useQuery({
    queryKey: ['customers', 'sms-search', q],
    queryFn: async () => (await api.get<Paginated<Customer>>('/api/v1/customers', { params: { q } })).data.data.slice(0, 8),
    enabled: value === null && q.length >= 2,
    placeholderData: keepPreviousData,
  })

  if (value !== null) {
    return (
      <div className="space-y-1 text-sm">
        <span className="font-medium">Customer</span>
        <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-1">
          <span>{chosen.data ? `${chosen.data.full_name} · ${chosen.data.phone1}` : 'Loading…'}</span>
          <Button size="sm" variant="ghost" onClick={() => { setTerm(''); onChange(null) }}>Change</Button>
        </div>
        {error && <span className="block text-xs text-destructive">{error}</span>}
      </div>
    )
  }

  return (
    <div>
      <Field label="Customer" error={error}>
        <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Name, NIC or mobile" />
      </Field>
      {q.length >= 2 && matches.data && (
        <ul className="mt-1 rounded-md border text-sm">
          {matches.data.length === 0 && <li className="px-3 py-2 text-muted-foreground">No match</li>}
          {matches.data.map((c) => (
            <li key={c.id}>
              <button type="button" className="w-full px-3 py-1.5 text-left hover:bg-secondary" onClick={() => onChange(c.id)}>
                {c.full_name} <span className="text-muted-foreground">· {c.nic} · {c.phone1}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
