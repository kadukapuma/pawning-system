import { Search, UserPlus, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge, Button, Card, Input, Spinner } from '@/components/ui'
import { CustomerFormDialog } from '@/features/customers/CustomerFormDialog'
import { api, errorMessage } from '@/lib/api'
import type { Customer } from '@/lib/types'
import { formatMoney } from '@/lib/utils'

/** Find the customer by NIC, or create them on the spot. */
export function CustomerPicker({
  value,
  onChange,
  initialCustomerId,
}: {
  value: Customer | null
  onChange: (c: Customer | null) => void
  initialCustomerId?: string | null
}) {
  const [nic, setNic] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (!initialCustomerId) return
    api.get<{ data: Customer }>(`/api/v1/customers/${initialCustomerId}`).then((r) => onChange(r.data.data)).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCustomerId])

  const find = async () => {
    if (!nic.trim()) return
    setBusy(true)
    setMessage(null)
    try {
      const r = await api.get<{ data: Customer }>(`/api/v1/customers/nic/${encodeURIComponent(nic.trim())}`)
      onChange(r.data.data)
    } catch (e) {
      const status = (e as { response?: { status?: number } }).response?.status
      setMessage(status === 404 ? 'No customer with this NIC.' : errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  if (value) {
    const name = [value.title, value.full_name].filter(Boolean).join(' ')
    const initials = value.full_name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join('')
    return (
      <Card className="flex flex-wrap items-center gap-4 p-4">
        <span className="grid size-12 shrink-0 place-items-center rounded-full bg-primary/15 text-sm font-semibold text-primary">{initials}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{name}</p>
            <Badge tone={value.status === 'active' ? 'success' : 'danger'}>{value.status}</Badge>
            <span className="text-xs text-muted-foreground">{value.code}</span>
          </div>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">
            NIC {value.nic} · {value.phone1}
            {(value.address_line1 || value.city) && ` · ${[value.address_line1, value.city].filter(Boolean).join(', ')}`}
          </p>
        </div>
        {value.exposure && (
          <div className="flex w-full flex-wrap gap-x-6 gap-y-2 text-xs whitespace-nowrap sm:w-auto sm:text-right">
            <div>
              <p className="text-muted-foreground">Active tickets</p>
              <p className="text-base font-medium tabular-nums">{value.exposure.active_tickets}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Outstanding</p>
              <p className="text-base font-medium tabular-nums">{formatMoney(value.exposure.outstanding_principal)}</p>
            </div>
            {value.pawn_amount_limit && (
              <div>
                <p className="text-muted-foreground">Limit</p>
                <p className="text-base font-medium tabular-nums">{formatMoney(value.pawn_amount_limit)}</p>
              </div>
            )}
          </div>
        )}
        <Button variant="ghost" size="sm" onClick={() => onChange(null)}><X className="size-4" /> Change</Button>
      </Card>
    )
  }

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={nic}
            onChange={(e) => setNic(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), find())}
            placeholder="Customer NIC (e.g. 901234567V)"
            aria-label="Customer NIC"
            className="pl-9 uppercase placeholder:normal-case"
            autoFocus
          />
        </div>
        <Button onClick={find} loading={busy} variant="primary">Find</Button>
        <span className="mx-1 hidden h-6 w-px bg-border sm:block" />
        <Button onClick={() => setCreating(true)} variant="ghost"><UserPlus className="size-4" /> New customer</Button>
        {busy && <Spinner />}
      </div>
      {message && (
        <p className="mt-2 text-sm text-destructive">
          {message}{' '}
          {message.startsWith('No customer') && (
            <button className="font-medium underline" onClick={() => setCreating(true)}>Create one</button>
          )}
        </p>
      )}
      <CustomerFormDialog
        open={creating}
        onClose={() => setCreating(false)}
        initialNic={nic.trim().toUpperCase() || undefined}
        onSaved={(c) => onChange(c)}
      />
    </Card>
  )
}
