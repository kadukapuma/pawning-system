import type { SchemeVersion } from '@/lib/types'

export type SchemeFormValues = Record<string, string>

/** Scheme term keys accepted by the API. */
export const TERM_KEYS = [
  'min_amount', 'max_amount', 'valid_days', 'max_term_months',
  'period1_days', 'rate1', 'period2_days', 'rate2', 'period3_days', 'rate3', 'penalty_rate_monthly',
  'service_charge', 'service_charge_threshold', 'service_charge_below_threshold', 'service_charge_above_percent',
  'document_charge', 'stamp_duty', 'postage_charge', 'min_capital_after_part_payment',
  'letter_1_days', 'letter_2_days', 'letter_3_days', 'forfeit_reminder_days',
] as const

/** Values for terms the chosen method ignores (hidden on the form), used when left empty. */
const NEUTRAL: Record<string, string> = {
  min_amount: '0', valid_days: '0', max_term_months: '12', period1_days: '0', rate1: '0', period2_days: '0',
  period3_days: '30', rate2: '0', rate3: '0', penalty_rate_monthly: '0', service_charge_threshold: '0',
  service_charge_below_threshold: '0', service_charge_above_percent: '0', document_charge: '0',
  stamp_duty: '0', letter_1_days: '0',
}

/** Form values from a scheme version (or empty values for a blank form). */
export function valuesFrom(v: SchemeVersion | null | undefined): SchemeFormValues {
  const out: SchemeFormValues = Object.fromEntries(
    TERM_KEYS.map((k) => {
      const raw = v?.[k]
      // Show "2.5000" as "2.5" and "60.00" as "60".
      return [k, raw === null || raw === undefined ? '' : String(Number(raw))]
    }),
  )
  out.no_limit = v && v.max_amount === null ? '1' : '0'
  return out
}

/** API body: blanks in hidden terms get neutral values; "No upper limit" sends max_amount = null. */
export function toPayload(form: SchemeFormValues): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  for (const [k, v] of Object.entries(form)) {
    if (k === 'no_limit') continue
    out[k] = v === '' ? (NEUTRAL[k] ?? null) : v
  }
  if (form.no_limit === '1') out.max_amount = null
  if (out.interest_method) out.metal = out.interest_method === 'silver' ? 'silver' : 'gold'
  return out
}
