
/** Renders a document with a custom design, split into pages. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ElementContent, TableView } from './element-view';
import { layoutDocument, type TableMeasure } from '../lib/layout';
import type { DocData, PrintTemplate } from '../lib/types';

export function DesignedDocument({
  template,
  data,
  onLaidOut,
  printStyle = true,
}: {
  template: PrintTemplate;
  data: DocData;
  /** Called once the pages are on screen (safe to print). */
  onLaidOut?: () => void;
  /** false for on-screen previews that must not change how the page prints. */
  printStyle?: boolean;
}) {
  const [measures, setMeasures] = useState<Record<string, TableMeasure> | null>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const tables = template.elements.filter((element) => element.type === 'table' && element.table);
  const { width_mm: width } = template.paper;

  // Row heights depend on the real text, so they are measured before pages are built.
  useLayoutEffect(() => {
    const root = measureRef.current;
    if (!root) return;
    const ruler = root.querySelector<HTMLElement>('[data-ruler]')!;
    // Measured against a 100 mm ruler so preview zoom does not matter.
    const pxPerMm = ruler.getBoundingClientRect().width / 100 || 96 / 25.4;
    const height = (node: Element | null) => (node ? node.getBoundingClientRect().height / pxPerMm : 0);
    const next: Record<string, TableMeasure> = {};
    root.querySelectorAll<HTMLElement>('[data-table]').forEach((node) => {
      next[node.dataset.table!] = {
        headerHeight: height(node.querySelector('thead')),
        rowHeights: Array.from(node.querySelectorAll('tbody tr'), (row) => height(row)),
      };
    });
    // Unchanged measurements keep the old object, so a new `data` object each render cannot loop.
    setMeasures((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
  }, [template, data]);

  const ready = measures !== null;
  useEffect(() => {
    if (ready) onLaidOut?.();
  }, [ready, onLaidOut]);

  const pages = measures ? layoutDocument(template, measures) : [];
  const showReprint =
    !!data.fields.reprint && !template.elements.some((element) => element.text?.includes('{{reprint}}'));

  return (
    <div className="pd-doc flex flex-col items-center gap-4 print:block">
      {/* A roll's page is as long as its content. */}
      {printStyle && pages.length > 0 && <style>{pageCss(width, pages[0].height)}</style>}
      <div
        ref={measureRef}
        aria-hidden
        className="paper pointer-events-none invisible fixed left-[-10000px] top-0 print:hidden"
        style={{ fontFamily: template.font.family, color: '#000' }}
      >
        <div data-ruler style={{ width: '100mm', height: 1 }} />
        {tables.map((element) => (
          <div key={element.id} data-table={element.id} style={{ width: `${element.w}mm` }}>
            <TableView element={element} rows={data.tables[element.table!.source] ?? []} fontSize={template.font.size} />
          </div>
        ))}
      </div>

      {pages.map((page, pageIndex) => (
        <div
          key={pageIndex}
          className="pd-page paper relative shrink-0 overflow-hidden bg-white shadow-sm ring-1 ring-slate-200 print:shadow-none print:ring-0"
          style={{ width: `${width}mm`, height: `${page.height}mm`, fontFamily: template.font.family, fontSize: `${template.font.size}pt`, color: '#000' }}
        >
          {page.items.map(({ element, y, rows }, index) => (
            <div
              key={`${element.id}-${index}`}
              style={{
                position: 'absolute',
                left: `${element.x}mm`,
                top: `${y}mm`,
                width: `${element.w}mm`,
                height: element.type === 'table' ? undefined : `${element.h}mm`,
              }}
            >
              <ElementContent element={element} data={data} template={template} range={rows} />
            </div>
          ))}
          {showReprint && (
            <div style={{ position: 'absolute', top: '2mm', right: '2mm', border: '2px solid #000', padding: '0.5mm 2mm', fontWeight: 900, fontSize: '9pt' }}>
              {data.fields.reprint}
            </div>
          )}
          {data.watermark && (
            <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%) rotate(-18deg)', border: '4px solid #000', padding: '2mm 8mm', fontWeight: 900, fontSize: '26pt', letterSpacing: '0.1em', whiteSpace: 'nowrap', opacity: 0.55 }}>
              {data.watermark}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** Page size and page breaks for printing designed documents. */
function pageCss(width: number, height: number): string {
  return `
      @media print {
        @page { size: ${width}mm ${height}mm; margin: 0.01mm; }
        :root { --print-margin: 0mm; }
        .pd-page { margin: 0 !important; height: ${height - 0.3}mm !important; }
        .pd-page ~ .pd-page, .pd-doc ~ .pd-doc .pd-page { break-before: page; page-break-before: always; }
      }
    `;
}
