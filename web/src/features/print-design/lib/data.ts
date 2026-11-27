/**
 * Turns each print page's API record into the fields and rows a design can place.
 * Field keys match lib/catalog.ts. Company / branch / printed_at are added by withCommonFields.
 */
import { txnLabel, type PawnTicket, type TicketTxn } from '@/features/pawning/types'
import { formatMoney } from '@/lib/utils'
import type { DocData, TableRow } from './types'

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v))
const n = (v: unknown) => Number(v ?? 0)
const grams = (v: unknown) => n(v).toFixed(3)
const plain = (v: unknown) => n(v).toLocaleString()
const money2 = (v: unknown) => n(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function customerFields(c?: { title?: string | null; full_name?: string; nic?: string; phone1?: string; address?: string } | null) {
  return {
    'customer.name': [c?.title, c?.full_name].filter(Boolean).join(' '),
    'customer.nic': s(c?.nic),
    'customer.phone': s(c?.phone1),
    'customer.address': s(c?.address),
  }
}

function articleRows(t: PawnTicket): TableRow[] {
  return (t.items ?? []).map((i, idx) => ({
    no: String(idx + 1),
    article: `${i.article_type ?? i.category}${i.condition ? ` (${i.condition})` : ''}`,
    karat: s(i.karat),
    qty: s(i.quantity),
    gross: grams(i.gross_weight),
    net: grams(i.net_weight),
    value: plain(i.assessed_value),
  }))
}

export function ticketDoc(t: PawnTicket): DocData {
  const v = t.scheme_version
  return {
    fields: {
      title: 'PAWN TICKET',
      receipt_no: t.receipt_no,
      stock_no: t.stock_no,
      pawn_date: t.pawn_date,
      maturity_date: t.maturity_date,
      valid_months: s(t.valid_months),
      scheme: s(t.scheme?.code),
      interest_terms: v ? `${n(v.rate1)}% up to ${v.period1_days} days, ${n(v.rate2)}% up to ${v.period2_days} days, then ${n(v.rate3)}% per month` : '',
      loan_amount: formatMoney(t.principal_original),
      total_net_weight: grams(t.net_weight),
      total_value: plain(t.assessed_value),
      created_by: s(t.created_by),
      ...customerFields(t.customer),
    },
    tables: { items: articleRows(t) },
  }
}

export function receiptDoc(x: TicketTxn & { creator?: { name: string } }, t: PawnTicket): DocData {
  const lines: TableRow[] = []
  const add = (label: string, value: unknown, show = n(value) > 0) => show && lines.push({ label, amount: formatMoney(s(value)) })
  add('Capital before', x.principal_before)
  add(`Interest (${x.interest_days} days)`, x.interest_due)
  add('Service charge', x.service_charge)
  add('Letter postage', x.postage_charge)
  add('Stamp duty', x.stamp_duty)
  if (n(x.discount) > 0) lines.push({ label: 'Discount', amount: `− ${formatMoney(x.discount)}` })
  add('Interest paid', x.interest_paid, n(x.interest_paid) > 0 && x.type === 'part_payment')
  add('Capital repaid', x.principal_paid)
  add('Added to capital', x.principal_added, n(x.principal_added) > 0 && x.type !== 'pawn')
  add('Cash received', x.cash_received)
  add('Cash paid to customer', x.cash_paid)
  const label = txnLabel[x.type] ?? x.type

  return {
    fields: {
      title: `${label} receipt`.toUpperCase(),
      txn_type: label,
      txn_no: x.txn_no,
      txn_date: new Date(x.txn_at).toLocaleString(),
      receipt_no: t.receipt_no,
      capital_before: formatMoney(x.principal_before),
      interest_days: s(x.interest_days),
      interest_due: formatMoney(x.interest_due),
      service_charge: formatMoney(x.service_charge),
      postage_charge: formatMoney(x.postage_charge),
      stamp_duty: formatMoney(x.stamp_duty),
      discount: formatMoney(x.discount),
      interest_paid: formatMoney(x.interest_paid),
      capital_repaid: formatMoney(x.principal_paid),
      capital_added: formatMoney(x.principal_added),
      cash_received: formatMoney(x.cash_received),
      cash_paid: formatMoney(x.cash_paid),
      capital_now: formatMoney(x.principal_after),
      next_maturity: s(x.new_maturity_date),
      remarks: s(x.remarks),
      cashier: s(x.creator?.name ?? x.created_by),
      ...customerFields(t.customer),
    },
    tables: { lines, items: x.type === 'pawn' ? articleRows(t) : [] },
  }
}

const ORDINAL = ['', 'FIRST', 'SECOND', 'THIRD']

export type LetterInput = {
  letter_no: number
  issued_at: string
  ticket: { receipt_no: string; stock_no: string; pawn_date: string; maturity_date: string }
  customer: { name: string; address: string[] }
  capital: string
  interest: string
  service_charge: string
  letter_charge: string
  arrears: string
  total: string
}

export function letterDoc(l: LetterInput): DocData {
  return {
    fields: {
      title: `${ORDINAL[l.letter_no] ?? ''} NOTICE OF ARREARS — PAWN RECEIPT ${l.ticket.receipt_no}`.trim(),
      letter_no: s(l.letter_no),
      date: l.issued_at,
      'customer.name': l.customer.name,
      'customer.address': l.customer.address.join('\n'),
      receipt_no: l.ticket.receipt_no,
      stock_no: l.ticket.stock_no,
      pawn_date: l.ticket.pawn_date,
      maturity_date: l.ticket.maturity_date,
      capital: formatMoney(l.capital),
      interest: formatMoney(l.interest),
      service_charge: formatMoney(l.service_charge),
      letter_charge: formatMoney(l.letter_charge),
      arrears: formatMoney(l.arrears),
      total: formatMoney(l.total),
      body: `Dear customer, the pawn loan on receipt ${l.ticket.receipt_no} (stock ${l.ticket.stock_no}) dated ${l.ticket.pawn_date} matured on ${l.ticket.maturity_date}. Please settle the arrears below, or redeem your articles, at your earliest convenience.`,
      final_notice:
        l.letter_no === 3 ? 'This is the final notice. If the arrears are not settled, the pledged articles may be forfeited without further notice.' : '',
    },
    tables: {},
  }
}

export type InvoiceInput = {
  invoice_no: string
  invoice_date: string
  status: string
  customer_name: string | null
  customer_phone: string | null
  gross_amount: string
  discount: string
  net_amount: string
  paid_cash: string
  paid_card: string
  creator?: { name: string } | null
  lines: { unit_price: string; discount: string; line_total: string; item: { item_code: string; net_weight: string; category?: { name: string }; article_type?: { name: string } | null; karat?: { name: string } } }[]
}

export function invoiceDoc(i: InvoiceInput): DocData {
  return {
    fields: {
      title: 'SALES INVOICE',
      void_mark: i.status === 'voided' ? 'VOID' : '',
      invoice_no: i.invoice_no,
      invoice_date: new Date(i.invoice_date).toLocaleString(),
      'customer.name': s(i.customer_name),
      'customer.phone': s(i.customer_phone),
      gross: formatMoney(i.gross_amount),
      discount: formatMoney(i.discount),
      total: formatMoney(i.net_amount),
      paid_cash: formatMoney(i.paid_cash),
      paid_card: formatMoney(i.paid_card),
      cashier: s(i.creator?.name),
    },
    tables: {
      items: i.lines.map((l) => ({
        code: l.item.item_code,
        article: `${l.item.article_type?.name ?? l.item.category?.name ?? ''}${l.item.karat ? ` · ${l.item.karat.name}` : ''}`,
        karat: s(l.item.karat?.name),
        net: grams(l.item.net_weight),
        price: money2(l.unit_price),
        discount: money2(l.discount),
        amount: money2(l.line_total),
      })),
    },
    watermark: i.status === 'voided' ? 'VOID' : null,
  }
}

export type TransferInput = {
  batch: { batch_no: string; transferred_at: string; user: string | null; notes: string | null }
  items: { item_code: string; receipt_no: string | null; category: string | null; article_type: string | null; karat: string | null; quantity: number; net_weight: string; cost_price: string; sale_price: string }[]
}

export function transferDoc(d: TransferInput): DocData {
  return {
    fields: {
      title: 'FORFEITED ARTICLES — TRANSFER TO SALE STOCK',
      batch_no: d.batch.batch_no,
      transferred_at: new Date(d.batch.transferred_at).toLocaleString(),
      transferred_by: s(d.batch.user),
      notes: s(d.batch.notes),
      item_count: String(d.items.length),
      total_cost: plain(d.items.reduce((sum, i) => sum + n(i.cost_price), 0)),
      total_sale: plain(d.items.reduce((sum, i) => sum + n(i.sale_price), 0)),
    },
    tables: {
      items: d.items.map((i) => ({
        code: i.item_code,
        receipt: s(i.receipt_no),
        article: s(i.article_type ?? i.category),
        karat: s(i.karat),
        qty: s(i.quantity),
        net: grams(i.net_weight),
        cost: plain(i.cost_price),
        sale: plain(i.sale_price),
      })),
    },
  }
}
