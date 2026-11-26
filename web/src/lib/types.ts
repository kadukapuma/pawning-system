/** Shapes returned by the Laravel API (decimals arrive as strings). */

export type Money = string

export type BranchRef = { id: number; code: string; name: string }

export type KaratRate = {
  id: number
  karat_id: number
  effective_from: string
  pawn_rate_per_8g: Money
  assess_rate_per_8g: Money
  market_rate_per_8g: Money
  sale_rate_per_8g: Money
  created_by: number | null
  creator?: { id: number; name: string } | null
}

export type Karat = {
  id: number
  code: string
  name: string
  metal: 'gold' | 'silver'
  purity_karat: string | null
  sort_order: number
  is_active: boolean
  current_rate: KaratRate | null
  /** Rate in force before the current one (index endpoint only). */
  previous_rate?: KaratRate | null
}

export type ArticleCategory = { id: number; name: string; metal: string; is_active?: boolean; types_count?: number }
export type ArticleType = { id: number; category_id: number; code: string; name: string; sub_category?: string | null; is_active?: boolean; category?: { id: number; name: string } }
export type ArticleCondition = { id: number; name: string; is_active?: boolean }

export type SchemeVersion = {
  id: number
  scheme_id: number
  effective_from: string
  effective_to: string | null
  min_amount: Money
  max_amount: Money | null
  valid_days: number
  max_term_months: number
  period1_days: number
  rate1: string
  period2_days: number
  rate2: string
  period3_days: number
  rate3: string
  penalty_rate_monthly: string
  service_charge: Money
  service_charge_below_threshold: Money
  service_charge_above_percent: string
  service_charge_threshold: Money
  document_charge: Money
  stamp_duty: Money
  postage_charge: Money
  letter_1_days: number
  letter_2_days: number
  letter_3_days: number
  forfeit_reminder_days: number
  min_capital_after_part_payment: Money
  created_at: string
  creator?: { id: number; name: string } | null
}

export type Scheme = {
  id: number
  code: string
  name: string
  metal: 'gold' | 'silver'
  interest_method: 'tiered' | 'monthly_penalty' | 'silver'
  is_active: boolean
  current_version: SchemeVersion | null
  versions?: SchemeVersion[]
}

export type BankBranch = { id: number; bank_id: number; code: string; name: string }
export type Bank = { id: number; code: string; name: string; is_active?: boolean; branches: BankBranch[] }

export type CustomerStatus = 'active' | 'inactive' | 'blacklisted'

export type Customer = {
  id: number
  code: string
  title: string | null
  first_name: string
  middle_name: string | null
  last_name: string | null
  full_name: string
  gender: string | null
  nic: string
  driving_license: string | null
  passport: string | null
  other_identification: string | null
  date_of_birth: string | null
  address_line1: string
  address_line2: string | null
  city: string | null
  phone1: string
  phone2: string | null
  email: string | null
  sms_language: 'en' | 'si' | 'ta' | null
  status: CustomerStatus
  pawn_amount_limit: Money | null
  pawn_count_limit: number | null
  notes: string | null
  branch?: BranchRef
  exposure?: { active_tickets: number; outstanding_principal: Money }
  created_at: string
}

export type Lookups = {
  branches: BranchRef[]
  roles: string[]
  karats: Karat[]
  article_categories: ArticleCategory[]
  article_types: ArticleType[]
  article_conditions: ArticleCondition[]
  schemes: Scheme[]
  banks: Bank[]
  customer_statuses: CustomerStatus[]
  customer_titles: string[]
}

export type AdminUser = {
  id: number
  username: string
  name: string
  email: string | null
  phone: string | null
  is_active: boolean
  role: string | null
  branch: BranchRef | null
  branch_ids: number[]
  last_login_at: string | null
}

export type AuditLog = {
  id: number
  user: { id: number; username: string; name: string } | null
  branch_id: number | null
  auditable_type: string
  auditable_id: number
  event: string
  old_values: Record<string, unknown> | null
  new_values: Record<string, unknown> | null
  ip_address: string | null
  created_at: string
}

export type Paginated<T> = {
  data: T[]
  meta: { current_page: number; last_page: number; total: number; from: number | null; to: number | null; per_page: number }
}
