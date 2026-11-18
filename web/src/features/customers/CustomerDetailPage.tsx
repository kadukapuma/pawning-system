import { ArrowLeft, Pencil, Plus, ShieldAlert, SlidersHorizontal } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Badge, Button, Card, Dialog, Field, Input, Select, Spinner, Table, Td, Textarea, Th } from '@/components/ui'
import { statusTone as ticketTone, type PawnTicket } from '@/features/pawning/types'
import { useAuth } from '@/features/auth/AuthProvider'
import { useApiMutation, useApiQuery } from '@/lib/hooks'
import type { Customer, CustomerStatus } from '@/lib/types'
import { formatMoney } from '@/lib/utils'
import { CustomerFormDialog } from './CustomerFormDialog'
import { statusTone } from './CustomersPage'

function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children || '—'}</dd>
    </div>
  )
}

export function CustomerDetailPage() {
  const { id } = useParams()
  const { can } = useAuth()
  const customer = useApiQuery<Customer>(['customers', id], `/api/v1/customers/${id}`)
  const [editing, setEditing] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)
  const [limitsOpen, setLimitsOpen] = useState(false)

  if (customer.isPending) return <div className="grid place-items-center py-20"><Spinner /></div>
  if (customer.isError || !customer.data) return <p className="text-destructive">Customer not found.</p>
  const c = customer.data

  return (
    <div className="space-y-5">
      <Link to="/customers" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Customers
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{[c.title, c.full_name].filter(Boolean).join(' ')}</h1>
            <Badge tone={statusTone(c.status)}>{c.status}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {c.code} · NIC {c.nic} · registered at {c.branch?.code} {c.branch?.name}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can('customers.manage') && (
            <>
              <Button variant="secondary" onClick={() => setEditing(true)}><Pencil className="size-4" /> Edit</Button>
              <Button variant="secondary" onClick={() => setStatusOpen(true)}><ShieldAlert className="size-4" /> Status</Button>
            </>
          )}
          {can('customers.set_limits') && (
            <Button variant="secondary" onClick={() => setLimitsOpen(true)}><SlidersHorizontal className="size-4" /> Limits</Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Active tickets" value={String(c.exposure?.active_tickets ?? 0)} sub={c.pawn_count_limit !== null ? `limit ${c.pawn_count_limit}` : 'no limit'} />
        <Stat label="Outstanding capital" value={formatMoney(c.exposure?.outstanding_principal)} sub={c.pawn_amount_limit !== null ? `limit ${formatMoney(c.pawn_amount_limit)}` : 'no limit'} />
        <Stat label="Mobile" value={c.phone1} sub={c.phone2 ?? undefined} />
        <Stat label="Customer since" value={new Date(c.created_at).toLocaleDateString()} />
      </div>

      <Card className="p-5">
        <h2 className="mb-3 text-sm font-semibold">Details</h2>
        <dl className="grid gap-4 sm:grid-cols-3">
          <Info label="Address">{[c.address_line1, c.address_line2, c.city].filter(Boolean).join(', ')}</Info>
          <Info label="Gender">{c.gender}</Info>
          <Info label="Date of birth">{c.date_of_birth}</Info>
          <Info label="Email">{c.email}</Info>
          <Info label="Driving licence">{c.driving_license}</Info>
          <Info label="Passport">{c.passport}</Info>
          <Info label="Other ID">{c.other_identification}</Info>
          <Info label="Notes">{c.notes}</Info>
        </dl>
      </Card>

      <CustomerTickets customerId={c.id} canPawn={can('pawn.create') && c.status === 'active'} />

      <CustomerFormDialog open={editing} onClose={() => setEditing(false)} customer={c} />
      <StatusDialog open={statusOpen} onClose={() => setStatusOpen(false)} customer={c} />
      <LimitsDialog open={limitsOpen} onClose={() => setLimitsOpen(false)} customer={c} />
    </div>
  )
}

function CustomerTickets({ customerId, canPawn }: { customerId: number; canPawn: boolean }) {
  const navigate = useNavigate()
  const { can } = useAuth()
  const tickets = useApiQuery<PawnTicket[]>(['customers', customerId, 'tickets'], `/api/v1/customers/${customerId}/tickets`, can('pawn.view'))

  return (
    <Card>
      <div className="flex items-center justify-between px-4 pt-4">
        <h2 className="text-sm font-semibold">Pawn tickets (all branches)</h2>
        {canPawn && <Button size="sm" onClick={() => navigate(`/pawning/new?customer=${customerId}`)}><Plus className="size-4" /> New pawn</Button>}
      </div>
      {tickets.isPending ? (
        <div className="p-6"><Spinner /></div>
      ) : (tickets.data?.length ?? 0) === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">No tickets yet.</p>
      ) : (
        <Table className="mt-2">
          <thead><tr><Th>Receipt</Th><Th>Branch</Th><Th>Scheme</Th><Th>Pawned</Th><Th>Maturity</Th><Th className="text-right">Capital</Th><Th>Status</Th></tr></thead>
          <tbody>
            {tickets.data?.map((t) => (
              <tr key={t.id} className="cursor-pointer hover:bg-secondary/50" onClick={() => navigate(`/pawning/tickets/${t.id}`)}>
                <Td className="font-mono">{t.receipt_no}</Td>
                <Td>{t.branch?.code}</Td>
                <Td>{t.scheme?.code}</Td>
                <Td>{t.pawn_date}</Td>
                <Td className={t.is_overdue ? 'text-destructive' : ''}>{t.maturity_date}</Td>
                <Td className="text-right tabular-nums">{formatMoney(t.principal_current)}</Td>
                <Td><Badge tone={ticketTone(t.status)}>{t.status}</Badge>{t.is_blocked && <Badge tone="danger">blocked</Badge>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </Card>
  )
}

function StatusDialog({ open, onClose, customer }: { open: boolean; onClose: () => void; customer: Customer }) {
  const [status, setStatus] = useState<CustomerStatus>(customer.status)
  const [reason, setReason] = useState('')
  const save = useApiMutation<{ status: string; reason: string }>({
    method: 'put',
    url: `/api/v1/customers/${customer.id}/status`,
    invalidate: [['customers']],
    success: 'Status updated',
    onSuccess: onClose,
  })
  useEffect(() => {
    if (open) {
      setStatus(customer.status)
      setReason('')
    }
  }, [open, customer.status])

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      title="Change status"
      description="Inactive and blacklisted customers cannot take new pawns."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={save.isPending} onClick={() => save.mutate({ status, reason })}>Save</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Status" error={save.fieldErrors.status}>
          <Select value={status} onChange={(e) => setStatus(e.target.value as CustomerStatus)}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="blacklisted">Blacklisted</option>
          </Select>
        </Field>
        <Field label="Reason" required error={save.fieldErrors.reason}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  )
}

function LimitsDialog({ open, onClose, customer }: { open: boolean; onClose: () => void; customer: Customer }) {
  const [amount, setAmount] = useState('')
  const [count, setCount] = useState('')
  const save = useApiMutation<{ pawn_amount_limit: string | null; pawn_count_limit: string | null }>({
    method: 'put',
    url: `/api/v1/customers/${customer.id}/limits`,
    invalidate: [['customers']],
    success: 'Limits updated',
    onSuccess: onClose,
  })
  useEffect(() => {
    if (open) {
      setAmount(customer.pawn_amount_limit ?? '')
      setCount(customer.pawn_count_limit?.toString() ?? '')
    }
  }, [open, customer])

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      title="Pawn limits"
      description={`Outstanding now: ${formatMoney(customer.exposure?.outstanding_principal)} on ${customer.exposure?.active_tickets ?? 0} ticket(s). Leave empty for no limit.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            loading={save.isPending}
            onClick={() => save.mutate({ pawn_amount_limit: amount || null, pawn_count_limit: count || null })}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Maximum outstanding capital (Rs.)" error={save.fieldErrors.pawn_amount_limit}>
          <Input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Maximum active tickets" error={save.fieldErrors.pawn_count_limit}>
          <Input type="number" min={0} step="1" value={count} onChange={(e) => setCount(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  )
}
