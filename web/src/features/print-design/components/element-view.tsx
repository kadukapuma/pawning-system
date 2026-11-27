
/** Draws one design block. Used by printing, the preview and the designer canvas. */
import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import { resolveText } from '../lib/layout';
import type { DesignElement, DocData, PrintTemplate, TableRow } from '../lib/types';

const MIN_FONT_PT = 5;

function borderStyle(element: DesignElement): CSSProperties {
  const line = `${element.thickness || 1}px solid #000`;
  if (element.border === 'all') return { border: line, padding: '0.8mm 1.2mm' };
  if (element.border === 'top') return { borderTop: line, paddingTop: '0.6mm' };
  if (element.border === 'bottom') return { borderBottom: line, paddingBottom: '0.6mm' };
  return {};
}

/** Text that shrinks until it fits its box, so nothing is ever cut off. */
function FitText({ value, fontSize, style }: { value: string; fontSize: number; style: CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    let size = fontSize;
    node.style.fontSize = `${size}pt`;
    while (size > MIN_FONT_PT && (node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1)) {
      size -= 0.25;
      node.style.fontSize = `${size}pt`;
    }
  });

  return (
    <div ref={ref} style={style}>
      {value}
    </div>
  );
}

export function TableView({
  element,
  rows,
  range,
  fontSize,
}: {
  element: DesignElement;
  rows: TableRow[];
  /** Row groups to print: [from, to). Omit for all. */
  range?: [number, number];
  fontSize: number;
}) {
  const config = element.table!;
  const across = config.repeatAcross || 1;
  const total = config.columns.reduce((sum, column) => sum + column.width, 0) || 1;
  const groups: TableRow[][] = [];
  for (let i = 0; i < rows.length; i += across) groups.push(rows.slice(i, i + across));
  const visible = range ? groups.slice(range[0], range[1]) : groups;
  const slots = Array.from({ length: across }, (_, i) => i);
  const rule = '1px solid #000';

  const cell = (columnIndex: number, slot: number, align?: string | null): CSSProperties => ({
    padding: '0.7mm 1mm',
    paddingLeft: slot > 0 && columnIndex === 0 ? '4mm' : '1mm',
    textAlign: (align as CSSProperties['textAlign']) || 'left',
    verticalAlign: 'top',
    whiteSpace: 'pre-wrap',
    overflowWrap: align === 'right' ? 'normal' : 'anywhere',
    borderLeft: config.columnLines && (columnIndex > 0 || slot > 0) ? rule : undefined,
    fontVariantNumeric: 'tabular-nums',
  });

  return (
    <table
      style={{
        width: '100%',
        tableLayout: 'fixed',
        borderCollapse: 'collapse',
        fontSize: `${element.fontSize || fontSize}pt`,
        fontWeight: element.bold ? 700 : undefined,
        lineHeight: 1.25,
      }}
    >
      <colgroup>
        {slots.flatMap((slot) =>
          config.columns.map((column) => (
            <col key={`${slot}-${column.key}`} style={{ width: `${column.width / total / across * 100}%` }} />
          ))
        )}
      </colgroup>
      {config.showHeader !== false && (
        <thead>
          <tr style={{ borderBottom: rule }}>
            {slots.flatMap((slot) =>
              config.columns.map((column, i) => (
                <th key={`${slot}-${column.key}`} style={{ ...cell(i, slot, column.align), fontWeight: 700, textTransform: 'uppercase', fontSize: '0.9em' }}>
                  {column.label}
                </th>
              ))
            )}
          </tr>
        </thead>
      )}
      <tbody>
        {visible.map((group, index) => (
          <tr key={index} style={{ borderBottom: config.rowLines === false ? undefined : '1px solid #bbb' }}>
            {slots.flatMap((slot) =>
              config.columns.map((column, i) => (
                <td key={`${slot}-${column.key}`} style={cell(i, slot, column.align)}>
                  {group[slot]?.[column.key] ?? ''}
                </td>
              ))
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The content of a block, filling its (absolutely positioned) parent box. */
export function ElementContent({
  element,
  data,
  template,
  range,
}: {
  element: DesignElement;
  data: DocData;
  template: PrintTemplate;
  range?: [number, number];
}) {
  if (element.type === 'table') {
    if (!element.table) return null;
    return <TableView element={element} rows={data.tables[element.table.source] ?? []} range={range} fontSize={template.font.size} />;
  }

  if (element.type === 'logo') {
    if (!data.logo) return null;
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={data.logo} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain', objectPosition: element.align === 'right' ? 'right' : element.align === 'center' ? 'center' : 'left' }} />;
  }

  if (element.type === 'line') {
    const line = `${element.thickness || 1}px solid #000`;
    return <div style={element.h > element.w ? { height: '100%', borderLeft: line } : { width: '100%', borderTop: line }} />;
  }

  if (element.type === 'box') {
    return <div style={{ width: '100%', height: '100%', border: `${element.thickness || 1}px solid #000` }} />;
  }

  const value = resolveText(element.text ?? '', data.fields);
  // An empty block prints nothing at all, not even its border.
  if (!value.trim()) return null;

  return (
    <FitText
      value={value}
      fontSize={element.fontSize || template.font.size}
      style={{
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        overflow: 'hidden',
        whiteSpace: 'pre-wrap',
        overflowWrap: 'break-word',
        lineHeight: 1.25,
        fontWeight: element.bold ? 700 : 400,
        fontStyle: element.italic ? 'italic' : undefined,
        textDecoration: element.underline ? 'underline' : undefined,
        textTransform: element.uppercase ? 'uppercase' : undefined,
        textAlign: element.align || 'left',
        ...borderStyle(element),
      }}
    />
  );
}
