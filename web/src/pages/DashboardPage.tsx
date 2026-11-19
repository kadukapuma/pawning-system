import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Banknote, FileWarning, Gem, Package, ReceiptText, RefreshCw, Wallet } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Button, Card, Spinner, Table, Td, Th } from '@/components/ui'
import { useAuth } from '@/features/auth/AuthProvider'
import { api } from '@/lib/api'
import { formatMoney } from '@/lib/utils'

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

const compact = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${Math.round(v / 1e3)}k` : String(v))

export function DashboardPage() {
  const { user, currentBranch, can } = useAuth()
  const navigate = useNavigate()
  const [all, setAll] = useState(false)
  const [showTable, setShowTable] = useState(false)
  const dash = useQuery({
    queryKey: ['dashboard', all],
    queryFn: async () => (await api.get<{ data: Dashboard }>('/api/v1/dashboard', { params: { branch: all ? 'all' : undefined } })).data.data,
    refetchInterval: 60_000,
  })
  const d = dash.data
  const trend = (d?.trend ?? []).map((r) => ({ ...r, lent: Number(r.lent), collected: Number(r.collected), label: r.date.slice(5) }))

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Good {greeting()}, {user?.name.split(' ')[0]}</h1>
          <p className="text-sm text-muted-foreground">{all ? 'All branches' : `${currentBranch?.code} · ${currentBranch?.name}`} · {d?.as_of}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {can('reports.all_branches') && (
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={all} onChange={(e) => setAll(e.target.checked)} /> All branches</label>
          )}
          {can('pawn.create') && <Button onClick={() => navigate('/pawning/new')}><Gem className="size-4" /> New pawn</Button>}
          {can('pawn.redeem') && <Button variant="secondary" onClick={() => navigate('/pawning/redeem')}><Banknote className="size-4" /> Redeem</Button>}
          {can('pawn.part_payment') && <Button variant="secondary" onClick={() => navigate('/pawning/part-payment')}><Wallet className="size-4" /> Part payment</Button>}
        </div>
      </div>

      {!d ? <div className="grid place-items-center py-20"><Spinner /></div> : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label="Outstanding capital" value={formatMoney(d.active.capital)} sub={`${d.active.tickets} active tickets · ${Number(d.active.net_weight).toFixed(1)} g`} />
            <Tile label="Overdue" value={formatMoney(d.overdue.capital)} sub={`${d.overdue.tickets} tickets past maturity`} warn={d.overdue.tickets > 0} to="/pawning/search" />
            <Tile label="Cash in hand" value={formatMoney(d.cash_in_hand)} sub="Book balance" to={can('accounting.view') ? '/accounting/cash-book' : undefined} />
            <Tile label="Income this month" value={formatMoney(d.income_this_month)} sub="Interest, charges and sales" />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Mini icon={<Gem className="size-4" />} label="Pawns today" value={d.today.pawns} sub={formatMoney(d.today.lent)} />
            <Mini icon={<Banknote className="size-4" />} label="Redemptions today" value={d.today.redemptions} sub={formatMoney(d.today.redeemed)} />
            <Mini icon={<Wallet className="size-4" />} label="Part payments today" value={d.today.part_payments} sub={formatMoney(d.today.part_paid)} />
            <Mini icon={<RefreshCw className="size-4" />} label="Renewals today" value={d.today.renewals} />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="p-5 lg:col-span-2">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Cash lent vs collected — last 30 days</h2>
                <Button size="sm" variant="ghost" onClick={() => setShowTable((s) => !s)}>{showTable ? 'Chart' : 'Table'}</Button>
              </div>
              {showTable ? (
                <div className="max-h-72 overflow-y-auto">
                  <Table>
                    <thead><tr><Th>Date</Th><Th className="text-right">Pawns</Th><Th className="text-right">Lent</Th><Th className="text-right">Collected</Th></tr></thead>
                    <tbody>{[...trend].reverse().map((r) => (
                      <tr key={r.date}><Td>{r.date}</Td><Td className="text-right">{r.pawns}</Td><Td className="text-right tabular-nums">{formatMoney(r.lent)}</Td><Td className="text-right tabular-nums">{formatMoney(r.collected)}</Td></tr>
                    ))}</tbody>
                  </Table>
                </div>
              ) : (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={trend} barGap={2} margin={{ left: 8, right: 8 }}>
                      <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--chart-axis)' }} tickLine={false} axisLine={false} interval={4} />
                      <YAxis tickFormatter={compact} tick={{ fontSize: 11, fill: 'var(--chart-axis)' }} tickLine={false} axisLine={false} width={44} />
                      <Tooltip
                        cursor={{ fill: 'var(--secondary)' }}
                        contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--foreground)' }}
                        formatter={(v, name) => [formatMoney(Number(v)), String(name)]}
                        labelFormatter={(l) => `Date ${String(l)}`}
                      />
                      <Legend iconType="circle" wrapperStyle={{ fontSize: 12, color: 'var(--muted-foreground)' }} />
                      <Bar dataKey="lent" name="Cash lent" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={14} />
                      <Bar dataKey="collected" name="Cash collected" fill="var(--chart-2)" radius={[4, 4, 0, 0]} maxBarSize={14} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>

            <Card className="p-5">
              <h2 className="mb-3 text-sm font-semibold">Outstanding by scheme</h2>
              <div className="space-y-3">
                {d.schemes.map((s) => {
                  const max = Math.max(...d.schemes.map((x) => Number(x.capital)), 1)
                  return (
                    <div key={s.scheme}>
                      <div className="flex justify-between text-sm"><span className="font-medium">Scheme {s.scheme}</span><span className="tabular-nums">{formatMoney(s.capital)}</span></div>
                      <div className="mt-1 h-2 rounded-full bg-secondary"><div className="h-2 rounded-full bg-[var(--chart-1)]" style={{ width: `${(Number(s.capital) / max) * 100}%` }} /></div>
                      <p className="text-xs text-muted-foreground">{s.tickets} tickets</p>
                    </div>
                  )
                })}
                {d.schemes.length === 0 && <p className="text-sm text-muted-foreground">No active tickets.</p>}
              </div>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="p-5 lg:col-span-2">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><FileWarning className="size-4" /> Arrears pipeline (active tickets)</h2>
              <div className="grid grid-cols-5 gap-2 text-center">
                {([['1st letter', d.arrears.letter_1, '/arrears/letters'], ['2nd letter', d.arrears.letter_2, '/arrears/letters'], ['3rd letter', d.arrears.letter_3, '/arrears/letters'],
                  ['Reminder', d.arrears.reminder, '/arrears/reminders'], ['Forfeit queue', d.arrears.forfeit_queued, '/forfeit/queue']] as const).map(([l, n, to]) => (
                  <Link key={l} to={to} className="rounded-lg border p-3 hover:bg-secondary">
                    <p className="text-2xl font-semibold tabular-nums">{n}</p>
                    <p className="text-xs text-muted-foreground">{l}</p>
                  </Link>
                ))}
              </div>
            </Card>
            <Card className="space-y-3 p-5">
              <h2 className="text-sm font-semibold">Other</h2>
              <Link to="/inventory" className="flex items-center justify-between rounded-md p-2 text-sm hover:bg-secondary">
                <span className="flex items-center gap-2"><Package className="size-4" /> Sale stock</span>
                <span className="tabular-nums">{d.stock.items} · {formatMoney(d.stock.value)}</span>
              </Link>
              <Link to="/accounting/vouchers" className="flex items-center justify-between rounded-md p-2 text-sm hover:bg-secondary">
                <span className="flex items-center gap-2"><ReceiptText className="size-4" /> Vouchers awaiting approval</span>
                <span className="tabular-nums">{d.pending_vouchers}</span>
              </Link>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'
}

function Tile({ label, value, sub, warn, to }: { label: string; value: string; sub: string; warn?: boolean; to?: string }) {
  const body = (
    <Card className="h-full p-4 hover:shadow-md">
      <p className="flex items-center gap-1 text-xs text-muted-foreground">{warn && <AlertTriangle className="size-3.5 text-destructive" />}{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{sub}</p>
    </Card>
  )
  return to ? <Link to={to}>{body}</Link> : body
}

function Mini({ icon, label, value, sub }: { icon: ReactNode; label: string; value: number; sub?: string }) {
  return (
    <Card className="flex items-center gap-3 p-4">
      <span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">{icon}</span>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="font-semibold tabular-nums">{value}{sub && <span className="ml-2 text-xs font-normal text-muted-foreground">{sub}</span>}</p>
      </div>
    </Card>
  )
}
