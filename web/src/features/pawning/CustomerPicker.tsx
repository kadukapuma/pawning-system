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
    return (
      <Card className="flex flex-wrap items-center gap-4 p-4">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <p className="font-semibold">{[value.title, value.full_name].filter(Boolean).join(' ')}</p>
            <Badge tone={value.status === 'active' ? 'success' : 'danger'}>{value.status}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {value.code} · NIC {value.nic} · {value.phone1} · {[value.address_line1, value.city].filter(Boolean).join(', ')}
          </p>
          {value.exposure && (
            <p className="text-xs text-muted-foreground">
              {value.exposure.active_tickets} active ticket(s), {formatMoney(value.exposure.outstanding_principal)} outstanding
              {value.pawn_amount_limit && ` · limit ${formatMoney(value.pawn_amount_limit)}`}
            </p>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={() => onChange(null)}><X className="size-4" /> Change</Button>
      </Card>
    )
  }

  return (
    <Card className="p-4">
      <div className="flex flex-wrap gap-2">
        <Input
          value={nic}
          onChange={(e) => setNic(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), find())}
          placeholder="Customer NIC (e.g. 901234567V)"
          className="max-w-xs uppercase"
          autoFocus
        />
        <Button onClick={find} loading={busy} variant="secondary"><Search className="size-4" /> Find</Button>
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
