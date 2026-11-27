/** What each Sampath document can print: its fields, its tables, and sample values for the designer preview. */
import { A4, A5, type PrintSize } from './paper'
import type { DesignDocumentKey, DocData, TableColumn, TableRow } from './types'

export interface FieldInfo {
  key: string
  label: string
  sample: string
}

export interface TableInfo {
  source: string
  label: string
  /** Every column the table can show; `width` and `align` are the starting values. */
  columns: (TableColumn & { label: string })[]
  sample: (index: number) => TableRow
}

export interface DocumentInfo {
  key: DesignDocumentKey
  label: string
  /** Starting paper for a new design. */
  paper: PrintSize
  fields: FieldInfo[]
  tables: TableInfo[]
}

const f = (key: string, label: string, sample: string): FieldInfo => ({ key, label, sample })
const col = (key: string, label: string, width: number, align: 'left' | 'center' | 'right' = 'left') => ({ key, label, width, align })

const COMMON: FieldInfo[] = [
  f('company.name', 'Company name', 'Sampath Pawning (Pvt) Ltd'),
  f('company.address', 'Company address', 'No. 25, Main Street, Balangoda'),
  f('company.phone', 'Company phone', '045 228 7000'),
  f('company.email', 'Company email', 'info@sampathpawning.lk'),
  f('company.receipt_footer', 'Receipt footer (Company settings)', 'Articles not redeemed within the term may be forfeited.'),
  f('branch.name', 'Branch name', 'Balangoda'),
  f('branch.phone', 'Branch phone', '045 228 7001'),
  f('branch.address', 'Branch address', 'Main Street, Balangoda'),
  f('printed_at', 'Printed date and time', '27/11/2026, 10:30:00'),
]

const CUSTOMER: FieldInfo[] = [
  f('customer.name', 'Customer name', 'Mrs. Nadeesha Perera'),
  f('customer.nic', 'Customer NIC', '200009503267'),
  f('customer.phone', 'Customer phone', '077 123 4567'),
  f('customer.address', 'Customer address', '12, Temple Road, Balangoda'),
]

const ARTICLES = ['Chain', 'Wedding ring', 'Bangle', 'Pendant', 'Earring']

const articleTable: TableInfo = {
  source: 'items',
  label: 'Articles',
  columns: [
    col('article', 'Article', 40),
    col('karat', 'Karat', 12),
    col('qty', 'Qty', 8, 'right'),
    col('net', 'Net g', 16, 'right'),
    col('value', 'Value', 24, 'right'),
    col('no', '#', 6),
    col('gross', 'Gross g', 16, 'right'),
  ],
  sample: (i) => ({
    no: String(i + 1),
    article: `${ARTICLES[i % ARTICLES.length]} (Good)`,
    karat: '22K',
    qty: '1',
    gross: (8.4 + i).toFixed(3),
    net: (8.1 + i).toFixed(3),
    value: (186400 - i * 12000).toLocaleString(),
  }),
}

const BASE: DocumentInfo[] = [
  {
    key: 'pawn_ticket',
    label: 'Pawn ticket',
    paper: A5,
    fields: [
      f('title', 'Title', 'PAWN TICKET'),
      f('receipt_no', 'Receipt number', 'BAL-000123'),
      f('stock_no', 'Stock number', 'S-004512'),
      f('pawn_date', 'Pawn date', '2026-11-27'),
      f('maturity_date', 'Maturity date', '2027-11-27'),
      f('valid_months', 'Term (months)', '12'),
      f('scheme', 'Scheme code', 'GL-A'),
      f('interest_terms', 'Interest terms', '2% up to 30 days, 2.5% up to 90 days, then 3% per month'),
      f('loan_amount', 'Loan amount', 'Rs. 180,000.00'),
      f('total_net_weight', 'Total net weight (g)', '13.650'),
      f('total_value', 'Total article value', '248,700'),
      ...CUSTOMER,
      f('created_by', 'Issued by', 'K. Perera'),
    ],
    tables: [articleTable],
  },
  {
    key: 'pawn_receipt',
    label: 'Payment receipt (part payment / renewal / redemption)',
    paper: A5,
    fields: [
      f('title', 'Title (by receipt type)', 'PART PAYMENT RECEIPT'),
      f('txn_type', 'Receipt type', 'Part payment'),
      f('txn_no', 'Transaction number', 'TX-000981'),
      f('txn_date', 'Date and time', '27/11/2026, 10:30:00'),
      f('receipt_no', 'Pawn receipt number', 'BAL-000123'),
      ...CUSTOMER,
      f('capital_before', 'Capital before', 'Rs. 180,000.00'),
      f('interest_days', 'Interest days', '45'),
      f('interest_due', 'Interest due', 'Rs. 6,750.00'),
      f('service_charge', 'Service charge', 'Rs. 100.00'),
      f('postage_charge', 'Letter postage', 'Rs. 0.00'),
      f('stamp_duty', 'Stamp duty', 'Rs. 0.00'),
      f('discount', 'Discount', 'Rs. 0.00'),
      f('interest_paid', 'Interest paid', 'Rs. 6,750.00'),
      f('capital_repaid', 'Capital repaid', 'Rs. 50,000.00'),
      f('capital_added', 'Added to capital', 'Rs. 0.00'),
      f('cash_received', 'Cash received', 'Rs. 56,850.00'),
      f('cash_paid', 'Cash paid to customer', 'Rs. 0.00'),
      f('capital_now', 'Capital now', 'Rs. 130,000.00'),
      f('next_maturity', 'Next maturity', '2027-11-27'),
      f('remarks', 'Remarks', ''),
      f('cashier', 'Cashier', 'K. Perera'),
    ],
    tables: [
      {
        source: 'lines',
        label: 'Amount lines (only the non-zero ones)',
        columns: [col('label', 'Description', 65), col('amount', 'Amount', 35, 'right')],
        sample: (i) =>
          [
            { label: 'Capital before', amount: 'Rs. 180,000.00' },
            { label: 'Interest (45 days)', amount: 'Rs. 6,750.00' },
            { label: 'Service charge', amount: 'Rs. 100.00' },
            { label: 'Capital repaid', amount: 'Rs. 50,000.00' },
            { label: 'Cash received', amount: 'Rs. 56,850.00' },
            { label: 'Capital now', amount: 'Rs. 130,000.00' },
          ][i % 6],
      },
      articleTable,
    ],
  },
  {
    key: 'arrears_letter',
    label: 'Arrears letter (1st / 2nd / 3rd notice)',
    paper: A5,
    fields: [
      f('title', 'Letter title', 'FIRST NOTICE OF ARREARS — PAWN RECEIPT BAL-000123'),
      f('letter_no', 'Letter number (1–3)', '1'),
      f('date', 'Letter date', '2026-11-27'),
      f('customer.name', 'Customer name', 'Mrs. Nadeesha Perera'),
      f('customer.address', 'Customer address (lines)', '12, Temple Road,\nBalangoda'),
      f('receipt_no', 'Pawn receipt number', 'BAL-000123'),
      f('stock_no', 'Stock number', 'S-004512'),
      f('pawn_date', 'Pawn date', '2025-11-27'),
      f('maturity_date', 'Maturity date', '2026-11-27'),
      f('capital', 'Capital', 'Rs. 180,000.00'),
      f('interest', 'Interest', 'Rs. 54,000.00'),
      f('service_charge', 'Service charge', 'Rs. 100.00'),
      f('letter_charge', 'Letter / postage charges', 'Rs. 150.00'),
      f('arrears', 'Arrears (to keep the loan)', 'Rs. 54,250.00'),
      f('total', 'Total to redeem', 'Rs. 234,250.00'),
      f(
        'body',
        'Standard letter text',
        'Dear customer, the pawn loan on receipt BAL-000123 (stock S-004512) dated 2025-11-27 matured on 2026-11-27. Please settle the arrears below, or redeem your articles, at your earliest convenience.',
      ),
      f('final_notice', 'Final-notice warning (3rd letter only)', 'This is the final notice. If the arrears are not settled, the pledged articles may be forfeited without further notice.'),
    ],
    tables: [],
  },
  {
    key: 'sales_invoice',
    label: 'Sales invoice',
    paper: A5,
    fields: [
      f('title', 'Title', 'SALES INVOICE'),
      f('void_mark', 'VOID mark (empty unless voided)', 'VOID'),
      f('invoice_no', 'Invoice number', 'INV-000045'),
      f('invoice_date', 'Invoice date and time', '27/11/2026, 10:30:00'),
      f('customer.name', 'Customer name', 'Mr. Sample Customer'),
      f('customer.phone', 'Customer phone', '077 123 4567'),
      f('gross', 'Gross amount', 'Rs. 96,000.00'),
      f('discount', 'Discount', 'Rs. 1,000.00'),
      f('total', 'Total', 'Rs. 95,000.00'),
      f('paid_cash', 'Paid in cash', 'Rs. 45,000.00'),
      f('paid_card', 'Paid by card', 'Rs. 50,000.00'),
      f('cashier', 'Cashier', 'K. Perera'),
    ],
    tables: [
      {
        source: 'items',
        label: 'Invoice lines',
        columns: [
          col('code', 'Item', 22),
          col('article', 'Article', 36),
          col('net', 'Net g', 16, 'right'),
          col('amount', 'Amount', 26, 'right'),
          col('karat', 'Karat', 12),
          col('price', 'Unit price', 20, 'right'),
          col('discount', 'Discount', 16, 'right'),
        ],
        sample: (i) => ({
          code: `IT-${String(i + 101).padStart(5, '0')}`,
          article: `${ARTICLES[i % ARTICLES.length]} · 22K`,
          karat: '22K',
          net: (8.1 + i).toFixed(3),
          price: '48,000.00',
          discount: i === 0 ? '1,000.00' : '0.00',
          amount: i === 0 ? '47,000.00' : '48,000.00',
        }),
      },
    ],
  },
  {
    key: 'stock_transfer',
    label: 'Forfeited stock transfer sheet',
    paper: A4,
    fields: [
      f('title', 'Title', 'FORFEITED ARTICLES — TRANSFER TO SALE STOCK'),
      f('batch_no', 'Batch number', 'TR-000012'),
      f('transferred_at', 'Transferred at', '27/11/2026, 10:30:00'),
      f('transferred_by', 'Transferred by', 'K. Perera'),
      f('notes', 'Notes', ''),
      f('item_count', 'Number of items', '3'),
      f('total_cost', 'Total cost', '412,000'),
      f('total_sale', 'Total sale price', '465,000'),
    ],
    tables: [
      {
        source: 'items',
        label: 'Transferred items',
        columns: [
          col('code', 'Item code', 14),
          col('receipt', 'Receipt', 13),
          col('article', 'Article', 21),
          col('karat', 'Karat', 8),
          col('qty', 'Qty', 6, 'right'),
          col('net', 'Net g', 11, 'right'),
          col('cost', 'Cost', 13, 'right'),
          col('sale', 'Sale price', 14, 'right'),
        ],
        sample: (i) => ({
          code: `IT-${String(i + 101).padStart(5, '0')}`,
          receipt: `BAL-${String(i + 90).padStart(6, '0')}`,
          article: ARTICLES[i % ARTICLES.length],
          karat: '22K',
          qty: '1',
          net: (8.1 + i).toFixed(3),
          cost: '137,000',
          sale: '155,000',
        }),
      },
    ],
  },
]

/** Every document also gets the company / branch fields. */
export const DOCUMENTS: DocumentInfo[] = BASE.map((info) => ({ ...info, fields: [...info.fields, ...COMMON] }))

export const DOCUMENT_MAP = Object.fromEntries(DOCUMENTS.map((d) => [d.key, d])) as Record<DesignDocumentKey, DocumentInfo>

/** Made-up values used by the designer preview. */
export function sampleData(key: DesignDocumentKey, rows: number, logo?: string | null): DocData {
  const info = DOCUMENT_MAP[key]
  return {
    fields: Object.fromEntries(info.fields.map((field) => [field.key, field.sample])),
    tables: Object.fromEntries(info.tables.map((table) => [table.source, Array.from({ length: rows }, (_, i) => table.sample(i))])),
    logo,
  }
}
