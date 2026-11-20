import { CalendarDays, CircleAlert, CircleCheck, Coins, Gem, Landmark, Mail, Percent, Scale } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { InfoTip, Input } from '@/components/ui'
import type { Scheme } from '@/lib/types'
import { cn, formatMoney } from '@/lib/utils'
import { TERM_KEYS, type SchemeFormValues } from './schemeTerms'

/* ------------------------------------------------------------------ model */

type Method = Scheme['interest_method']

type Unit = 'Rs.' | '%' | '% / month' | 'days' | 'months'

type FieldDef = { label: string; unit: Unit; help: ReactNode; placeholder?: string }

/** Every scheme term with its label, unit and plain-language help. */
const F = {
  min_amount: {
    label: 'Smallest loan',
    unit: 'Rs.',
    help: <>The lowest loan amount this scheme is used for. A new gold loan is placed in the scheme whose band contains the loan amount.</>,
  },
  max_amount: {
    label: 'Largest loan',
    unit: 'Rs.',
    help: <>The highest loan amount this scheme is used for. Tick <b>No upper limit</b> for the top band. Gold bands must not overlap each other.</>,
  },
  max_term_months: {
    label: 'Longest term',
    unit: 'months',
    help: <>The most months a customer can choose when pawning, renewing or after a part payment (1 – 60). The term offered is also capped by the item value.</>,
  },
  valid_days: {
    label: 'Valid period',
    unit: 'days',
    help: <>Silver: the ticket expires this many days after pawning. Monthly + penalty: penalty interest starts after this many days.</>,
  },
  period1_days: {
    label: 'First tier ends after',
    unit: 'days',
    help: <>If the customer redeems on or before this day, only the first-tier rate is charged, once (flat). Day 1 is the pawn date.</>,
  },
  rate1: {
    label: 'First-tier rate',
    unit: '%',
    help: <>A one-off percentage of the loan for very early redemption. Example: 1% on Rs. 100,000 = Rs. 1,000.</>,
  },
  period2_days: {
    label: 'Second tier ends after',
    unit: 'days',
    help: <>Redeemed after the first tier but on or before this day → the second-tier rate is charged once (flat). Must be ≥ the first tier.</>,
  },
  rate2: {
    label: 'Second-tier rate',
    unit: '%',
    help: <>A one-off percentage of the loan for redemption inside the second tier.</>,
  },
  period3_days: {
    label: 'Days in a month',
    unit: 'days',
    help: <>How many days count as one interest month (normally 30). After the first month, extra days are charged as monthly rate ÷ this number per day.</>,
  },
  rate3: {
    label: 'Monthly rate',
    unit: '% / month',
    help: <>Charged after the tiers: a full month at this rate up to day 30, then this rate per full month plus a daily share for extra days.</>,
  },
  silver_rate: {
    label: 'Monthly rate',
    unit: '% / month',
    help: <>Silver interest per month. The first month is always charged in full; after that it is charged per full month plus a daily share for extra days.</>,
  },
  monthly_rate: {
    label: 'Monthly rate',
    unit: '% / month',
    help: <>Charged for every started month. Example: day 31 counts as 2 months.</>,
  },
  penalty_rate_monthly: {
    label: 'Penalty rate',
    unit: '% / month',
    help: <>Extra interest for every started month after the valid period has passed, on top of the monthly rate.</>,
  },
  service_charge: {
    label: 'Service charge',
    unit: 'Rs.',
    help: <>Fixed amount added when the ticket is redeemed or renewed. Uses the charge in force on that day, so changing it also affects old tickets.</>,
  },
  postage_charge: {
    label: 'Postage per letter',
    unit: 'Rs.',
    help: <>Added to what the customer owes for every arrears letter printed for the ticket.</>,
  },
  stamp_duty: {
    label: 'Stamp duty',
    unit: 'Rs.',
    help: <>Fixed amount added on redemption and renewal. Leave 0 if not charged.</>,
  },
  min_capital_after_part_payment: {
    label: 'Minimum balance after part payment',
    unit: 'Rs.',
    help: <>A part payment cannot bring the loan below this amount. To pay more, the customer must redeem the ticket.</>,
  },
  letter_2_days: {
    label: 'Letter 2 after letter 1',
    unit: 'days',
    help: <>Letter 2 becomes due this many days after letter 1 was actually printed. Printing late pushes the later letters back.</>,
  },
  letter_3_days: {
    label: 'Letter 3 after letter 2',
    unit: 'days',
    help: <>Letter 3 becomes due this many days after letter 2 was printed.</>,
  },
  forfeit_reminder_days: {
    label: 'Forfeit reminder after letter 3',
    unit: 'days',
    help: <>The ticket shows up for forfeit this many days after letter 3, if it is expired and nothing was paid or renewed since.</>,
  },
} satisfies Record<string, FieldDef>

const METHODS: { value: Method; title: string; icon: typeof Gem; text: string }[] = [
  { value: 'tiered', title: 'Gold — tiered', icon: Gem, text: 'Low flat rates for early redemption, then a monthly rate. Picked by loan amount (like A, B, C).' },
  { value: 'monthly_penalty', title: 'Gold — monthly + penalty', icon: Scale, text: 'A rate for every started month, plus a penalty once the valid period is over.' },
  { value: 'silver', title: 'Silver', icon: Coins, text: 'One monthly rate. Used for all silver items; the ticket expires after the valid period.' },
]

/* ------------------------------------------------------------------ maths (mirror of InterestCalculator) */

const num = (v: string | undefined) => (v === undefined || v === '' ? NaN : Number(v))

function interestFor(method: Method, f: SchemeFormValues, principal: number, days: number): number {
  const pct = (rate: number) => (principal * rate) / 100
  const monthly = (rate: number) => {
    const md = num(f.period3_days) > 0 ? num(f.period3_days) : 30
    if (days <= md) return pct(rate)
    return pct(rate * Math.floor(days / md) + (rate / md) * (days % md))
  }
  if (method === 'silver') return monthly(num(f.rate1) || 0)
  if (method === 'monthly_penalty') {
    const md = num(f.period3_days) > 0 ? num(f.period3_days) : 30
    let total = pct(num(f.rate2) || 0) * Math.ceil(days / md)
    const valid = num(f.valid_days) || 0
    if (valid > 0 && days > valid) total += pct(num(f.penalty_rate_monthly) || 0) * Math.ceil((days - valid) / md)
    return total
  }
  if (days <= (num(f.period1_days) || 0)) return pct(num(f.rate1) || 0)
  if (days <= (num(f.period2_days) || 0)) return pct(num(f.rate2) || 0)
  return monthly(num(f.rate3) || 0)
}

type Band = { code: string; min: number; max: number }

/** Problems we can spot before saving (the server checks the same rules). */
function findProblems(method: Method, f: SchemeFormValues, others: Band[]) {
  const p: { field: string; text: ReactNode }[] = []
  const min = num(f.min_amount)
  const max = f.no_limit === '1' ? Infinity : num(f.max_amount)
  if (Number.isFinite(min) && Number.isFinite(max) && max < min) p.push({ field: 'max_amount', text: 'The largest loan is smaller than the smallest loan.' })
  if (method !== 'silver' && Number.isFinite(min) && !Number.isNaN(max)) {
    for (const o of others) {
      if (min <= o.max && o.min <= max) {
        p.push({ field: 'min_amount', text: <>Loan band overlaps scheme <b>{o.code}</b> ({bandText(o.min, o.max)}).</> })
      }
    }
  }
  if (method === 'tiered') {
    const [a, b, c] = [num(f.period1_days), num(f.period2_days), num(f.period3_days)]
    if (a > b || b > c) p.push({ field: 'period2_days', text: 'Tier days must go up: first tier ≤ second tier ≤ days in a month.' })
  }
  return p
}

const money = (n: number) => formatMoney(n)
const bandText = (min: number, max: number) => `${money(min)} – ${Number.isFinite(max) ? money(max) : 'no limit'}`

/* ------------------------------------------------------------------ building blocks */

function Section({ n, icon: Icon, title, text, children }: { n: number; icon: typeof Gem; title: string; text?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border bg-background/60 p-4">
      <header className="mb-3 flex items-start gap-3">
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/12 text-xs font-bold text-primary">{n}</span>
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold"><Icon className="size-4 text-muted-foreground" aria-hidden />{title}</h3>
          {text && <p className="text-xs text-muted-foreground">{text}</p>}
        </div>
      </header>
      {children}
    </section>
  )
}

type Ctx = {
  form: SchemeFormValues
  set: (k: string, v: string) => void
  errors: Record<string, string>
  original?: SchemeFormValues | null
  warn: Set<string>
}

/** Number input with its unit, a help tooltip, error text and a "was …" marker in change mode. */
function Term({ ctx, name, def, label, apiKey, required = true, className, disabled }: {
  ctx: Ctx
  name?: keyof typeof F
  def?: FieldDef
  /** Shorter visible label; the tooltip still shows the full name. */
  label?: string
  apiKey: string
  required?: boolean
  className?: string
  disabled?: boolean
}) {
  const d: FieldDef = def ?? F[(name ?? apiKey) as keyof typeof F]
  const id = `term-${apiKey}`
  const value = ctx.form[apiKey] ?? ''
  const before = ctx.original?.[apiKey]
  const changed = ctx.original != null && before !== undefined && Number(before) !== Number(value) && !(before === '' && value === '')
  const err = ctx.errors[apiKey]
  const prefix = d.unit === 'Rs.'

  return (
    <div className={cn('space-y-1 text-sm', className)}>
      <div className="flex items-center gap-1">
        <label htmlFor={id} className="font-medium">{label ?? d.label}{required && <span className="text-destructive"> *</span>}</label>
        <InfoTip label={d.label}>{d.help}</InfoTip>
      </div>
      <div className="relative">
        {prefix && <span className="pointer-events-none absolute inset-y-0 left-3 grid place-items-center text-xs text-muted-foreground">Rs.</span>}
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          disabled={disabled}
          value={value}
          placeholder={d.placeholder ?? '0'}
          onChange={(e) => ctx.set(apiKey, e.target.value)}
          aria-invalid={!!err || ctx.warn.has(apiKey)}
          className={cn('tabular-nums', prefix ? 'pl-10' : '', !prefix && 'pr-20', changed && 'border-primary bg-primary/5')}
        />
        {!prefix && <span className="pointer-events-none absolute inset-y-0 right-3 grid place-items-center text-xs text-muted-foreground">{d.unit}</span>}
      </div>
      {err ? (
        <p className="text-xs text-destructive">{err}</p>
      ) : changed ? (
        <p className="text-xs text-primary">was {d.unit === 'Rs.' ? money(Number(before)) : `${Number(before)} ${d.unit}`}</p>
      ) : null}
    </div>
  )
}

/** Horizontal bar of the gold loan bands, with the band being edited on top. */
function BandBar({ others, min, max, code }: { others: Band[]; min: number; max: number; code: string }) {
  const finite = [...others.flatMap((o) => [o.min, o.max]), min, max].filter((v) => Number.isFinite(v))
  const scale = Math.max(1, ...finite) * 1.25
  const x = (v: number) => `${(Math.min(Number.isFinite(v) ? v : scale, scale) / scale) * 100}%`
  const w = (a: number, b: number) => `${Math.max(1.5, ((Math.min(Number.isFinite(b) ? b : scale, scale) - a) / scale) * 100)}%`
  const valid = Number.isFinite(min) && !Number.isNaN(max) && max >= min
  const overlaps = (o: Band) => valid && min <= o.max && o.min <= max

  return (
    <div className="mt-3" aria-hidden>
      <div className="mb-1 text-xs text-muted-foreground">Gold loan bands</div>
      <div className="relative h-6 rounded-md bg-secondary">
        {others.map((o) => (
          <div
            key={o.code}
            title={`${o.code}: ${bandText(o.min, o.max)}`}
            className={cn('absolute inset-y-0 grid place-items-center rounded-md border-2 border-card text-[10px] font-semibold', overlaps(o) ? 'bg-destructive/25 text-destructive' : 'bg-muted-foreground/20 text-muted-foreground')}
            style={{ left: x(o.min), width: w(o.min, o.max) }}
          >
            {o.code}{!Number.isFinite(o.max) && ' →'}
          </div>
        ))}
      </div>
      {valid && (
        <div className="relative mt-1 h-6 rounded-md">
          <div className="absolute inset-y-0 grid place-items-center rounded-md bg-primary text-[10px] font-semibold text-primary-foreground" style={{ left: x(min), width: w(min, max) }}>
            {code || 'new'}{!Number.isFinite(max) && ' →'}
          </div>
        </div>
      )}
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground tabular-nums"><span>Rs. 0</span><span>{money(scale).replace('.00', '')}+</span></div>
    </div>
  )
}

/** Arrears letters as a timeline: expiry → letter 1 → 2 → 3 → forfeit. */
function LetterTimeline({ ctx }: { ctx: Ctx }) {
  const steps: [string, string | null][] = [
    ['Expiry date', null],
    ['Letter 1', null],
    ['Letter 2', 'letter_2_days'],
    ['Letter 3', 'letter_3_days'],
    ['Forfeit list', 'forfeit_reminder_days'],
  ]
  return (
    <ol className="grid gap-3 sm:grid-cols-5">
      {steps.map(([title, key], i) => (
        <li key={title} className="relative">
          <div className="flex items-center gap-2 text-xs font-semibold">
            <span className={cn('size-2.5 rounded-full', i === 0 ? 'bg-muted-foreground' : 'bg-primary')} />
            {title}
          </div>
          <div className="mt-1.5 pl-4">
            {key ? (
              <Term ctx={ctx} apiKey={key} label="Days after previous" />
            ) : (
              <p className="pt-1 text-xs text-muted-foreground">{i === 0 ? 'Term ends' : 'Due on the expiry date'}</p>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}

/* ------------------------------------------------------------------ the form */

export function SchemeForm({
  mode,
  form,
  setForm,
  errors,
  schemes,
  self,
  original,
}: {
  mode: 'create' | 'change'
  form: SchemeFormValues
  setForm: React.Dispatch<React.SetStateAction<SchemeFormValues>>
  errors: Record<string, string>
  schemes: Scheme[]
  self?: Scheme | null
  original?: SchemeFormValues | null
}) {
  const method = (form.interest_method ?? self?.interest_method ?? 'tiered') as Method
  const [example, setExample] = useState('')
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }))

  const others: Band[] = useMemo(
    () =>
      schemes
        .filter((s) => s.id !== self?.id && s.is_active && s.metal === 'gold' && s.interest_method !== 'silver' && s.current_version)
        .map((s) => ({
          code: s.code,
          min: Number(s.current_version!.min_amount),
          max: s.current_version!.max_amount === null ? Infinity : Number(s.current_version!.max_amount),
        }))
        .sort((a, b) => a.min - b.min),
    [schemes, self],
  )
  const problems = findProblems(method, form, others)
  const ctx: Ctx = { form, set, errors, original, warn: new Set(problems.map((p) => p.field)) }

  const min = num(form.min_amount)
  const max = form.no_limit === '1' ? Infinity : num(form.max_amount)
  const examplePrincipal = num(example) > 0 ? num(example) : suggestExample(min, max)
  const exampleDays = method === 'tiered'
    ? [num(form.period1_days), num(form.period2_days), 30, 60, 90, 180]
    : [15, 30, 31, 60, 90, 180]
  const days = [...new Set(exampleDays.filter((d) => d > 0))].sort((a, b) => a - b)
  const code = form.code?.toUpperCase() ?? self?.code ?? ''
  const changedCount = original ? TERM_KEYS.filter((k) => original[k] !== undefined && Number(original[k]) !== Number(form[k] ?? '')).length + (original.no_limit !== form.no_limit ? 1 : 0) : 0

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="space-y-4">
        {mode === 'create' && (
          <Section n={1} icon={Landmark} title="What kind of scheme?" text="Choose how interest works. This cannot be changed later.">
            <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Interest method">
              {METHODS.map((m) => {
                const on = method === m.value
                return (
                  <button
                    key={m.value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => set('interest_method', m.value)}
                    className={cn(
                      'rounded-lg border p-3 text-left transition',
                      on ? 'border-primary bg-primary/8 ring-1 ring-primary' : 'hover:bg-secondary',
                    )}
                  >
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <m.icon className={cn('size-4', on ? 'text-primary' : 'text-muted-foreground')} aria-hidden />
                      {m.title}
                      {on && <CircleCheck className="ml-auto size-4 text-primary" aria-hidden />}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{m.text}</p>
                  </button>
                )
              })}
            </div>
            {errors.interest_method && <p className="mt-1 text-xs text-destructive">{errors.interest_method}</p>}

            <div className="mt-4 grid gap-3 sm:grid-cols-[120px_minmax(0,1fr)_170px]">
              <TextTerm label="Code" required help="Short code printed on tickets and used in reports, e.g. A, B, D. Letters, numbers, - and _ only. Cannot be changed later." error={errors.code}>
                <Input id="term-code" value={form.code ?? ''} maxLength={20} placeholder="D" className="uppercase" onChange={(e) => set('code', e.target.value.replace(/[^A-Za-z0-9_-]/g, '').toUpperCase())} />
              </TextTerm>
              <TextTerm label="Name" required help="The name staff see when choosing or reading tickets, e.g. “Type D – monthly”." error={errors.name}>
                <Input id="term-name" value={form.name ?? ''} maxLength={60} placeholder={code ? `Type ${code}` : 'Type D'} onChange={(e) => set('name', e.target.value)} />
              </TextTerm>
              <EffectiveDate ctx={ctx} />
            </div>
          </Section>
        )}

        {mode === 'change' && (
          <div className="flex flex-wrap items-end gap-4 rounded-xl border bg-background/60 p-4">
            <EffectiveDate ctx={ctx} hint="Today or earlier, not before the current version." />
            <p className="max-w-md text-xs text-muted-foreground">
              Saving creates a new version from this date. Tickets already issued keep their interest terms; service charge and postage follow the version in force on the day.
            </p>
          </div>
        )}

        <Section
          n={mode === 'create' ? 2 : 1}
          icon={Coins}
          title={method === 'silver' ? 'Term' : 'Loan amount & term'}
          text={method === 'silver' ? 'Silver items always use the silver scheme, whatever the amount.' : 'Which loan amounts go to this scheme, and for how long.'}
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {method !== 'silver' && (
              <>
                <Term ctx={ctx} apiKey="min_amount" />
                <div className="space-y-1">
                  <Term ctx={ctx} apiKey="max_amount" required={false} disabled={form.no_limit === '1'} />
                  <label className="flex items-center gap-2 text-xs">
                    <input type="checkbox" className="size-3.5 accent-[var(--primary)]" checked={form.no_limit === '1'} onChange={(e) => set('no_limit', e.target.checked ? '1' : '0')} />
                    No upper limit
                  </label>
                </div>
              </>
            )}
            <Term ctx={ctx} apiKey="max_term_months" />
            {method !== 'tiered' && <Term ctx={ctx} apiKey="valid_days" />}
          </div>
          {method !== 'silver' && <BandBar others={others} min={min} max={max} code={code} />}
        </Section>

        <Section n={mode === 'create' ? 3 : 2} icon={Percent} title="Interest" text={INTEREST_INTRO[method]}>
          {method === 'tiered' && (
            <div className="space-y-3">
              <TierRow step="1" text="Redeemed early — flat rate, charged once">
                <Term ctx={ctx} apiKey="period1_days" />
                <Term ctx={ctx} apiKey="rate1" />
              </TierRow>
              <TierRow step="2" text="Redeemed a bit later — flat rate, charged once">
                <Term ctx={ctx} apiKey="period2_days" />
                <Term ctx={ctx} apiKey="rate2" />
              </TierRow>
              <TierRow step="3" text="After that — monthly rate">
                <Term ctx={ctx} apiKey="rate3" />
                <Term ctx={ctx} apiKey="period3_days" />
              </TierRow>
            </div>
          )}
          {method === 'silver' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Term ctx={ctx} apiKey="rate1" name="silver_rate" />
              <Term ctx={ctx} apiKey="period3_days" />
            </div>
          )}
          {method === 'monthly_penalty' && (
            <div className="grid gap-3 sm:grid-cols-3">
              <Term ctx={ctx} apiKey="rate2" name="monthly_rate" />
              <Term ctx={ctx} apiKey="penalty_rate_monthly" />
              <Term ctx={ctx} apiKey="period3_days" />
            </div>
          )}
        </Section>

        <Section n={mode === 'create' ? 4 : 3} icon={Coins} title="Charges" text="Fixed amounts added on top of interest.">
          <div className="grid gap-3 sm:grid-cols-2">
            <Term ctx={ctx} apiKey="service_charge" />
            <Term ctx={ctx} apiKey="postage_charge" />
            <Term ctx={ctx} apiKey="stamp_duty" />
            <Term ctx={ctx} apiKey="min_capital_after_part_payment" />
          </div>
        </Section>

        <Section n={mode === 'create' ? 5 : 4} icon={Mail} title="Arrears letters" text="When reminder letters fall due for an expired ticket that has not been settled.">
          <LetterTimeline ctx={ctx} />
        </Section>
      </div>

      {/* Live summary */}
      <aside className="space-y-3 lg:sticky lg:top-0 lg:self-start">
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2">
            <span className="grid size-9 place-items-center rounded-lg bg-accent text-sm font-bold text-accent-foreground">{code || '?'}</span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{form.name || self?.name || 'New scheme'}</p>
              <p className="text-xs text-muted-foreground">{METHODS.find((m) => m.value === method)?.title}</p>
            </div>
          </div>
          {method !== 'silver' && (
            <p className="mt-3 text-xs text-muted-foreground">
              Loans <span className="font-medium text-foreground tabular-nums">{Number.isFinite(min) ? bandText(min, max) : '—'}</span>
            </p>
          )}
          {mode === 'change' && (
            <p className="mt-2 text-xs">
              {changedCount ? <span className="font-medium text-primary">{changedCount} value{changedCount === 1 ? '' : 's'} changed</span> : <span className="text-muted-foreground">No changes yet</span>}
            </p>
          )}
        </div>

        <div className="rounded-xl border bg-card p-4">
          <div className="mb-2 flex items-center gap-1">
            <h4 className="text-sm font-semibold">Interest preview</h4>
            <InfoTip label="Interest preview">An estimate using the rates on this form, before service charge, postage and stamp duty. The ticket screens show the exact amount.</InfoTip>
          </div>
          <label className="mb-2 block text-xs text-muted-foreground" htmlFor="example-loan">For a loan of</label>
          <div className="relative mb-3">
            <span className="pointer-events-none absolute inset-y-0 left-3 grid place-items-center text-xs text-muted-foreground">Rs.</span>
            <Input id="example-loan" type="number" min={1} className="pl-10 tabular-nums" value={example} placeholder={String(examplePrincipal)} onChange={(e) => setExample(e.target.value)} />
          </div>
          <table className="w-full text-xs tabular-nums">
            <thead>
              <tr className="text-muted-foreground"><th className="pb-1 text-left font-medium">Redeemed on</th><th className="pb-1 text-right font-medium">Interest</th></tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d} className="border-t">
                  <td className="py-1.5">day {d}</td>
                  <td className="py-1.5 text-right font-medium">{money(interestFor(method, form, examplePrincipal, d))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className={cn('rounded-xl border p-4 text-xs', problems.length ? 'border-destructive/40 bg-destructive/5' : 'bg-card')} aria-live="polite">
          {problems.length ? (
            <ul className="space-y-2">
              {problems.map((p, i) => (
                <li key={i} className="flex gap-2 text-destructive"><CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />{p.text}</li>
              ))}
            </ul>
          ) : (
            <p className="flex items-center gap-2 text-muted-foreground"><CircleCheck className="size-3.5 text-success" aria-hidden />No problems found so far.</p>
          )}
          {method !== 'silver' && problems.some((p) => p.field === 'min_amount') && <FreeRangeHint others={others} />}
        </div>
      </aside>
    </div>
  )
}

const INTEREST_INTRO: Record<Method, string> = {
  tiered: 'Customers who redeem early pay a small flat rate; after that the monthly rate applies.',
  silver: 'One monthly rate. The first month is charged in full, then per day.',
  monthly_penalty: 'The monthly rate for every started month, plus the penalty rate after the valid period.',
}

function suggestExample(min: number, max: number) {
  if (Number.isFinite(min) && Number.isFinite(max) && max > min) return Math.round((min + max) / 2 / 1000) * 1000 || 10000
  if (Number.isFinite(min) && min > 0) return Math.round((min * 1.5) / 1000) * 1000
  return 100000
}

function FreeRangeHint({ others }: { others: Band[] }) {
  const gaps: [number, number][] = []
  let cursor = 0
  for (const o of others) {
    if (o.min > cursor) gaps.push([cursor, o.min - 0.01])
    cursor = Math.max(cursor, Number.isFinite(o.max) ? o.max + 0.01 : Infinity)
  }
  if (Number.isFinite(cursor)) gaps.push([cursor, Infinity])
  return (
    <p className="mt-3 border-t pt-3 text-muted-foreground">
      {gaps.length
        ? <>Free amounts: {gaps.map(([a, b]) => bandText(a, b)).join(', ')}.</>
        : <>Every loan amount is already covered. To add a band, first use <b>Change terms</b> on the top scheme to give it a largest loan.</>}
    </p>
  )
}

function TierRow({ step, text, children }: { step: string; text: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="mb-2 text-xs font-medium text-muted-foreground">
        <span className="mr-1.5 rounded bg-secondary px-1.5 py-0.5 font-semibold text-foreground">Tier {step}</span>{text}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </div>
  )
}

function TextTerm({ label, help, required, error, children }: { label: string; help: string; required?: boolean; error?: string; children: ReactNode }) {
  return (
    <div className="space-y-1 text-sm">
      <div className="flex items-center gap-1">
        <label htmlFor={`term-${label.toLowerCase()}`} className="font-medium">{label}{required && <span className="text-destructive"> *</span>}</label>
        <InfoTip label={label}>{help}</InfoTip>
      </div>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

function EffectiveDate({ ctx, hint }: { ctx: Ctx; hint?: string }) {
  const [maxDate] = useState(() => new Date().toISOString().slice(0, 10))
  return (
    <div className="space-y-1 text-sm">
      <div className="flex items-center gap-1">
        <label htmlFor="term-effective" className="flex items-center gap-1 font-medium"><CalendarDays className="size-3.5 text-muted-foreground" aria-hidden />Starts on</label>
        <InfoTip label="Starts on">The date these terms apply from. Today or an earlier date — future dates are not allowed; make the change on the day it applies.</InfoTip>
      </div>
      <Input id="term-effective" type="date" max={maxDate} value={ctx.form.effective_from ?? ''} onChange={(e) => ctx.set('effective_from', e.target.value)} aria-invalid={!!ctx.errors.effective_from} />
      {ctx.errors.effective_from ? <p className="text-xs text-destructive">{ctx.errors.effective_from}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}
