import type { Money, SchemeVersion } from '@/lib/types'

export type Statement = {
  calculation_date: string
  days: number
  principal: Money
  gross_interest: Money
  paid_interest: Money
  carried_interest: Money
  interest: Money
  service_charge: Money
  letter_charges: Record<string, Money>
  letter_charge: Money
  arrears_total: Money
  redemption_total: Money
}

export type TicketItem = {
  id: number
  category: string | null
  article_type: string | null
  condition: string | null
  karat: string | null
  description: string | null
  quantity: number
  gross_weight: string
  net_weight: string
  density_reading: string | null
  karat_rate_per_8g: Money
  assessed_value: Money
  status: string
}

export type TicketTxn = {
  id: number
  txn_no: string
  type: 'pawn' | 'opening' | 'part_payment' | 'renewal' | 'redemption' | 'rounding' | 'cancellation'
  txn_at: string
  interest_days: number
  principal_before: Money
  interest_due: Money
  interest_paid: Money
  interest_capitalised: Money
  service_charge: Money
  postage_charge: Money
  stamp_duty: Money
  discount: Money
  principal_paid: Money
  principal_added: Money
  principal_after: Money
  cash_received: Money
  cash_paid: Money
  new_maturity_date: string | null
  remarks: string | null
  created_by: string | null
}

export type TicketStatus = 'active' | 'redeemed' | 'forfeited' | 'cancelled'

export type PawnTicket = {
  id: number
  branch?: { id: number; code: string; name: string }
  receipt_no: string
  ticket_no: string
  stock_no: string
  legacy_receipt_no: string | null
  is_opening: boolean
  status: TicketStatus
  arrears_stage: string
  is_blocked: boolean
  block_reason: string | null
  pawn_date: string
  cycle_start_date: string
  maturity_date: string
  is_overdue: boolean
  valid_months: number
  gross_weight: string
  net_weight: string
  assessed_value: Money
  market_value: Money
  principal_original: Money
  principal_current: Money
  monthly_interest_rate: string
  scheme?: { id: number; code: string; name: string; interest_method: string }
  scheme_version?: SchemeVersion
  customer?: { id: number; code: string; title: string | null; full_name: string; nic: string; phone1: string; address: string }
  items?: TicketItem[]
  transactions?: TicketTxn[]
  events?: { type: string; at: string; description: string | null; amount: Money | null; user: string | null }[]
  letters?: { cycle_no: number; letter_no: number; due_date: string; issued_at: string; postage_charge: Money }[]
  statement?: Statement
  created_by?: string | null
  created_at: string
}

export type PawnQuote = {
  items: { assessed_value: Money; market_value: Money; karat_rate_per_8g: Money }[]
  assessed_value: Money
  market_value: Money
  gross_weight: string
  net_weight: string
  is_silver: boolean
  scheme: { id: number; code: string; name: string; version_id: number }
  monthly_rate: string
  max_loan: Money
  term_capacities: Record<string, Money>
  max_term: number
}

export const txnLabel: Record<TicketTxn['type'], string> = {
  pawn: 'Pawn',
  opening: 'Opening balance',
  part_payment: 'Part payment',
  renewal: 'Renewal',
  redemption: 'Redemption',
  rounding: 'Cash rounding',
  cancellation: 'Cancellation',
}

export const statusTone = (s: TicketStatus) =>
  s === 'active' ? 'success' : s === 'redeemed' ? 'primary' : s === 'forfeited' ? 'danger' : 'neutral'
