/** Documents the Print Designer can lay out (same keys as the backend PrintDesign::DOCUMENTS). */
export type DesignDocumentKey = 'pawn_ticket' | 'pawn_receipt' | 'arrears_letter' | 'sales_invoice' | 'stock_transfer';

export type ElementType = 'text' | 'logo' | 'line' | 'box' | 'table';
export type Align = 'left' | 'center' | 'right';

export interface TableColumn {
  key: string;
  label?: string | null;
  /** Share of the table width (the columns are scaled to 100%). */
  width: number;
  align?: Align | null;
}

export interface TableConfig {
  /** Which list of rows to print, e.g. "items". */
  source: string;
  showHeader?: boolean | null;
  rowLines?: boolean | null;
  columnLines?: boolean | null;
  /** Print the rows in N side-by-side groups (e.g. a repayment schedule). */
  repeatAcross?: number | null;
  columns: TableColumn[];
}

/** One block on the page. Positions and sizes are millimetres from the top-left of the paper. */
export interface DesignElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Pages a fixed block appears on when the document runs over one page. */
  pages?: 'all' | 'first' | 'last' | null;
  /** Id of a table: this block moves up/down to sit after the table's last row. */
  follows?: string | null;
  /** May contain {{field}} placeholders. */
  text?: string | null;
  /** Points; falls back to the document font size. */
  fontSize?: number | null;
  bold?: boolean | null;
  italic?: boolean | null;
  underline?: boolean | null;
  uppercase?: boolean | null;
  align?: Align | null;
  border?: 'none' | 'all' | 'top' | 'bottom' | null;
  /** Border / line thickness in px-like units. */
  thickness?: number | null;
  table?: TableConfig | null;
}

export interface PrintPaper {
  width_mm: number;
  /** height_mm = 0 means a continuous roll. */
  height_mm: number;
  margin_x_mm?: number;
  margin_y_mm?: number;
  margin_top_mm?: number;
  margin_bottom_mm?: number;
  margin_left_mm?: number;
  margin_right_mm?: number;
}

export interface PrintTemplate {
  version: 1;
  paper: PrintPaper;
  font: { family: string; size: number };
  elements: DesignElement[];
}

export type TableRow = Record<string, string>;

/** The values of one printed document. */
export interface DocData {
  fields: Record<string, string>;
  tables: Record<string, TableRow[]>;
  logo?: string | null;
  /** Always stamped across the page (e.g. CANCELLED), whatever the design contains. */
  watermark?: string | null;
}
