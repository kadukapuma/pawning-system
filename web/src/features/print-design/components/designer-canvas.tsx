
/** The page the developer drags blocks around on. */
import { useMemo, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { ElementContent } from './element-view';
import { resolveText } from '../lib/layout';
import { moveElement, resizeElement, snapTo } from '../lib/edit';
import type { DesignElement, DocData, PrintTemplate } from '../lib/types';

type DragMode = 'move' | 'e' | 's' | 'se';

interface Drag {
  mode: DragMode;
  id: string;
  startX: number;
  startY: number;
  pxPerMm: number;
  origin: PrintTemplate;
  changed: boolean;
}

const HANDLES: { mode: Exclude<DragMode, 'move'>; className: string; label: string }[] = [
  { mode: 'e', className: 'right-[-5px] top-1/2 -translate-y-1/2 cursor-ew-resize', label: 'Resize width' },
  { mode: 's', className: 'bottom-[-5px] left-1/2 -translate-x-1/2 cursor-ns-resize', label: 'Resize height' },
  { mode: 'se', className: 'bottom-[-5px] right-[-5px] cursor-nwse-resize', label: 'Resize' },
];

/** Height of the sheet on screen; a roll grows to fit its blocks. */
export function canvasHeight(template: PrintTemplate): number {
  if (template.paper.height_mm > 0) return template.paper.height_mm;
  return Math.max(60, ...template.elements.map((element) => element.y + element.h + 8));
}

export function DesignerCanvas({
  template,
  data,
  selectedId,
  zoom,
  snap,
  background,
  showRulers = true,
  onSelect,
  onChange,
  onCommit,
}: {
  template: PrintTemplate;
  data: DocData;
  selectedId: string | null;
  zoom: number;
  /** Grid step in mm; 0 = free. */
  snap: number;
  /** Scan of a pre-printed form to line up against (never printed or saved). */
  background: { url: string; opacity: number } | null;
  showRulers?: boolean;
  onSelect: (id: string | null) => void;
  /** Live update while dragging. */
  onChange: (template: PrintTemplate) => void;
  /** A drag finished: `before` goes on the undo stack. */
  onCommit: (before: PrintTemplate) => void;
}) {
  const pageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const width = template.paper.width_mm;
  const height = canvasHeight(template);
  const margins = {
    top: template.paper.margin_top_mm ?? template.paper.margin_y_mm ?? 0,
    bottom: template.paper.margin_bottom_mm ?? template.paper.margin_y_mm ?? 0,
    left: template.paper.margin_left_mm ?? template.paper.margin_x_mm ?? 0,
    right: template.paper.margin_right_mm ?? template.paper.margin_x_mm ?? 0,
  };
  const hasMargins = margins.top > 0 || margins.bottom > 0 || margins.left > 0 || margins.right > 0;
  const selected = template.elements.find((element) => element.id === selectedId) ?? null;
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] });

  const handleTopRulerClick = (event: MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const mm = Math.round(((event.clientX - rect.left) / rect.width) * width * 2) / 2;
    if (mm >= 0 && mm <= width && !guides.x.includes(mm)) {
      setGuides((prev) => ({ ...prev, x: [...prev.x, mm].sort((a, b) => a - b) }));
    }
  };

  const handleLeftRulerClick = (event: MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const mm = Math.round(((event.clientY - rect.top) / rect.height) * height * 2) / 2;
    if (mm >= 0 && mm <= height && !guides.y.includes(mm)) {
      setGuides((prev) => ({ ...prev, y: [...prev.y, mm].sort((a, b) => a - b) }));
    }
  };

  const removeGuideX = (val: number) => {
    setGuides((prev) => ({ ...prev, x: prev.x.filter((x) => x !== val) }));
  };

  const removeGuideY = (val: number) => {
    setGuides((prev) => ({ ...prev, y: prev.y.filter((y) => y !== val) }));
  };

  const clearGuides = () => {
    setGuides({ x: [], y: [] });
  };

  const start = (event: ReactPointerEvent, element: DesignElement, mode: DragMode) => {
    if (event.button !== 0 || !pageRef.current) return;
    event.stopPropagation();
    event.preventDefault();
    onSelect(element.id);
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag.current = {
      mode,
      id: element.id,
      startX: event.clientX,
      startY: event.clientY,
      pxPerMm: pageRef.current.getBoundingClientRect().width / width,
      origin: template,
      changed: false,
    };
  };

  const move = (event: ReactPointerEvent) => {
    const current = drag.current;
    if (!current) return;
    const dx = (event.clientX - current.startX) / current.pxPerMm;
    const dy = (event.clientY - current.startY) / current.pxPerMm;
    // A click that wobbles by a pixel is not a drag.
    if (!current.changed && Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < 3) return;
    const element = current.origin.elements.find((item) => item.id === current.id);
    if (!element) return;
    current.changed = true;

    if (current.mode === 'move') {
      onChange(moveElement(current.origin, element.id, snapTo(element.x + dx, snap), snapTo(element.y + dy, snap)));
    } else {
      const w = current.mode === 's' ? element.w : snapTo(element.w + dx, snap);
      const h = current.mode === 'e' ? element.h : snapTo(element.h + dy, snap);
      onChange(resizeElement(current.origin, element.id, w, h));
    }
  };

  const end = () => {
    if (drag.current?.changed) onCommit(drag.current.origin);
    drag.current = null;
  };

  const paperSheet = (
    <div
      ref={pageRef}
      onPointerDown={() => onSelect(null)}
      className="paper relative select-none overflow-hidden bg-white shadow-md ring-1 ring-slate-300"
      style={{
        width: `${width}mm`,
        height: `${height}mm`,
        fontFamily: template.font.family,
        fontSize: `${template.font.size}pt`,
        color: '#000',
        backgroundImage: snap >= 1 ? 'radial-gradient(#cbd5e1 0.5px, transparent 0.5px)' : undefined,
        backgroundSize: '5mm 5mm',
      }}
    >
      {background && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={background.url} alt="" draggable={false} className="pointer-events-none absolute inset-0" style={{ width: `${width}mm`, height: `${height}mm`, opacity: background.opacity }} />
      )}
      {hasMargins && (
        <div
          aria-hidden
          className="pointer-events-none absolute border border-dashed border-indigo-400/50 bg-indigo-50/10"
          style={{
            top: `${margins.top}mm`,
            left: `${margins.left}mm`,
            width: `${Math.max(0, width - margins.left - margins.right)}mm`,
            height: `${Math.max(0, height - margins.top - margins.bottom)}mm`,
            zIndex: 0,
          }}
        >
          <span className="absolute left-1 top-0.5 text-[5.5pt] font-bold tracking-wider text-indigo-400/80 uppercase">
            Margins ({margins.left} × {margins.top} mm)
          </span>
        </div>
      )}

      {/* Alignment projection lines across sheet for selected element */}
      {selected && (
        <div aria-hidden className="pointer-events-none absolute inset-0 z-10">
          <div
            className="absolute left-0 right-0 border-t border-dashed border-indigo-400/25"
            style={{ top: `${selected.y}mm` }}
          />
          <div
            className="absolute left-0 right-0 border-t border-dashed border-indigo-400/25"
            style={{ top: `${selected.y + selected.h}mm` }}
          />
          <div
            className="absolute bottom-0 top-0 border-l border-dashed border-indigo-400/25"
            style={{ left: `${selected.x}mm` }}
          />
          <div
            className="absolute bottom-0 top-0 border-l border-dashed border-indigo-400/25"
            style={{ left: `${selected.x + selected.w}mm` }}
          />
        </div>
      )}

      {/* Custom alignment guidelines dropped from rulers */}
      {guides.x.map((gx) => (
        <div
          key={`guide-x-${gx}`}
          className="group pointer-events-none absolute bottom-0 top-0 z-20 w-px border-l border-cyan-500 shadow-2xs"
          style={{ left: `${gx}mm` }}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              removeGuideX(gx);
            }}
            title={`Vertical guide at ${gx}mm. Click to remove.`}
            className="pointer-events-auto absolute top-1 -translate-x-1/2 rounded bg-cyan-600/90 px-1 py-0.5 text-[5pt] font-bold text-white shadow-xs hover:bg-rose-600"
          >
            {gx} ×
          </button>
        </div>
      ))}

      {guides.y.map((gy) => (
        <div
          key={`guide-y-${gy}`}
          className="group pointer-events-none absolute left-0 right-0 z-20 h-px border-t border-cyan-500 shadow-2xs"
          style={{ top: `${gy}mm` }}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              removeGuideY(gy);
            }}
            title={`Horizontal guide at ${gy}mm. Click to remove.`}
            className="pointer-events-auto absolute left-1 -translate-y-1/2 rounded bg-cyan-600/90 px-1 py-0.5 text-[5pt] font-bold text-white shadow-xs hover:bg-rose-600"
          >
            {gy} ×
          </button>
        </div>
      ))}

      {template.elements.map((element) => {
        const isSelected = element.id === selectedId;
        const emptyText = element.type === 'text' && !resolveText(element.text ?? '', data.fields).trim();
        const missingLogo = element.type === 'logo' && !data.logo;
        return (
          <div
            key={element.id}
            data-element={element.id}
            onPointerDown={(event) => start(event, element, 'move')}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            className={`absolute cursor-move touch-none ${isSelected ? 'outline outline-2 outline-indigo-600' : 'outline-dashed outline-1 outline-slate-300 hover:outline-indigo-400'}`}
            style={{
              left: `${element.x}mm`,
              top: `${element.y}mm`,
              width: `${element.w}mm`,
              // Thin lines keep a grabbable height.
              height: `${Math.max(element.h, 1.5)}mm`,
              zIndex: isSelected ? 10 : undefined,
            }}
          >
            <div className={`pointer-events-none h-full w-full ${element.type === 'table' ? 'overflow-hidden' : ''}`}>
              {emptyText || missingLogo ? (
                <div className="h-full w-full overflow-hidden bg-slate-100/70 text-[7pt] text-slate-400">
                  {missingLogo ? 'Logo (none set)' : element.text || 'Empty text'}
                </div>
              ) : (
                <ElementContent element={element} data={data} template={template} />
              )}
            </div>
            {element.follows && (
              <span className="pointer-events-none absolute -left-0.5 -top-2 rounded bg-emerald-600 px-1 text-[5pt] font-bold leading-tight text-white" title="Moves with the table above">↓</span>
            )}
            {isSelected &&
              HANDLES.map((handle) => (
                <span
                  key={handle.mode}
                  role="button"
                  aria-label={handle.label}
                  onPointerDown={(event) => start(event, element, handle.mode)}
                  onPointerMove={move}
                  onPointerUp={end}
                  onPointerCancel={end}
                  className={`absolute h-[9px] w-[9px] rounded-sm border border-white bg-indigo-600 ${handle.className}`}
                />
              ))}
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="mx-auto w-fit select-none" style={{ zoom }}>
      {showRulers ? (
        <div className="flex flex-col">
          {/* Top row: corner box + horizontal ruler */}
          <div className="flex items-end">
            <button
              type="button"
              onClick={clearGuides}
              className={`flex shrink-0 items-center justify-center border-b border-r border-slate-300 font-mono text-[7pt] font-bold transition ${
                guides.x.length > 0 || guides.y.length > 0
                  ? 'bg-cyan-100 text-cyan-800 hover:bg-rose-100 hover:text-rose-700'
                  : 'bg-slate-200 text-slate-500'
              }`}
              style={{ width: '7mm', height: '6mm' }}
              title={
                guides.x.length > 0 || guides.y.length > 0
                  ? `Clear all ${guides.x.length + guides.y.length} guide lines`
                  : 'Dimensions in millimeters (mm)'
              }
            >
              {guides.x.length > 0 || guides.y.length > 0 ? '×' : 'mm'}
            </button>
            <div
              className="relative cursor-crosshair overflow-hidden border-b border-slate-300 bg-slate-100 hover:bg-slate-200/80"
              style={{ width: `${width}mm`, height: '6mm' }}
              onClick={handleTopRulerClick}
              title="Click horizontal ruler to place a vertical guide line"
            >
              <HorizontalRuler
                width={width}
                selected={selected}
                margins={margins}
                guides={guides.x}
              />
            </div>
          </div>

          {/* Bottom row: vertical ruler + paper sheet */}
          <div className="flex">
            <div
              className="relative shrink-0 cursor-crosshair overflow-hidden border-r border-slate-300 bg-slate-100 hover:bg-slate-200/80"
              style={{ width: '7mm', height: `${height}mm` }}
              onClick={handleLeftRulerClick}
              title="Click vertical ruler to place a horizontal guide line"
            >
              <VerticalRuler
                height={height}
                selected={selected}
                margins={margins}
                guides={guides.y}
              />
            </div>

            {paperSheet}
          </div>
        </div>
      ) : (
        paperSheet
      )}
    </div>
  );
}

function HorizontalRuler({
  width,
  selected,
  margins,
  guides,
}: {
  width: number;
  selected: DesignElement | null;
  margins: { left: number; right: number };
  guides: number[];
}) {
  const ticks = useMemo(() => {
    const items: React.ReactNode[] = [];
    for (let i = 0; i <= width; i += 1) {
      if (i % 10 === 0) {
        items.push(
          <g key={`h-maj-${i}`}>
            <line x1={i} y1={2.2} x2={i} y2={6} stroke="#64748b" strokeWidth={0.16} />
            <text
              x={i === 0 ? 0.6 : i}
              y={1.8}
              textAnchor={i === 0 ? 'start' : 'middle'}
              fill="#475569"
              fontSize={1.7}
              fontFamily="ui-monospace, monospace"
              fontWeight={600}
            >
              {i}
            </text>
          </g>
        );
      } else if (i % 5 === 0) {
        items.push(<line key={`h-med-${i}`} x1={i} y1={3.6} x2={i} y2={6} stroke="#94a3b8" strokeWidth={0.14} />);
      } else {
        items.push(<line key={`h-min-${i}`} x1={i} y1={4.7} x2={i} y2={6} stroke="#cbd5e1" strokeWidth={0.1} />);
      }
    }
    return items;
  }, [width]);

  const hasMarginLeft = margins.left > 0;
  const hasMarginRight = margins.right > 0 && width - margins.right > margins.left;

  return (
    <svg className="block h-full w-full select-none" viewBox={`0 0 ${width} 6`} preserveAspectRatio="none" aria-hidden>
      {ticks}
      {hasMarginLeft && <line x1={margins.left} y1={0} x2={margins.left} y2={6} stroke="#6366f1" strokeWidth={0.25} strokeDasharray="0.8,0.5" />}
      {hasMarginRight && <line x1={width - margins.right} y1={0} x2={width - margins.right} y2={6} stroke="#6366f1" strokeWidth={0.25} strokeDasharray="0.8,0.5" />}
      {guides.map((gx) => (
        <line key={`ruler-gx-${gx}`} x1={gx} y1={0} x2={gx} y2={6} stroke="#06b6d4" strokeWidth={0.35} />
      ))}
      {selected && (
        <g>
          <rect x={selected.x} y={0} width={selected.w} height={6} fill="#6366f1" fillOpacity={0.25} />
          <line x1={selected.x} y1={0} x2={selected.x} y2={6} stroke="#4f46e5" strokeWidth={0.3} />
          <line x1={selected.x + selected.w} y1={0} x2={selected.x + selected.w} y2={6} stroke="#4f46e5" strokeWidth={0.3} />
        </g>
      )}
    </svg>
  );
}

function VerticalRuler({
  height,
  selected,
  margins,
  guides,
}: {
  height: number;
  selected: DesignElement | null;
  margins: { top: number; bottom: number };
  guides: number[];
}) {
  const ticks = useMemo(() => {
    const items: React.ReactNode[] = [];
    for (let i = 0; i <= height; i += 1) {
      if (i % 10 === 0) {
        items.push(
          <g key={`v-maj-${i}`}>
            <line x1={3.8} y1={i} x2={7} y2={i} stroke="#64748b" strokeWidth={0.16} />
            <text
              x={3.4}
              y={i === 0 ? 1.8 : i + 0.6}
              textAnchor="end"
              fill="#475569"
              fontSize={1.6}
              fontFamily="ui-monospace, monospace"
              fontWeight={600}
            >
              {i}
            </text>
          </g>
        );
      } else if (i % 5 === 0) {
        items.push(<line key={`v-med-${i}`} x1={4.8} y1={i} x2={7} y2={i} stroke="#94a3b8" strokeWidth={0.14} />);
      } else {
        items.push(<line key={`v-min-${i}`} x1={5.8} y1={i} x2={7} y2={i} stroke="#cbd5e1" strokeWidth={0.1} />);
      }
    }
    return items;
  }, [height]);

  const hasMarginTop = margins.top > 0;
  const hasMarginBottom = margins.bottom > 0 && height - margins.bottom > margins.top;

  return (
    <svg className="block h-full w-full select-none" viewBox={`0 0 7 ${height}`} preserveAspectRatio="none" aria-hidden>
      {ticks}
      {hasMarginTop && <line x1={0} y1={margins.top} x2={7} y2={margins.top} stroke="#6366f1" strokeWidth={0.25} strokeDasharray="0.8,0.5" />}
      {hasMarginBottom && <line x1={0} y1={height - margins.bottom} x2={7} y2={height - margins.bottom} stroke="#6366f1" strokeWidth={0.25} strokeDasharray="0.8,0.5" />}
      {guides.map((gy) => (
        <line key={`ruler-gy-${gy}`} x1={0} y1={gy} x2={7} y2={gy} stroke="#06b6d4" strokeWidth={0.35} />
      ))}
      {selected && (
        <g>
          <rect x={0} y={selected.y} width={7} height={selected.h} fill="#6366f1" fillOpacity={0.25} />
          <line x1={0} y1={selected.y} x2={7} y2={selected.y} stroke="#4f46e5" strokeWidth={0.3} />
          <line x1={0} y1={selected.y + selected.h} x2={7} y2={selected.y + selected.h} stroke="#4f46e5" strokeWidth={0.3} />
        </g>
      )}
    </svg>
  );
}
