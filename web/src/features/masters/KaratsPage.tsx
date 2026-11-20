import { History, Pencil, Plus, Save, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge, Button, Card, Dialog, Field, Input, PageHeader, Select, Spinner, Table, Td, Th } from '@/components/ui'
import { useAuth } from '@/features/auth/AuthProvider'
import { useApiMutation, useApiQuery } from '@/lib/hooks'
import type { Karat, KaratRate } from '@/lib/types'
import { formatMoney } from '@/lib/utils'
import { RateDelta, RateTrendChart } from './RateTrendChart'

const RATE_FIELDS = [
  ['pawn_rate_per_8g', 'Pawn rate'],
  ['assess_rate_per_8g', 'Assess rate'],
  ['market_rate_per_8g', 'Market rate'],
  ['sale_rate_per_8g', 'Sale rate'],
] as const
type RateField = (typeof RATE_FIELDS)[number][0]
type RateRow = Record<RateField, string>

export function KaratsPage() {
  const { can } = useAuth()
  const karats = useApiQuery<Karat[]>(['karats'], '/api/v1/karats')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Record<number, RateRow>>({})
  const [historyFor, setHistoryFor] = useState<Karat | null>(null)
  const [adding, setAdding] = useState(false)
  const [trendId, setTrendId] = useState<number | null>(null)
  const trendKarat = karats.data?.find((k) => k.id === trendId) ?? karats.data?.[0]

  const save = useApiMutation<{ rates: (RateRow & { karat_id: number })[] }, Karat[]>({
    url: '/api/v1/karat-rates',
    invalidate: [['karats'], ['lookups']],
    success: 'Rates saved',
    onSuccess: () => setEditing(false),
  })

  const startEdit = () => {
    setDraft(
      Object.fromEntries(
        (karats.data ?? []).map((k) => [
          k.id,
          Object.fromEntries(RATE_FIELDS.map(([f]) => [f, k.current_rate?.[f] ?? ''])) as RateRow,
        ]),
      ),
    )
    setEditing(true)
  }

  const submit = () =>
    save.mutate({ rates: Object.entries(draft).map(([id, r]) => ({ karat_id: Number(id), ...r })) })

  return (
    <div>
      <PageHeader
        title="Karats & rates"
        description="All rates are per 8 g (one sovereign). Item value = rate ÷ 8 × weight. Only changed rows create a new rate record."
        actions={
          can('karat_rates.manage') &&
          (editing ? (
            <>
              <Button variant="secondary" onClick={() => setEditing(false)}><X className="size-4" /> Cancel</Button>
              <Button loading={save.isPending} onClick={submit}><Save className="size-4" /> Save rates</Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setAdding(true)}><Plus className="size-4" /> New grade</Button>
              <Button onClick={startEdit}><Pencil className="size-4" /> Update today's rates</Button>
            </>
          ))
        }
      />

      <Card>
        {karats.isPending ? (
          <div className="grid place-items-center py-14"><Spinner /></div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Grade</Th>
                {RATE_FIELDS.map(([, label]) => <Th key={label} className="text-right">{label}</Th>)}
                <Th>Last changed</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {karats.data?.map((k) => (
                <tr key={k.id} className={k.is_active ? '' : 'opacity-50'}>
                  <Td>
                    <div className="font-medium">{k.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {k.code} · {k.metal}{!k.is_active && ' · inactive'}
                    </div>
                  </Td>
                  {RATE_FIELDS.map(([f]) => (
                    <Td key={f} className="text-right tabular-nums">
                      {editing ? (
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          className="ml-auto w-32 text-right"
                          value={draft[k.id]?.[f] ?? ''}
                          onChange={(e) => setDraft((d) => ({ ...d, [k.id]: { ...d[k.id], [f]: e.target.value } }))}
                        />
                      ) : (
                        <>
                          <div>{formatMoney(k.current_rate?.[f]).replace('Rs. ', '')}</div>
                          {k.current_rate && k.previous_rate && (
                            <div className="mt-0.5 text-xs text-muted-foreground">
                              <span title="Previous rate">was {formatMoney(k.previous_rate[f]).replace('Rs. ', '')}</span>
                              <div><RateDelta now={Number(k.current_rate[f])} before={Number(k.previous_rate[f])} /></div>
                            </div>
                          )}
                        </>
                      )}
                    </Td>
                  ))}
                  <Td className="text-xs text-muted-foreground">
                    {k.current_rate ? new Date(k.current_rate.effective_from).toLocaleString() : '—'}
                    {k.current_rate?.creator && <div>by {k.current_rate.creator.name}</div>}
                    {k.previous_rate && <div className="mt-1">previous from {new Date(k.previous_rate.effective_from).toLocaleDateString()}</div>}
                  </Td>
                  <Td>
                    <Button size="sm" variant="ghost" onClick={() => setHistoryFor(k)} aria-label={`History of ${k.code}`}>
                      <History className="size-4" />
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {Object.keys(save.fieldErrors).length > 0 && (
          <p className="px-3 py-2 text-sm text-destructive">Every rate must be a number greater than 0.</p>
        )}
      </Card>

      {trendKarat && (
        <Card className="mt-6 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Rate trend</h2>
              <p className="text-xs text-muted-foreground">How the rates per 8 g of one grade have changed over time.</p>
            </div>
            <Select
              aria-label="Grade"
              className="w-56"
              value={trendKarat.id}
              onChange={(e) => setTrendId(Number(e.target.value))}
            >
              {karats.data?.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
            </Select>
          </div>
          <RateTrendChart key={trendKarat.id} karatId={trendKarat.id} />
        </Card>
      )}

      <RateHistoryDialog karat={historyFor} onClose={() => setHistoryFor(null)} />
      <NewKaratDialog open={adding} onClose={() => setAdding(false)} />
    </div>
  )
}

function RateHistoryDialog({ karat, onClose }: { karat: Karat | null; onClose: () => void }) {
  const history = useApiQuery<KaratRate[]>(['karats', karat?.id, 'rates'], `/api/v1/karats/${karat?.id}/rates`, !!karat)
  return (
    <Dialog open={!!karat} onClose={onClose} size="lg" title={`Rate history — ${karat?.name ?? ''}`}>
      {karat && <div className="mb-5"><RateTrendChart karatId={karat.id} height={240} /></div>}
      {history.isPending ? (
        <Spinner />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>From</Th>
              {RATE_FIELDS.map(([, l]) => <Th key={l} className="text-right">{l}</Th>)}
              <Th>By</Th>
            </tr>
          </thead>
          <tbody>
            {history.data?.map((r, i) => (
              <tr key={r.id}>
                <Td>
                  {new Date(r.effective_from).toLocaleString()} {i === 0 && <Badge tone="success">current</Badge>}
                </Td>
                {RATE_FIELDS.map(([f]) => {
                  const older = history.data?.[i + 1]
                  return (
                    <Td key={f} className="text-right tabular-nums">
                      <div>{formatMoney(r[f]).replace('Rs. ', '')}</div>
                      {older && <RateDelta now={Number(r[f])} before={Number(older[f])} className="text-xs" />}
                    </Td>
                  )
                })}
                <Td>{r.creator?.name ?? 'seed'}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Dialog>
  )
}

function NewKaratDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const blank = { code: '', name: '', metal: 'gold', purity_karat: '22', sort_order: '0', pawn_rate_per_8g: '', assess_rate_per_8g: '', market_rate_per_8g: '', sale_rate_per_8g: '' }
  const [f, setF] = useState(blank)
  const save = useApiMutation<typeof blank>({ url: '/api/v1/karats', invalidate: [['karats'], ['lookups']], success: 'Grade added', onSuccess: onClose })
  useEffect(() => { if (open) setF(blank) }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof typeof blank) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))
  const e = save.fieldErrors

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New karat grade"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate(f)}>Add grade</Button></>}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Code" required error={e.code}><Input value={f.code} onChange={set('code')} placeholder="B5" /></Field>
        <Field label="Name" required error={e.name}><Input value={f.name} onChange={set('name')} placeholder="B5 - 22KT" /></Field>
        <Field label="Metal" error={e.metal}>
          <Select value={f.metal} onChange={set('metal')}><option value="gold">Gold</option><option value="silver">Silver</option></Select>
        </Field>
        <Field label="Purity (karat)" error={e.purity_karat}><Input type="number" value={f.purity_karat} onChange={set('purity_karat')} /></Field>
        {RATE_FIELDS.map(([k, l]) => (
          <Field key={k} label={`${l} per 8 g`} required error={e[k]}>
            <Input type="number" min={0} step="0.01" value={f[k]} onChange={set(k)} />
          </Field>
        ))}
      </div>
    </Dialog>
  )
}
