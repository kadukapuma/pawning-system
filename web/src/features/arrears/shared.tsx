import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Td } from '@/components/ui'

export type TicketSummary = {
  id: number
  receipt_no: string
  stock_no: string
  scheme: string | null
  maturity_date: string
  principal_current: string
  customer: { name: string | null; nic: string | null; phone: string | null }
}

export type ArrearsRow = TicketSummary & { interest: string; arrears: string; total: string; days_overdue: number }

export type Skipped = { ticket_id: number; receipt_no: string | null; reason: string }

/** Set-based row selection for bulk actions. */
export function useSelection() {
  const [selected, setSelected] = useState<Set<number>>(new Set())
  return {
    selected,
    has: (id: number) => selected.has(id),
    toggle: (id: number) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n }),
    setAll: (ids: number[], on: boolean) => setSelected(on ? new Set(ids) : new Set()),
    clear: () => setSelected(new Set()),
    ids: () => Array.from(selected),
  }
}

export function TicketCells({ t }: { t: TicketSummary }) {
  return (
    <>
      <Td><Link to={`/pawning/tickets/${t.id}`} className="font-mono text-primary hover:underline" onClick={(e) => e.stopPropagation()}>{t.receipt_no}</Link></Td>
      <Td>
        <div className="font-medium">{t.customer.name}</div>
        <div className="text-xs text-muted-foreground">{t.customer.nic} · {t.customer.phone}</div>
      </Td>
      <Td>{t.scheme}</Td>
      <Td>{t.maturity_date}</Td>
    </>
  )
}

export function reportSkipped(skipped: Skipped[]) {
  if (skipped.length === 0) return
  toast.warning(`${skipped.length} ticket(s) skipped`, {
    description: skipped.slice(0, 5).map((s) => `${s.receipt_no ?? s.ticket_id}: ${s.reason}`).join('\n'),
    duration: 10000,
  })
}

export function SelectAll({ ids, sel }: { ids: number[]; sel: ReturnType<typeof useSelection> }) {
  const all = ids.length > 0 && ids.every((id) => sel.has(id))
  return <input type="checkbox" aria-label="Select all" checked={all} onChange={(e) => sel.setAll(ids, e.target.checked)} className="size-4" />
}
