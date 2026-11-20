import { ArrowDown, ArrowUp, Minus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Spinner } from '@/components/ui'
import { useApiQuery } from '@/lib/hooks'
import type { KaratRate } from '@/lib/types'
import { cn, formatMoney } from '@/lib/utils'

/** The four rate types, each with a fixed chart colour slot (never re-coloured when one is hidden). */
const RATE_SERIES = [
  { key: 'pawn_rate_per_8g', label: 'Pawn rate', color: 'var(--chart-1)' },
  { key: 'assess_rate_per_8g', label: 'Assess rate', color: 'var(--chart-2)' },
  { key: 'market_rate_per_8g', label: 'Market rate', color: 'var(--chart-3)' },
  { key: 'sale_rate_per_8g', label: 'Sale rate', color: 'var(--chart-4)' },
] as const
type SeriesKey = (typeof RATE_SERIES)[number]['key']

const RANGES = [
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '1 year' },
  { days: 0, label: 'All' },
] as const

const DAY = 86_400_000
const plain = (v: number | string | null | undefined) => formatMoney(v).replace('Rs. ', '')
const compact = new Intl.NumberFormat('en-LK', { notation: 'compact', maximumFractionDigits: 1 })
const shortDate = (t: number) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
const longDate = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

type Point = { t: number } & Record<SeriesKey, number>

/** Shows the change in a value as an arrow and a signed difference, e.g. "▲ 2,000". */
export function RateDelta({ now, before, className }: { now: number; before: number; className?: string }) {
  const diff = now - before
  if (!Number.isFinite(diff) || diff === 0) {
    return (
      <span className={cn('inline-flex items-center gap-0.5 text-muted-foreground', className)}>
        <Minus className="size-3" aria-hidden /> no change
      </span>
    )
  }
  const up = diff > 0
  return (
    <span className={cn('inline-flex items-center gap-0.5 font-medium', up ? 'text-success' : 'text-destructive', className)}>
      {up ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />}
      <span className="sr-only">{up ? 'up' : 'down'}</span>
      {plain(Math.abs(diff))}
      {before > 0 && <span className="font-normal opacity-80">({up ? '+' : '−'}{((Math.abs(diff) / before) * 100).toFixed(1)}%)</span>}
    </span>
  )
}

/**
 * Step-line chart of one grade's rates over time. Rates stay fixed until the
 * next change, so lines step rather than slope between changes.
 */
export function RateTrendChart({ karatId, height = 280 }: { karatId: number; height?: number }) {
  const [days, setDays] = useState<number>(90)
  const [hidden, setHidden] = useState<Set<SeriesKey>>(new Set())
  const history = useApiQuery<KaratRate[]>(
    ['karats', karatId, 'rates', days],
    `/api/v1/karats/${karatId}/rates${days ? `?days=${days}` : ''}`,
  )

  const { points, first, last, start, end } = useMemo(() => {
    // "Now" = when this data was fetched (keeps render pure; refetches move it forward).
    const end = history.dataUpdatedAt
    const rows = [...(history.data ?? [])].sort(
      (a, b) => new Date(a.effective_from).getTime() - new Date(b.effective_from).getTime() || a.id - b.id,
    )
    const windowStart = days ? end - days * DAY : rows.length ? new Date(rows[0].effective_from).getTime() : end
    const points: Point[] = rows.map((r) => ({
      // The rate in force when the window opened is drawn from the window's left edge.
      t: Math.max(new Date(r.effective_from).getTime(), windowStart),
      pawn_rate_per_8g: Number(r.pawn_rate_per_8g),
      assess_rate_per_8g: Number(r.assess_rate_per_8g),
      market_rate_per_8g: Number(r.market_rate_per_8g),
      sale_rate_per_8g: Number(r.sale_rate_per_8g),
    }))
    const last = points.at(-1)
    // Carry the current rate through to today so the line reaches the right edge.
    if (last && last.t < end) points.push({ ...last, t: end })
    return { points, first: points[0], last, start: windowStart, end }
  }, [history.data, history.dataUpdatedAt, days])

  const changes = Math.max(0, (history.data?.length ?? 0) - (days && history.data?.length ? 1 : 0))
  const toggle = (k: SeriesKey) =>
    setHidden((h) => {
      const next = new Set(h)
      if (next.has(k)) next.delete(k)
      else if (next.size < RATE_SERIES.length - 1) next.add(k) // keep at least one line visible
      return next
    })

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {history.isPending ? 'Loading…' : `${changes} rate change${changes === 1 ? '' : 's'} in this period`}
        </p>
        <div className="inline-flex rounded-md border border-border p-0.5" role="group" aria-label="Time range">
          {RANGES.map((r) => (
            <button
              key={r.days}
              type="button"
              onClick={() => setDays(r.days)}
              aria-pressed={days === r.days}
              className={cn(
                'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                days === r.days ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary',
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Legend: series identity + value now + change over the selected period. Click to show/hide. */}
      <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {RATE_SERIES.map((s) => {
          const off = hidden.has(s.key)
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => toggle(s.key)}
              aria-pressed={!off}
              className={cn(
                'rounded-lg border border-border px-3 py-2 text-left transition-opacity hover:bg-secondary/60',
                off && 'opacity-45',
              )}
            >
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="h-0.5 w-4 rounded-full" style={{ background: s.color }} aria-hidden />
                {s.label}
              </div>
              <div className="mt-0.5 text-sm font-semibold tabular-nums">{last ? plain(last[s.key]) : '—'}</div>
              {first && last && <RateDelta now={last[s.key]} before={first[s.key]} className="text-xs" />}
            </button>
          )
        })}
      </div>

      <div style={{ height }}>
        {history.isPending ? (
          <div className="grid h-full place-items-center"><Spinner /></div>
        ) : points.length === 0 ? (
          <div className="grid h-full place-items-center text-sm text-muted-foreground">No rates recorded yet.</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
              <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={[start, end]}
                tickFormatter={shortDate}
                tick={{ fontSize: 11, fill: 'var(--chart-axis)' }}
                tickLine={false}
                axisLine={false}
                minTickGap={32}
              />
              <YAxis
                domain={[(min: number) => Math.floor(min * 0.97), (max: number) => Math.ceil(max * 1.03)]}
                tickFormatter={(v: number) => compact.format(v)}
                tick={{ fontSize: 11, fill: 'var(--chart-axis)' }}
                tickLine={false}
                axisLine={false}
                width={48}
              />
              <Tooltip
                cursor={{ stroke: 'var(--chart-axis)', strokeDasharray: '3 3' }}
                contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--foreground)' }}
                labelFormatter={(t) => longDate(Number(t))}
                formatter={(v, name) => [formatMoney(Number(v)), String(name)]}
              />
              {RATE_SERIES.filter((s) => !hidden.has(s.key)).map((s) => (
                <Line
                  key={s.key}
                  dataKey={s.key}
                  name={s.label}
                  type="stepAfter"
                  stroke={s.color}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)' }}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
