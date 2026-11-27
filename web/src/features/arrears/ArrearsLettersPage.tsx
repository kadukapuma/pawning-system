import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Mail, Printer } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge, Button, Card, EmptyState, Input, PageHeader, Spinner, Table, Td, Th } from '@/components/ui'
import { useAuth } from '@/features/auth/AuthProvider'
import { api, errorMessage } from '@/lib/api'
import { cn, formatMoney } from '@/lib/utils'
import { reportSkipped, SelectAll, TicketCells, useSelection, type ArrearsRow, type Skipped, type TicketSummary } from './shared'
import { openPrintPreview } from '@/lib/print'

type DueRow = ArrearsRow & { due_date: string; printed: Record<string, string> }
type IssuedRow = { id: number; letter_no: number; issued_at: string; due_date: string; postage_charge: string; reprint_count: number; issued_by: string | null; current_cycle: boolean; ticket: TicketSummary }

const ordinal = ['', '1st', '2nd', '3rd']

export function ArrearsLettersPage() {
  const { can } = useAuth()
  const qc = useQueryClient()
  const [letter, setLetter] = useState(1)
  const [view, setView] = useState<'due' | 'issued'>('due')
  const [from, setFrom] = useState(new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10))
  const [busy, setBusy] = useState(false)
  const sel = useSelection()

  const due = useQuery({
    queryKey: ['letters-due', letter],
    queryFn: async () => (await api.get<{ data: DueRow[] }>('/api/v1/arrears/letters/due', { params: { letter } })).data.data,
    enabled: view === 'due',
  })
  const issued = useQuery({
    queryKey: ['letters-issued', letter, from],
    queryFn: async () => (await api.get<{ data: IssuedRow[] }>('/api/v1/arrears/letters/issued', { params: { letter, from } })).data.data,
    enabled: view === 'issued',
  })

  const switchTo = (l: number, v: 'due' | 'issued') => { setLetter(l); setView(v); sel.clear() }

  const issueSelected = async () => {
    setBusy(true)
    try {
      const r = await api.post<{ data: { letter_ids: number[]; skipped: Skipped[] } }>('/api/v1/arrears/letters/issue', { letter_no: letter, ticket_ids: sel.ids() })
      reportSkipped(r.data.data.skipped)
      if (r.data.data.letter_ids.length) {
        toast.success(`${r.data.data.letter_ids.length} letter(s) issued`)
        openPrintPreview(`/print/letters?ids=${r.data.data.letter_ids.join(',')}`, 'Arrears letters')
      }
      sel.clear()
      qc.invalidateQueries({ queryKey: ['letters-due'] })
      qc.invalidateQueries({ queryKey: ['letters-issued'] })
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const rows = view === 'due' ? due.data ?? [] : []
  const issuedRows = view === 'issued' ? issued.data ?? [] : []
  const loading = view === 'due' ? due.isPending : issued.isPending

  return (
    <div>
      <PageHeader
        title="Arrears letters"
        description="Letter 1 is due on the maturity date; letters 2 and 3 a set number of days after the previous letter was printed. Postage is added to the ticket once per letter."
        actions={
          view === 'due' ? (
            can('arrears.issue_letters') && (
              <Button disabled={sel.selected.size === 0} loading={busy} onClick={issueSelected}>
                <Mail className="size-4" /> Issue & print {sel.selected.size || ''} {ordinal[letter]} letter{sel.selected.size === 1 ? '' : 's'}
              </Button>
            )
          ) : (
            <Button variant="secondary" disabled={sel.selected.size === 0} onClick={() => openPrintPreview(`/print/letters?ids=${sel.ids().join(',')}&reprint=1`, 'Arrears letters (reprint)')}>
              <Printer className="size-4" /> Reprint selected
            </Button>
          )
        }
      />

      <div className="mb-3 flex flex-wrap gap-2">
        {[1, 2, 3].map((l) => (
          <div key={l} className="flex overflow-hidden rounded-lg border">
            <button className={cn('px-3 py-1.5 text-sm', view === 'due' && letter === l ? 'bg-primary text-primary-foreground' : 'hover:bg-secondary')} onClick={() => switchTo(l, 'due')}>
              {ordinal[l]} letter due
            </button>
            <button className={cn('border-l px-3 py-1.5 text-sm', view === 'issued' && letter === l ? 'bg-primary text-primary-foreground' : 'hover:bg-secondary')} onClick={() => switchTo(l, 'issued')}>
              printed
            </button>
          </div>
        ))}
        {view === 'issued' && <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" aria-label="Printed since" />}
      </div>

      <Card>
        {loading ? (
          <div className="grid place-items-center py-14"><Spinner /></div>
        ) : view === 'due' ? (
          rows.length === 0 ? <EmptyState title={`No ${ordinal[letter]} letters due today`} /> : (
            <Table>
              <thead>
                <tr>
                  <Th><SelectAll ids={rows.map((r) => r.id)} sel={sel} /></Th>
                  <Th>Receipt</Th><Th>Customer</Th><Th>Scheme</Th><Th>Maturity</Th><Th>Letter due</Th>
                  <Th className="text-right">Days overdue</Th><Th className="text-right">Capital</Th><Th className="text-right">Arrears</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="cursor-pointer hover:bg-secondary/50" onClick={() => sel.toggle(r.id)}>
                    <Td><input type="checkbox" checked={sel.has(r.id)} onChange={() => sel.toggle(r.id)} onClick={(e) => e.stopPropagation()} className="size-4" aria-label={`Select ${r.receipt_no}`} /></Td>
                    <TicketCells t={r} />
                    <Td>{r.due_date}</Td>
                    <Td className="text-right">{r.days_overdue}</Td>
                    <Td className="text-right tabular-nums">{formatMoney(r.principal_current)}</Td>
                    <Td className="text-right tabular-nums">{formatMoney(r.arrears)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )
        ) : issuedRows.length === 0 ? <EmptyState title="No letters printed in this period" /> : (
          <Table>
            <thead>
              <tr>
                <Th><SelectAll ids={issuedRows.map((r) => r.id)} sel={sel} /></Th>
                <Th>Receipt</Th><Th>Customer</Th><Th>Scheme</Th><Th>Maturity</Th><Th>Printed</Th><Th>By</Th>
                <Th className="text-right">Postage</Th><Th>Reprints</Th>
              </tr>
            </thead>
            <tbody>
              {issuedRows.map((r) => (
                <tr key={r.id} className={cn('cursor-pointer hover:bg-secondary/50', !r.current_cycle && 'opacity-60')} onClick={() => sel.toggle(r.id)}>
                  <Td><input type="checkbox" checked={sel.has(r.id)} onChange={() => sel.toggle(r.id)} onClick={(e) => e.stopPropagation()} className="size-4" aria-label="Select letter" /></Td>
                  <TicketCells t={r.ticket} />
                  <Td className="text-xs">{new Date(r.issued_at).toLocaleString()}</Td>
                  <Td>{r.issued_by}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(r.postage_charge)}</Td>
                  <Td>{r.reprint_count}{!r.current_cycle && <Badge>paid since</Badge>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  )
}
