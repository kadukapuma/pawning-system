import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const lkr = new Intl.NumberFormat('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Format a money value as "Rs. 12,345.00". Accepts API decimal strings. */
export function formatMoney(value: number | string | null | undefined): string {
  const n = typeof value === 'string' ? Number(value) : (value ?? 0)
  return `Rs. ${lkr.format(Number.isFinite(n) ? n : 0)}`
}

/** Format a weight in grams with 3 decimals. */
export function formatWeight(value: number | string | null | undefined): string {
  const n = typeof value === 'string' ? Number(value) : (value ?? 0)
  return `${(Number.isFinite(n) ? n : 0).toFixed(3)} g`
}
