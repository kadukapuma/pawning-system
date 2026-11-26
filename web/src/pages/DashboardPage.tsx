import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Banknote,
  CalendarClock,
  Gem,
  Package,
  Plus,
  ReceiptText,
  RefreshCw,
  Search,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useNavLayout } from '@/components/layout/navLayout'
import { Spinner, Table, Td, Th } from '@/components/ui'
import { useAuth } from '@/features/auth/AuthProvider'
import type { PawnTicket } from '@/features/pawning/types'
import { api } from '@/lib/api'
import { cn, formatMoney } from '@/lib/utils'

type Dashboard = {
  as_of: string
  active: { tickets: number; capital: string; net_weight: string }
  overdue: { tickets: number; capital: string }
  today: { pawns: number; lent: string; redemptions: number; redeemed: string; part_payments: number; part_paid: string; renewals: number }
  cash_in_hand: string
  income_this_month: string
  arrears: { letter_1: number; letter_2: number; letter_3: number; reminder: number; forfeit_queued: number }
  stock: { items: number; value: string }
  trend: { date: string; lent: string; collected: string; pawns: number }[]
  schemes: { scheme: string; tickets: number; capital: string }[]
  pending_vouchers: number
}

/* ================================================================ helpers */

/** 12_345_678 → { value: "12.3", unit: "M" } — for the oversized headline numbers. */
function big(v: number | string): { value: string; unit: string } {
  const n = Number(v) || 0
  if (Math.abs(n) >= 1e6) return { value: (n / 1e6).toFixed(n >= 1e8 ? 0 : 1), unit: 'M' }
  if (Math.abs(n) >= 1e3) return { value: (n / 1e3).toFixed(n >= 1e5 ? 0 : 1), unit: 'k' }
  return { value: n.toFixed(0), unit: '' }
}
const compact = (v: number) => {
  const b = big(v)
  return b.value + b.unit
}
const initials = (name = '') =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('')
const daysUntil = (iso: string) => Math.round((new Date(iso).getTime() - new Date(new Date().toDateString()).getTime()) / 86_400_000)

/* ================================================================ page */

export function DashboardPage() {
  const { currentBranch, can } = useAuth()
  const navigate = useNavigate()
  const [all, setAll] = useState(false)
  const dash = useQuery({
    queryKey: ['dashboard', all],
    queryFn: async () => (await api.get<{ data: Dashboard }>('/api/v1/dashboard', { params: { branch: all ? 'all' : undefined } })).data.data,
    refetchInterval: 60_000,
  })
  const d = dash.data
  const weight = Number(d?.active.net_weight) || 0
  const { sidebar } = useNavLayout()

  /*
   * Three columns need ~1280px of content width. With the sidebar open that
   * only happens at 2xl; with it hidden (dock mode) it happens at xl. In the
   * three-column layout the page fits exactly one screen (below the top bar,
   * the left icon rail sits beside it in dock mode).
   */
  const L = sidebar
    ? {
        root: '2xl:h-[calc(100vh-5.5rem)] 2xl:min-h-[40rem]',
        grid: 'xl:grid-cols-[17rem_minmax(0,1fr)] 2xl:grid-cols-[17rem_minmax(0,1fr)_22rem]',
        left: 'lg:grid-cols-3 xl:grid-cols-1 2xl:overflow-y-auto',
        right: 'xl:col-span-2 2xl:col-span-1',
      }
    : {
        root: 'xl:h-[calc(100vh-5.5rem)] xl:min-h-[40rem]',
        grid: 'lg:grid-cols-[17rem_minmax(0,1fr)] xl:grid-cols-[17rem_minmax(0,1fr)_22rem]',
        left: 'lg:grid-cols-1 xl:overflow-y-auto',
        right: 'lg:col-span-2 xl:col-span-1',
      }

  return (
    <div className={cn('mx-auto flex max-w-[1680px] flex-col gap-4', L.root)}>
      {/* ---------- Headline strip: oversized KPIs + page tools */}
      <header className="flex flex-wrap items-center gap-x-8 gap-y-4 px-1">
        <div className="grid w-full flex-1 grid-cols-2 gap-x-8 gap-y-3 md:grid-cols-4 xl:w-auto">
          <p className="col-span-full -mb-1 text-[11px] text-muted-foreground">
            {all ? 'All branches' : `${currentBranch?.code} · ${currentBranch?.name}`}
            {d && ` · ${d.as_of}`}
          </p>
          {d ? (
            <>
              <Kpi label="Active tickets" value={String(d.active.tickets)} unit={`/ ${weight.toFixed(0)} g`} />
              <Kpi label="Outstanding capital" {...big(d.active.capital)} prefix="Rs" />
              <Kpi label="Overdue tickets" value={String(d.overdue.tickets)} unit={`· Rs ${compact(Number(d.overdue.capital))}`} warn={d.overdue.tickets > 0} />
              <Kpi label="Income this month" {...big(d.income_this_month)} prefix="Rs" />
            </>
          ) : (
            <span className="col-span-4 h-14" />
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {can('reports.all_branches') && (
            <label className="glass flex h-10 cursor-pointer items-center gap-2 rounded-full px-3.5 text-xs font-medium" title="Show figures for all branches">
              <input type="checkbox" className="size-3.5 accent-[var(--primary)]" checked={all} onChange={(e) => setAll(e.target.checked)} />
              All branches
            </label>
          )}
          {can('pawn.create') && <RoundIcon icon={Plus} label="New pawn" onClick={() => navigate('/pawning/new')} />}
        </div>
      </header>

      {!d ? (
        <div className="grid flex-1 place-items-center py-24"><Spinner /></div>
      ) : (
        <div className={cn('grid min-h-0 flex-1 gap-4', L.grid)}>
          {/* ---------- Left: stacked panels */}
          <div className={cn('grid min-h-0 content-start gap-4 sm:grid-cols-2', L.left)}>
            <TodayPanel d={d} />
            <ArrearsPanel d={d} />
            <StockPanel d={d} />
          </div>

          {/* ---------- Centre: counter + cash flow + latest tickets */}
          <div className="flex min-h-0 min-w-0 flex-col gap-4">
            <CounterPanel />
            <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-2 2xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
              <CashFlowPanel d={d} />
              {can('pawn.view') && <RecentTickets />}
            </div>
          </div>

          {/* ---------- Right: what needs attention */}
          <div className={cn('min-h-0', L.right)}>
            <AttentionPanel d={d} />
          </div>
        </div>
      )}
    </div>
  )
}

/* ================================================================ top bar bits */

function Kpi({ label, value, unit, prefix, warn }: { label: string; value: string; unit?: string; prefix?: string; warn?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
        {warn && <span className="size-1.5 shrink-0 rounded-full bg-destructive" />}
        {label}
      </p>
      <p className="mt-0.5 flex items-baseline gap-1 whitespace-nowrap">
        {prefix && <span className="text-sm font-light text-muted-foreground">{prefix}</span>}
        <span className={cn('text-[2.6rem] leading-none font-extralight tracking-tight tabular-nums', warn && 'text-destructive')}>{value}</span>
        {unit && <span className="truncate text-base font-light text-muted-foreground">{unit}</span>}
      </p>
    </div>
  )
}

function RoundIcon({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className="glass grid size-10 place-items-center rounded-full transition hover:bg-popover">
      <Icon className="size-4" />
    </button>
  )
}

function Panel({ title, to, action, className, children }: { title: string; to?: string; action?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={cn('glass rounded-2xl p-4', className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-xs font-medium">{title}</h2>
        {action}
        {to && (
          <Link to={to} aria-label={`Open ${title}`} className="-m-1 rounded-full p-1 text-muted-foreground transition hover:bg-secondary hover:text-foreground">
            <ArrowUpRight className="size-3.5" />
          </Link>
        )}
      </div>
      {children}
    </section>
  )
}

/* ================================================================ left panels */

function TodayPanel({ d }: { d: Dashboard }) {
  const { can } = useAuth()
  const rows = [
    { label: 'Lent', n: d.today.pawns, v: Number(d.today.lent), tone: 'bg-[var(--chart-1)]' },
    { label: 'Redeemed', n: d.today.redemptions, v: Number(d.today.redeemed), tone: 'bg-[var(--chart-2)]' },
    { label: 'Part paid', n: d.today.part_payments, v: Number(d.today.part_paid), tone: 'bg-glow' },
  ]
  const max = Math.max(...rows.map((r) => r.v), 1)
  return (
    <Panel title="Today at the counter" to={can('accounting.view') ? '/accounting/cash-book' : undefined}>
      <div className="flex items-end justify-between gap-3">
        <dl className="space-y-1.5 text-[11px]">
          <div><dt className="text-muted-foreground">Renewals</dt><dd className="text-sm font-medium tabular-nums">{d.today.renewals}</dd></div>
          <div><dt className="text-muted-foreground">Cash in hand</dt><dd className="text-sm font-medium tabular-nums">{compact(Number(d.cash_in_hand))}</dd></div>
        </dl>
        <div className="text-right">
          <p className="text-[11px] text-muted-foreground">New pawns</p>
          <p className="text-5xl leading-none font-extralight tabular-nums">{d.today.pawns}</p>
        </div>
      </div>
      <div className="mt-4 space-y-2.5">
        {rows.map((r) => (
          <div key={r.label}>
            <div className="flex justify-between text-[11px]">
              <span className="text-muted-foreground">{r.label} · {r.n}</span>
              <span className="tabular-nums">{formatMoney(r.v)}</span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-secondary">
              <div className={cn('h-1.5 rounded-full', r.tone)} style={{ width: `${Math.max(2, (r.v / max) * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </Panel>
  )
}

/* The arrears route as stops on a dashed line. */
function ArrearsPanel({ d }: { d: Dashboard }) {
  const stops = [
    { short: 'L1', label: '1st letter', n: d.arrears.letter_1, to: '/arrears/letters' },
    { short: 'L2', label: '2nd letter', n: d.arrears.letter_2, to: '/arrears/letters' },
    { short: 'L3', label: '3rd letter', n: d.arrears.letter_3, to: '/arrears/letters' },
    { short: 'Rem', label: 'Reminder', n: d.arrears.reminder, to: '/arrears/reminders' },
    { short: 'Forf.', label: 'Forfeit queue', n: d.arrears.forfeit_queued, to: '/forfeit/queue' },
  ]
  const total = stops.reduce((s, x) => s + x.n, 0)
  const peak = stops.reduce((best, s, i) => (s.n > stops[best].n ? i : best), 0)
  return (
    <Panel title="Arrears progress" to="/arrears/letters">
      <div className="relative px-1 pt-7">
        <div className="absolute top-[2.05rem] right-3 left-3 border-t border-dashed border-muted-foreground/40" />
        <div className="relative flex justify-between">
          {stops.map((s, i) => (
            <Link key={s.label} to={s.to} title={`${s.label}: ${s.n}`} className="group relative flex w-8 flex-col items-center">
              {i === peak && total > 0 && (
                <span className="absolute -top-7 rounded-md bg-foreground px-1.5 py-0.5 text-[10px] whitespace-nowrap text-background">{s.label}</span>
              )}
              <span className={cn('rounded-full ring-4 ring-card transition group-hover:scale-125', i === peak && total > 0 ? 'size-3 bg-foreground' : s.n > 0 ? 'size-2 bg-primary' : 'size-2 bg-muted-foreground/40')} />
            </Link>
          ))}
        </div>
      </div>
      <div className="mt-2 flex justify-between px-1 text-center">
        {stops.map((s) => (
          <span key={s.label} className="w-8 text-[10px] leading-tight text-muted-foreground">
            {s.short}
            <b className="block text-xs font-medium text-foreground tabular-nums">{s.n}</b>
          </span>
        ))}
      </div>
      <div className="mt-3 flex justify-between border-t pt-2.5 text-[11px]">
        <span><b className="font-medium tabular-nums">{total}</b> <span className="text-muted-foreground">in pipeline</span></span>
        <span><b className="font-medium tabular-nums">{compact(Number(d.overdue.capital))}</b> <span className="text-muted-foreground">at risk</span></span>
      </div>
    </Panel>
  )
}

function StockPanel({ d }: { d: Dashboard }) {
  const chips: { to: string; icon: LucideIcon; label: string; value: string; warn?: boolean }[] = [
    { to: '/inventory', icon: Package, label: 'Sale stock', value: `${d.stock.items} items` },
    { to: '/inventory', icon: Gem, label: 'Stock value', value: `Rs ${compact(Number(d.stock.value))}` },
    { to: '/accounting/vouchers', icon: ReceiptText, label: 'Vouchers', value: `${d.pending_vouchers} pending`, warn: d.pending_vouchers > 0 },
    { to: '/forfeit/queue', icon: CalendarClock, label: 'To forfeit', value: `${d.arrears.forfeit_queued} tickets` },
  ]
  return (
    <Panel title="Stock & approvals">
      <div className="grid grid-cols-2 gap-2">
        {chips.map((c) => (
          <Link
            key={c.label}
            to={c.to}
            className="flex flex-col gap-2 rounded-xl border border-[var(--glass-edge)] bg-popover/80 p-2.5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          >
            <span className={cn('grid size-6 place-items-center rounded-full', c.warn ? 'bg-destructive/15 text-destructive' : 'bg-primary/12 text-primary')}>
              <c.icon className="size-3" />
            </span>
            <span className="leading-tight">
              <span className="block text-[10px] text-muted-foreground">{c.label}</span>
              <span className="block text-xs font-medium tabular-nums">{c.value}</span>
            </span>
          </Link>
        ))}
      </div>
    </Panel>
  )
}

/* ================================================================ centre */

/** Ticket lookup + the four counter actions — the first thing staff reach for. */
function CounterPanel() {
  const { can } = useAuth()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    navigate(`/pawning/search${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`)
  }
  const actions: { label: string; hint: string; icon: LucideIcon; to: string; perm: string }[] = [
    { label: 'New pawn', hint: 'Issue a ticket', icon: Gem, to: '/pawning/new', perm: 'pawn.create' },
    { label: 'Redeem', hint: 'Close & release', icon: Banknote, to: '/pawning/redeem', perm: 'pawn.redeem' },
    { label: 'Part payment', hint: 'Reduce capital', icon: Wallet, to: '/pawning/part-payment', perm: 'pawn.part_payment' },
    { label: 'Renewal', hint: 'Extend term', icon: RefreshCw, to: '/pawning/renewal', perm: 'pawn.renew' },
  ]
  const visible = actions.filter((a) => can(a.perm))

  return (
    <section className="glass rounded-2xl p-4">
      {can('pawn.view') && (
        <form onSubmit={submit} className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find a ticket — receipt, ticket or stock no., customer NIC or name"
            aria-label="Find a ticket"
            className="h-12 w-full rounded-full border bg-popover/80 pr-28 pl-11 text-sm outline-none transition focus:border-ring focus:ring-4 focus:ring-ring/15"
          />
          <button type="submit" className="absolute top-1.5 right-1.5 flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-xs font-medium text-primary-foreground shadow-[0_6px_16px_-6px_var(--primary)] hover:opacity-90">
            Search <ArrowRight className="size-3.5" />
          </button>
        </form>
      )}
      {visible.length > 0 && (
        <div className={cn('grid grid-cols-2 gap-2 md:grid-cols-4', can('pawn.view') && 'mt-3')}>
          {visible.map((a, i) => (
            <Link
              key={a.to}
              to={a.to}
              className={cn(
                'group flex items-center gap-3 rounded-xl border p-3 transition hover:-translate-y-0.5 hover:shadow-md',
                i === 0 ? 'border-transparent bg-primary text-primary-foreground shadow-[0_8px_20px_-10px_var(--primary)]' : 'border-[var(--glass-edge)] bg-popover/70',
              )}
            >
              <span className={cn('grid size-9 shrink-0 place-items-center rounded-full', i === 0 ? 'bg-white/20' : 'bg-primary/10 text-primary')}>
                <a.icon className="size-4" />
              </span>
              <span className="min-w-0 leading-tight">
                <span className="block truncate text-sm font-medium">{a.label}</span>
                <span className={cn('block truncate text-[11px]', i === 0 ? 'text-primary-foreground/75' : 'text-muted-foreground')}>{a.hint}</span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}

function CashFlowPanel({ d }: { d: Dashboard }) {
  const [showTable, setShowTable] = useState(false)
  const trend = d.trend.map((r) => ({ ...r, lent: Number(r.lent), collected: Number(r.collected), label: r.date.slice(5) }))
  const lent = trend.reduce((s, r) => s + r.lent, 0)
  const collected = trend.reduce((s, r) => s + r.collected, 0)
  const net = collected - lent

  return (
    <Panel
      title="Cash flow · last 30 days"
      className="flex min-h-80 flex-col"
      action={
        <div className="ml-auto flex rounded-full bg-secondary p-0.5 text-[11px]">
          {(['Chart', 'Table'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setShowTable(m === 'Table')}
              className={cn('rounded-full px-2.5 py-1 transition', showTable === (m === 'Table') ? 'bg-popover font-medium shadow-sm' : 'text-muted-foreground')}
            >
              {m}
            </button>
          ))}
        </div>
      }
    >
      <div className="flex flex-wrap items-end gap-x-6 gap-y-1">
        <Stat color="var(--chart-1)" label="Lent" value={compact(lent)} />
        <Stat color="var(--chart-2)" label="Collected" value={compact(collected)} />
        <p className="ml-auto text-[11px] text-muted-foreground">
          Net {net >= 0 ? 'inflow' : 'outflow'}{' '}
          <span className={cn('font-medium tabular-nums', net >= 0 ? 'text-success' : 'text-destructive')}>{formatMoney(Math.abs(net))}</span>
        </p>
      </div>
      <div className="mt-2 min-h-52 flex-1">
        {showTable ? (
          <div className="h-full max-h-80 overflow-y-auto">
            <Table>
              <thead><tr><Th>Date</Th><Th className="text-right">Pawns</Th><Th className="text-right">Lent</Th><Th className="text-right">Collected</Th></tr></thead>
              <tbody>{[...trend].reverse().map((r) => (
                <tr key={r.date}>
                  <Td className="text-xs">{r.date}</Td>
                  <Td className="text-right text-xs tabular-nums">{r.pawns}</Td>
                  <Td className="text-right text-xs tabular-nums">{formatMoney(r.lent)}</Td>
                  <Td className="text-right text-xs tabular-nums">{formatMoney(r.collected)}</Td>
                </tr>
              ))}</tbody>
            </Table>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trend} margin={{ left: 0, right: 4, top: 8 }}>
              <defs>
                <linearGradient id="cf-lent" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="var(--chart-1)" stopOpacity={0.35} />
                  <stop offset="1" stopColor="var(--chart-1)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="cf-coll" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="var(--chart-2)" stopOpacity={0.3} />
                  <stop offset="1" stopColor="var(--chart-2)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 4" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--chart-axis)' }} tickLine={false} axisLine={false} interval={4} />
              <YAxis tickFormatter={compact} tick={{ fontSize: 10, fill: 'var(--chart-axis)' }} tickLine={false} axisLine={false} width={36} />
              <Tooltip
                cursor={{ stroke: 'var(--chart-axis)', strokeDasharray: '3 3' }}
                contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12, color: 'var(--foreground)' }}
                formatter={(v, name) => [formatMoney(Number(v)), String(name)]}
                labelFormatter={(l) => `Date ${String(l)}`}
              />
              <Area type="monotone" dataKey="lent" name="Cash lent" stroke="var(--chart-1)" strokeWidth={2} fill="url(#cf-lent)" />
              <Area type="monotone" dataKey="collected" name="Cash collected" stroke="var(--chart-2)" strokeWidth={2} fill="url(#cf-coll)" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </Panel>
  )
}

function Stat({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className="size-2 rounded-full" style={{ background: color }} />
        {label}
      </p>
      <p className="text-3xl leading-tight font-extralight tabular-nums">{value}</p>
    </div>
  )
}

/** The most recent tickets issued — click through to the ticket. */
function RecentTickets() {
  const list = useQuery({
    queryKey: ['dashboard-tickets', 'recent'],
    queryFn: async () => (await api.get<{ data: PawnTicket[] }>('/api/v1/pawn-tickets', { params: { status: 'active' } })).data.data,
    refetchInterval: 60_000,
  })
  const rows = (list.data ?? []).slice(0, 7)
  return (
    <Panel title="Latest tickets" to="/pawning/search" className="flex min-h-80 flex-col">
      {list.isLoading ? (
        <div className="grid flex-1 place-items-center"><Spinner /></div>
      ) : rows.length === 0 ? (
        <p className="grid flex-1 place-items-center text-sm text-muted-foreground">No active tickets yet.</p>
      ) : (
        <ul className="-mx-1 flex-1 space-y-0.5 overflow-y-auto">
          {rows.map((t) => (
            <li key={t.id}>
              <TicketRow t={t} right={<span className="text-[11px] text-muted-foreground">{t.pawn_date}</span>} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function TicketRow({ t, right }: { t: PawnTicket; right: ReactNode }) {
  return (
    <Link to={`/pawning/tickets/${t.id}`} className="flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-popover/80">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-[10px] font-semibold">{initials(t.customer?.full_name)}</span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-sm">{t.customer?.full_name ?? '—'}</span>
        <span className="block truncate text-[11px] text-muted-foreground">
          {t.ticket_no} · {Number(t.net_weight).toFixed(2)} g{t.scheme && ` · ${t.scheme.code}`}
        </span>
      </span>
      <span className="shrink-0 text-right leading-tight">
        <span className="block text-sm tabular-nums">{compact(Number(t.principal_current))}</span>
        {right}
      </span>
    </Link>
  )
}

/* ================================================================ right */

/** Overdue tickets (most overdue first) and the scheme mix. */
function AttentionPanel({ d }: { d: Dashboard }) {
  const { can } = useAuth()
  const overdue = useQuery({
    queryKey: ['dashboard-tickets', 'overdue'],
    queryFn: async () => (await api.get<{ data: PawnTicket[] }>('/api/v1/pawn-tickets', { params: { overdue: 1 } })).data.data,
    enabled: can('pawn.view'),
    refetchInterval: 60_000,
  })
  const rows = [...(overdue.data ?? [])].sort((a, b) => a.maturity_date.localeCompare(b.maturity_date)).slice(0, 8)
  const schemes = [...d.schemes].sort((a, b) => Number(b.capital) - Number(a.capital))
  const maxCap = Math.max(...schemes.map((s) => Number(s.capital)), 1)

  return (
    <section className="glass flex h-full min-h-[34rem] flex-col overflow-hidden rounded-2xl p-4">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-xs font-medium">
          <AlertTriangle className="size-3.5 text-destructive" /> Needs attention
        </h2>
        <Link to="/pawning/search" className="text-[11px] text-muted-foreground hover:text-foreground">View all</Link>
      </div>
      <p className="mb-3 text-[11px] text-muted-foreground">
        {d.overdue.tickets} overdue · {formatMoney(d.overdue.capital)}
      </p>

      <div className="-mx-1 min-h-40 flex-1 overflow-y-auto">
        {!can('pawn.view') ? null : overdue.isLoading ? (
          <div className="grid h-full place-items-center"><Spinner /></div>
        ) : rows.length === 0 ? (
          <div className="grid h-full place-items-center text-center text-sm text-muted-foreground">
            <span><span className="mx-auto mb-2 block size-2 rounded-full bg-glow shadow-[0_0_10px_var(--glow)]" />Nothing overdue — all clear.</span>
          </div>
        ) : (
          <ul className="space-y-0.5">
            {rows.map((t) => {
              const late = -daysUntil(t.maturity_date)
              return (
                <li key={t.id}>
                  <TicketRow
                    t={t}
                    right={<span className={cn('text-[11px] tabular-nums', late > 30 ? 'text-destructive' : 'text-warning')}>{late} days late</span>}
                  />
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className="mt-3 border-t pt-3">
        <h3 className="mb-2 text-[11px] text-muted-foreground">Outstanding by scheme</h3>
        <div className="space-y-2">
          {schemes.slice(0, 5).map((s) => (
            <div key={s.scheme} className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-2 text-[11px]">
              <span className="truncate font-medium">Scheme {s.scheme}</span>
              <span className="h-1.5 rounded-full bg-secondary">
                <span className="block h-1.5 rounded-full bg-[var(--chart-1)]" style={{ width: `${(Number(s.capital) / maxCap) * 100}%` }} />
              </span>
              <span className="text-muted-foreground tabular-nums">{compact(Number(s.capital))} · {s.tickets}</span>
            </div>
          ))}
          {schemes.length === 0 && <p className="text-[11px] text-muted-foreground">No active tickets.</p>}
        </div>
      </div>
    </section>
  )
}
