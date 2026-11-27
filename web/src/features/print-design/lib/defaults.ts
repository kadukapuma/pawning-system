/**
 * The starting design of each document: close to today's standard layout, fitted to the
 * chosen paper. The administrator then moves things around.
 */
import { DOCUMENT_MAP } from './catalog'
import type { PrintSize } from './paper'
import type { DesignDocumentKey, DesignElement, PrintTemplate, TableColumn } from './types'

type Extra = Partial<DesignElement>

export function defaultTemplate(key: DesignDocumentKey, paper: PrintSize & Partial<PrintTemplate['paper']> = DOCUMENT_MAP[key].paper): PrintTemplate {
  const roll = paper.height_mm <= 0
  const W = paper.width_mm
  const H = paper.height_mm
  const mx = Math.min(paper.margin_x_mm, W / 6)
  const my = Math.min(paper.margin_y_mm, roll ? 8 : H / 10)
  const width = round(W - mx * 2)
  const elements: DesignElement[] = []
  let counter = 0

  const add = (type: DesignElement['type'], x: number, y: number, w: number, h: number, extra: Extra = {}) => {
    counter += 1
    const element: DesignElement = { id: `${type}-${counter}`, type, x: round(x), y: round(y), w: round(w), h: round(h), ...extra }
    elements.push(element)
    return element
  }
  const t = (x: number, y: number, w: number, h: number, text: string, extra: Extra = {}) => add('text', x, y, w, h, { text, ...extra })
  const line = (y: number, extra: Extra = {}) => add('line', mx, y, width, 0.5, { thickness: 1, ...extra })
  const table = (source: string, keys: string[], y: number, h: number, extra: Extra = {}, opts: { showHeader?: boolean; rowLines?: boolean } = {}) => {
    const info = DOCUMENT_MAP[key].tables.find((item) => item.source === source)!
    const columns: TableColumn[] = keys.map((k) => ({ ...info.columns.find((c) => c.key === k)! }))
    return add('table', mx, y, width, h, {
      table: { source, columns, showHeader: opts.showHeader ?? true, rowLines: opts.rowLines ?? false, columnLines: false },
      ...extra,
    })
  }
  const signatures = (labels: string[], y: number, extra: Extra = {}) => {
    const gap = 8
    const w = (width - gap * (labels.length - 1)) / labels.length
    labels.forEach((label, i) => t(mx + i * (w + gap), y, w, 5, label, { align: 'center', border: 'top', ...extra }))
  }
  /** Centred company heading with the document title and number, like the standard layouts. Returns the y below it. */
  const header = (title: string, number: string) => {
    t(mx, my, width, 6, '{{company.name}}', { align: 'center', bold: true, uppercase: true, fontSize: 12 })
    t(mx, my + 6, width, 5, '{{branch.name}} branch · Tel {{company.phone}}', { align: 'center' })
    t(mx, my + 11.5, width, 5, title, { align: 'center', bold: true, fontSize: 10.5 })
    t(mx, my + 16.5, width, 5, number, { align: 'center' })
    line(my + 22, { thickness: 2 })
    return my + 24
  }
  /** "Label ........ value" row: label left, value right-aligned on the same line. */
  const kv = (y: number, label: string, value: string, extra: Extra = {}) => {
    t(mx, y, width * 0.45, 5, label, extra)
    t(mx + width * 0.45, y, width * 0.55, 5, value, { align: 'right', ...extra })
  }

  const font = 9

  if (key === 'pawn_ticket') {
    let y = header('{{title}}', 'Receipt {{receipt_no}} · Stock {{stock_no}}')
    kv(y, 'Customer', '{{customer.name}}')
    kv(y + 5, 'NIC / Phone', '{{customer.nic}} · {{customer.phone}}')
    kv(y + 10, 'Address', '{{customer.address}}')
    y += 17
    const tableH = 30
    const items = table('items', ['article', 'karat', 'qty', 'net', 'value'], y, tableH, { fontSize: 8.5 })
    const fl = { follows: items.id }
    let a = y + tableH + 1
    kv(a, 'Total', '{{total_net_weight}} g · {{total_value}}', { ...fl, bold: true, border: 'top' })
    a += 7
    kv(a, 'Pawn date', '{{pawn_date}}', fl)
    kv(a + 5, 'Term / maturity', '{{valid_months}} month(s) · {{maturity_date}}', fl)
    kv(a + 10, 'Scheme', '{{scheme}}', fl)
    t(mx, a + 15, width, 9, 'Interest: {{interest_terms}}', { ...fl, fontSize: 8 })
    kv(a + 25, 'Loan amount', '{{loan_amount}}', { ...fl, bold: true, border: 'top', fontSize: 10.5 })
    t(mx, a + 33, width, 8, '{{company.receipt_footer}}', { ...fl, fontSize: 7.5 })
    signatures(['Customer', 'Valuer', 'Authorised officer'], a + 50, fl)
  } else if (key === 'pawn_receipt') {
    let y = header('{{title}}', '{{txn_no}} · Ticket {{receipt_no}}')
    kv(y, 'Date', '{{txn_date}}')
    kv(y + 5, 'Customer', '{{customer.name}} ({{customer.nic}})')
    y += 12
    const lines = table('lines', ['label', 'amount'], y, 34, {}, { showHeader: false })
    const fl = { follows: lines.id }
    const a = y + 35
    kv(a, 'Capital now', '{{capital_now}}', { ...fl, bold: true, border: 'top', fontSize: 10.5 })
    kv(a + 6, 'Next maturity', '{{next_maturity}}', fl)
    t(mx, a + 12, width, 5, 'Remarks: {{remarks}}', { ...fl, fontSize: 8 })
    t(mx, a + 18, width, 5, 'Cashier: {{cashier}}', { ...fl, fontSize: 8 })
    signatures(['Customer', 'Cashier'], a + 34, fl)
  } else if (key === 'arrears_letter') {
    t(mx, my, width, 6, '{{company.name}}', { align: 'center', bold: true, uppercase: true, fontSize: 12 })
    t(mx, my + 6, width, 5, '{{branch.name}} branch · {{branch.address}} · {{branch.phone}}', { align: 'center' })
    line(my + 12, { thickness: 2 })
    let y = my + 15
    t(mx, y, width, 5, '{{date}}', { align: 'right' })
    t(mx, y + 6, width * 0.6, 16, '{{customer.name}}\n{{customer.address}}', { bold: false })
    y += 24
    t(mx, y, width, 10, '{{title}}', { align: 'center', bold: true, underline: true })
    t(mx, y + 11, width, 20, '{{body}}', { fontSize: font })
    y += 33
    kv(y, 'Capital', '{{capital}}')
    kv(y + 5, 'Interest', '{{interest}}')
    kv(y + 10, 'Service charge', '{{service_charge}}')
    kv(y + 15, 'Letter / postage charges', '{{letter_charge}}')
    kv(y + 21, 'Arrears (to keep the loan)', '{{arrears}}', { bold: true, border: 'top' })
    kv(y + 27, 'Total to redeem', '{{total}}', { bold: true })
    t(mx, y + 35, width, 10, '{{final_notice}}', { bold: true })
    t(mx, y + 55, width * 0.5, 5, 'Branch Manager')
  } else if (key === 'sales_invoice') {
    let y = header('{{title}} {{void_mark}}', '{{invoice_no}} · {{invoice_date}}')
    t(mx, y, width, 5, 'Customer: {{customer.name}} · {{customer.phone}}')
    y += 7
    const tableH = 30
    const items = table('items', ['code', 'article', 'net', 'amount'], y, tableH, { fontSize: 8.5 })
    const fl = { follows: items.id }
    const a = y + tableH + 2
    const x = mx + width * 0.45
    const w = width * 0.55
    t(x, a, w, 5, 'Gross: {{gross}}', { ...fl, align: 'right' })
    t(x, a + 5, w, 5, 'Discount: {{discount}}', { ...fl, align: 'right' })
    t(x, a + 10.5, w, 6, 'Total: {{total}}', { ...fl, align: 'right', bold: true, border: 'top', fontSize: 10.5 })
    t(x, a + 17, w, 10, 'Cash: {{paid_cash}}\nCard: {{paid_card}}', { ...fl, align: 'right' })
    t(mx, a + 30, width, 8, '{{company.receipt_footer}}', { ...fl, fontSize: 7.5 })
    t(mx, a + 42, width, 5, 'Cashier: {{cashier}}', { ...fl, fontSize: 8 })
  } else {
    t(mx, my, width, 7, '{{company.name}}', { align: 'center', bold: true, uppercase: true, fontSize: 13 })
    t(mx, my + 7, width, 5, '{{title}}', { align: 'center', bold: true })
    t(mx, my + 12, width, 5, 'Batch {{batch_no}} · {{transferred_at}} · by {{transferred_by}}', { align: 'center' })
    line(my + 18, { thickness: 2 })
    const y = my + 20
    const tableH = roll ? 40 : Math.max(40, H - my - y - 40)
    const items = table('items', ['code', 'receipt', 'article', 'karat', 'qty', 'net', 'cost', 'sale'], y, tableH, {}, { rowLines: true })
    const fl = { follows: items.id }
    t(mx, y + tableH + 1, width, 5, 'Total ({{item_count}} items) · Cost {{total_cost}} · Sale price {{total_sale}}', { ...fl, bold: true, align: 'right', border: 'top' })
    signatures(['Transferred by', 'Checked by'], y + tableH + 24, fl)
  }

  return {
    version: 1,
    paper: {
      width_mm: W,
      height_mm: H,
      margin_x_mm: paper.margin_x_mm ?? mx,
      margin_y_mm: paper.margin_y_mm ?? my,
      margin_top_mm: paper.margin_top_mm ?? paper.margin_y_mm ?? my,
      margin_bottom_mm: paper.margin_bottom_mm ?? paper.margin_y_mm ?? my,
      margin_left_mm: paper.margin_left_mm ?? paper.margin_x_mm ?? mx,
      margin_right_mm: paper.margin_right_mm ?? paper.margin_x_mm ?? mx,
    },
    font: { family: 'Arial, Helvetica, sans-serif', size: font },
    elements,
  }
}

function round(value: number): number {
  return Math.round(value * 2) / 2
}
