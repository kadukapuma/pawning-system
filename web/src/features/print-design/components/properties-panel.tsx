
/** Right-hand panel of the designer: page settings, or the selected block's settings. */
import { useState, type ReactNode } from 'react';
import { AlignCenter, AlignLeft, AlignRight, ArrowDown, ArrowUp, Bold, CaseUpper, Copy, Italic, Layers, MousePointerClick, SlidersHorizontal, Trash2, Underline, X } from 'lucide-react';
import type { DocumentInfo } from '../lib/catalog';
import { alignElement, followerIds, moveElement, resizeElement, updateElement } from '../lib/edit';
import type { Align, DesignElement, PrintTemplate, TableConfig } from '../lib/types';
import { PAPER_PRESETS, presetFor } from '../lib/paper';
import { Select } from '@/components/ui';

const input = 'w-full rounded-lg border border-border bg-popover px-2 py-1.5 text-sm text-foreground';

const FONTS = [
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Verdana (dot matrix)', value: 'Verdana, Tahoma, sans-serif' },
  { label: 'Tahoma', value: 'Tahoma, Verdana, sans-serif' },
  { label: 'Times New Roman', value: "'Times New Roman', Times, serif" },
  { label: 'Courier New (typewriter)', value: "'Courier New', Courier, monospace" },
];

const TYPE_NAMES: Record<DesignElement['type'], string> = { text: 'Text', logo: 'Company logo', line: 'Line', box: 'Box', table: 'Table' };

function Label({ text, children }: { text: string; children: ReactNode }) {
  return (
    <label className="block text-[11px] font-semibold text-muted-foreground">
      {text}
      <div className="mt-1">{children}</div>
    </label>
  );
}

function NumberInput({ value, onChange, min = 0, max = 2000, step = 0.5, placeholder }: { value: number | ''; onChange: (value: number) => void; min?: number; max?: number; step?: number; placeholder?: string }) {
  // What is being typed. Out-of-range text (e.g. "2" on the way to "245") is not applied yet.
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <input
      type="number"
      className={input}
      value={draft ?? value}
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      onChange={(event) => {
        setDraft(event.target.value);
        const next = Number(event.target.value);
        if (event.target.value !== '' && next >= min && next <= max) onChange(next);
      }}
      onBlur={() => {
        const next = Number(draft);
        if (draft && Number.isFinite(next) && (next < min || next > max)) onChange(Math.min(max, Math.max(min, next)));
        setDraft(null);
      }}
    />
  );
}

function Toggle({ on, title, onClick, children }: { on: boolean; title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={on}
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-lg border ${on ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-popover text-foreground hover:bg-secondary'}`}
    >
      {children}
    </button>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-foreground">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}

/** Paper size of the design; shown in the designer toolbar in both design and preview. */
export function PaperSizeControls({ paper, onChange }: { paper: PrintTemplate['paper']; onChange: (paper: PrintTemplate['paper']) => void }) {
  const [individualMargins, setIndividualMargins] = useState(() => {
    const mt = paper.margin_top_mm;
    const mb = paper.margin_bottom_mm;
    const ml = paper.margin_left_mm;
    const mr = paper.margin_right_mm;
    return (mt !== undefined && mb !== undefined && mt !== mb) || (ml !== undefined && mr !== undefined && ml !== mr);
  });

  const my = paper.margin_y_mm ?? paper.margin_top_mm ?? 0;
  const mx = paper.margin_x_mm ?? paper.margin_left_mm ?? 0;
  const mt = paper.margin_top_mm ?? paper.margin_y_mm ?? 0;
  const mb = paper.margin_bottom_mm ?? paper.margin_y_mm ?? 0;
  const ml = paper.margin_left_mm ?? paper.margin_x_mm ?? 0;
  const mr = paper.margin_right_mm ?? paper.margin_x_mm ?? 0;

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-[200px]">
        <Label text="Paper size">
          <Select
            className={input}
            value={presetFor(paper)}
            onChange={(event) => {
              const preset = PAPER_PRESETS.find((p) => p.id === event.target.value);
              if (preset) onChange({ ...paper, width_mm: preset.width_mm, height_mm: preset.height_mm });
            }}
          >
            {PAPER_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>{preset.label}</option>
            ))}
            <option value="custom" disabled>Custom size (type width and height)</option>
          </Select>
        </Label>
      </div>
      <div className="w-24">
        <Label text="Width (mm)"><NumberInput value={paper.width_mm} min={30} max={1000} onChange={(width_mm) => onChange({ ...paper, width_mm })} /></Label>
      </div>
      <div className="w-28">
        {/* 1-29 mm is not a usable sheet, so those are only applied once typing is finished. */}
        <Label text="Height (0 = roll)">
          <NumberInput value={paper.height_mm} onChange={(height_mm) => onChange({ ...paper, height_mm: height_mm > 0 ? Math.max(30, height_mm) : 0 })} min={0} />
        </Label>
      </div>

      {!individualMargins ? (
        <>
          <div className="w-28">
            <Label text="Top/bottom (mm)">
              <NumberInput
                value={my}
                min={0}
                max={150}
                onChange={(val) =>
                  onChange({ ...paper, margin_y_mm: val, margin_top_mm: val, margin_bottom_mm: val })
                }
              />
            </Label>
          </div>
          <div className="w-28">
            <Label text="Left/right (mm)">
              <NumberInput
                value={mx}
                min={0}
                max={150}
                onChange={(val) =>
                  onChange({ ...paper, margin_x_mm: val, margin_left_mm: val, margin_right_mm: val })
                }
              />
            </Label>
          </div>
        </>
      ) : (
        <>
          <div className="w-20">
            <Label text="Top (mm)">
              <NumberInput
                value={mt}
                min={0}
                max={150}
                onChange={(top) => onChange({ ...paper, margin_top_mm: top, margin_y_mm: top })}
              />
            </Label>
          </div>
          <div className="w-20">
            <Label text="Bottom (mm)">
              <NumberInput
                value={mb}
                min={0}
                max={150}
                onChange={(bottom) => onChange({ ...paper, margin_bottom_mm: bottom })}
              />
            </Label>
          </div>
          <div className="w-20">
            <Label text="Left (mm)">
              <NumberInput
                value={ml}
                min={0}
                max={150}
                onChange={(left) => onChange({ ...paper, margin_left_mm: left, margin_x_mm: left })}
              />
            </Label>
          </div>
          <div className="w-20">
            <Label text="Right (mm)">
              <NumberInput
                value={mr}
                min={0}
                max={150}
                onChange={(right) => onChange({ ...paper, margin_right_mm: right })}
              />
            </Label>
          </div>
        </>
      )}

      <button
        type="button"
        onClick={() => setIndividualMargins(!individualMargins)}
        className="mb-1 inline-flex items-center gap-1 rounded-lg border border-border bg-popover px-2 py-1.5 text-xs font-semibold text-foreground hover:bg-secondary"
        title={individualMargins ? 'Switch to Top/bottom & Left/right margins' : 'Set separate margins for all 4 sides'}
      >
        {individualMargins ? '2 sides' : '4 sides'}
      </button>
    </div>
  );
}

function TableSettings({ element, info, onChange }: { element: DesignElement; info: DocumentInfo; onChange: (table: TableConfig) => void }) {
  const table = element.table!;
  const catalog = info.tables.find((item) => item.source === table.source);
  const unused = catalog?.columns.filter((column) => !table.columns.some((c) => c.key === column.key)) ?? [];
  const setColumn = (index: number, patch: Partial<TableConfig['columns'][number]>) =>
    onChange({ ...table, columns: table.columns.map((column, i) => (i === index ? { ...column, ...patch } : column)) });
  const swap = (index: number, direction: 1 | -1) => {
    const columns = [...table.columns];
    const other = index + direction;
    if (other < 0 || other >= columns.length) return;
    [columns[index], columns[other]] = [columns[other], columns[index]];
    onChange({ ...table, columns });
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Check label="Column headings" checked={table.showHeader !== false} onChange={(showHeader) => onChange({ ...table, showHeader })} />
        <Check label="Lines between rows" checked={table.rowLines !== false} onChange={(rowLines) => onChange({ ...table, rowLines })} />
        <Check label="Lines between columns" checked={!!table.columnLines} onChange={(columnLines) => onChange({ ...table, columnLines })} />
      </div>
      <Label text="Rows side by side">
        <NumberInput value={table.repeatAcross || 1} min={1} max={4} step={1} onChange={(value) => onChange({ ...table, repeatAcross: Math.round(value) })} />
      </Label>
      <div className="space-y-2">
        <div className="text-[11px] font-semibold text-muted-foreground">Columns (heading, width share, alignment)</div>
        {table.columns.map((column, index) => (
          <div key={column.key} className="space-y-1 rounded-lg border border-border p-2">
            <div className="flex items-center gap-1">
              <input className={input} value={column.label ?? ''} maxLength={60} aria-label={`Heading for ${column.key}`} onChange={(event) => setColumn(index, { label: event.target.value })} />
              <button type="button" title="Move left" onClick={() => swap(index, -1)} className="rounded p-1 text-muted-foreground hover:bg-secondary"><ArrowUp className="h-3.5 w-3.5" /></button>
              <button type="button" title="Move right" onClick={() => swap(index, 1)} className="rounded p-1 text-muted-foreground hover:bg-secondary"><ArrowDown className="h-3.5 w-3.5" /></button>
              <button type="button" title="Remove column" disabled={table.columns.length === 1} onClick={() => onChange({ ...table, columns: table.columns.filter((_, i) => i !== index) })} className="rounded p-1 text-destructive hover:bg-destructive/10 disabled:opacity-30"><X className="h-3.5 w-3.5" /></button>
            </div>
            <div className="grid grid-cols-[1fr_1fr] gap-1">
              <NumberInput value={column.width} min={1} max={100} step={1} onChange={(width) => setColumn(index, { width })} />
              <Select className={input} value={column.align ?? 'left'} aria-label="Alignment" onChange={(event) => setColumn(index, { align: event.target.value as Align })}>
                <option value="left">Left</option>
                <option value="center">Centre</option>
                <option value="right">Right</option>
              </Select>
            </div>
          </div>
        ))}
        {unused.length > 0 && table.columns.length < 12 && (
          <Select
            className={input}
            value=""
            onChange={(event) => {
              const column = unused.find((c) => c.key === event.target.value);
              if (column) onChange({ ...table, columns: [...table.columns, { ...column }] });
            }}
          >
            <option value="">+ Add column…</option>
            {unused.map((column) => (
              <option key={column.key} value={column.key}>{column.label}</option>
            ))}
          </Select>
        )}
      </div>
    </div>
  );
}

export interface PropertiesPanelProps {
  template: PrintTemplate;
  info: DocumentInfo;
  selected: DesignElement | null;
  onChange: (template: PrintTemplate) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onReorder: (direction: 1 | -1) => void;
  sampleRows?: number;
  onSampleRowsChange?: (rows: number) => void;
  resized?: PrintTemplate['paper'] | null;
  offPage?: number;
  onScaleToPaper?: () => void;
  onRebuildForPaper?: () => void;
  onPaperChange?: (paper: PrintTemplate['paper']) => void;
}

export function PropertiesPanel({
  template,
  info,
  selected,
  onChange,
  onDuplicate,
  onDelete,
  onReorder,
  sampleRows,
  onSampleRowsChange,
  resized,
  offPage = 0,
  onScaleToPaper,
  onRebuildForPaper,
  onPaperChange,
}: PropertiesPanelProps) {
  const [tab, setTab] = useState<'element' | 'paper'>('paper');
  const [prevSelectedId, setPrevSelectedId] = useState<string | null>(selected?.id ?? null);

  if (selected && selected.id !== prevSelectedId) {
    setPrevSelectedId(selected.id);
    setTab('element');
  } else if (!selected && prevSelectedId !== null) {
    setPrevSelectedId(null);
  }

  const patch = (values: Partial<DesignElement>) => selected && onChange(updateElement(template, selected.id, values));
  const alignTo = (alignment: 'left' | 'center' | 'right') => selected && onChange(alignElement(template, selected.id, alignment));
  const descendants = selected ? followerIds(template, selected.id) : new Set<string>();
  const anchors = selected ? template.elements.filter((e) => e.type === 'table' && e.id !== selected.id && !descendants.has(e.id)) : [];
  const tableName = (element: DesignElement) => info.tables.find((t) => t.source === element.table?.source)?.label ?? element.id;
  const isText = selected?.type === 'text';
  const sizeName = (paper: PrintTemplate['paper']) => `${paper.width_mm} × ${paper.height_mm || 'roll'} mm`;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-popover">
      {/* Inspector tabs */}
      <div className="flex shrink-0 border-b border-border bg-secondary p-1">
        <button
          type="button"
          onClick={() => setTab('element')}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition ${
            tab === 'element'
              ? 'bg-popover text-primary shadow-2xs'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Layers className="h-3.5 w-3.5" />
          <span>
            {selected
              ? (selected.type === 'table'
                  ? (info.tables.find((t) => t.source === selected.table?.source)?.label ?? 'Table')
                  : TYPE_NAMES[selected.type])
              : 'Element'}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setTab('paper')}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition ${
            tab === 'paper'
              ? 'bg-popover text-primary shadow-2xs'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          <span>Paper & Margins</span>
        </button>
      </div>

      {/* Inspector Body */}
      <div className="content-scrollbar flex-1 overflow-y-auto p-4 space-y-4">
        {tab === 'element' ? (
          !selected ? (
            <div className="py-12 text-center">
              <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
                <MousePointerClick className="h-5 w-5" />
              </div>
              <p className="text-xs font-semibold text-foreground">No element selected</p>
              <p className="mt-1 text-[11px] text-muted-foreground">Click any block on the canvas to inspect its geometry, alignment, typography, and styling.</p>
            </div>
          ) : (
            <div key={selected.id} className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-foreground">
                  {selected.type === 'table' ? tableName(selected) : TYPE_NAMES[selected.type]}
                </h3>
                <div className="flex gap-1">
                  <button type="button" title="Bring forward" onClick={() => onReorder(1)} className="rounded-lg border border-border p-1.5 text-foreground hover:bg-secondary"><ArrowUp className="h-3.5 w-3.5" /></button>
                  <button type="button" title="Send backward" onClick={() => onReorder(-1)} className="rounded-lg border border-border p-1.5 text-foreground hover:bg-secondary"><ArrowDown className="h-3.5 w-3.5" /></button>
                  <button type="button" title="Duplicate (Ctrl+D)" onClick={onDuplicate} className="rounded-lg border border-border p-1.5 text-foreground hover:bg-secondary"><Copy className="h-3.5 w-3.5" /></button>
                  <button type="button" title="Delete" onClick={onDelete} className="rounded-lg border border-destructive/30 p-1.5 text-destructive hover:bg-destructive/10"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Label text="Left (mm)"><NumberInput value={selected.x} onChange={(x) => onChange(moveElement(template, selected.id, x, selected.y))} /></Label>
                <Label text="Top (mm)"><NumberInput value={selected.y} onChange={(y) => onChange(moveElement(template, selected.id, selected.x, y))} /></Label>
                <Label text="Width (mm)"><NumberInput value={selected.w} onChange={(w) => onChange(resizeElement(template, selected.id, w, selected.h))} /></Label>
                <Label text={selected.type === 'table' ? 'Max height (mm)' : 'Height (mm)'}><NumberInput value={selected.h} onChange={(h) => onChange(resizeElement(template, selected.id, selected.w, h))} /></Label>
              </div>

              <div>
                <div className="mb-1 text-[11px] font-semibold text-muted-foreground">Align element on sheet</div>
                <div className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-secondary p-1">
                  <button
                    type="button"
                    className="flex items-center justify-center gap-1 rounded-md bg-popover py-1.5 text-xs font-semibold text-foreground shadow-2xs hover:bg-primary/10 hover:text-primary active:bg-secondary"
                    onClick={() => alignTo('left')}
                    title="Align element flush with left margin"
                  >
                    <AlignLeft className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">Left</span>
                  </button>
                  <button
                    type="button"
                    className="flex items-center justify-center gap-1 rounded-md bg-popover py-1.5 text-xs font-semibold text-foreground shadow-2xs hover:bg-primary/10 hover:text-primary active:bg-secondary"
                    onClick={() => alignTo('center')}
                    title="Center element horizontally on page"
                  >
                    <AlignCenter className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">Center</span>
                  </button>
                  <button
                    type="button"
                    className="flex items-center justify-center gap-1 rounded-md bg-popover py-1.5 text-xs font-semibold text-foreground shadow-2xs hover:bg-primary/10 hover:text-primary active:bg-secondary"
                    onClick={() => alignTo('right')}
                    title="Align element flush with right margin"
                  >
                    <AlignRight className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">Right</span>
                  </button>
                </div>
              </div>

              {isText && (
                <>
                  <Label text="Text">
                    <textarea className={`${input} min-h-[96px] font-mono text-xs`} maxLength={5000} value={selected.text ?? ''} onChange={(event) => patch({ text: event.target.value })} />
                  </Label>
                  <Select
                    className={input}
                    value=""
                    onChange={(event) => {
                      if (!event.target.value) return;
                      const current = selected.text ?? '';
                      patch({ text: `${current}${current && !current.endsWith('\n') ? ' ' : ''}{{${event.target.value}}}` });
                    }}
                  >
                    <option value="">+ Insert a field…</option>
                    {info.fields.map((field) => (
                      <option key={field.key} value={field.key}>{field.label}</option>
                    ))}
                  </Select>
                  <p className="text-[11px] leading-4 text-muted-foreground">A line is hidden when all its fields are empty. Text shrinks if it does not fit the box.</p>
                </>
              )}

              {(isText || selected.type === 'table') && (
                <Label text="Text size (pt), empty = page size">
                  <input
                    type="number"
                    className={input}
                    min={4}
                    max={72}
                    step={0.5}
                    value={selected.fontSize ?? ''}
                    placeholder={String(template.font.size)}
                    onChange={(event) => patch({ fontSize: event.target.value === '' ? null : Math.min(72, Math.max(4, Number(event.target.value))) })}
                  />
                </Label>
              )}

              {selected.type === 'table' && <Check label="Bold" checked={!!selected.bold} onChange={(bold) => patch({ bold })} />}

              {isText && (
                <div className="flex flex-wrap gap-1">
                  <Toggle title="Bold" on={!!selected.bold} onClick={() => patch({ bold: !selected.bold })}><Bold className="h-4 w-4" /></Toggle>
                  <Toggle title="Italic" on={!!selected.italic} onClick={() => patch({ italic: !selected.italic })}><Italic className="h-4 w-4" /></Toggle>
                  <Toggle title="Underline" on={!!selected.underline} onClick={() => patch({ underline: !selected.underline })}><Underline className="h-4 w-4" /></Toggle>
                  <Toggle title="Capital letters" on={!!selected.uppercase} onClick={() => patch({ uppercase: !selected.uppercase })}><CaseUpper className="h-4 w-4" /></Toggle>
                </div>
              )}

              {(isText || selected.type === 'logo') && (
                <div>
                  <div className="mb-1 text-[11px] font-semibold text-muted-foreground">
                    {isText ? 'Text alignment' : 'Logo alignment'}
                  </div>
                  <div className="flex gap-1">
                    <Toggle title="Align left" on={(selected.align ?? 'left') === 'left'} onClick={() => patch({ align: 'left' })}>
                      <AlignLeft className="h-4 w-4" />
                    </Toggle>
                    <Toggle title="Align centre" on={selected.align === 'center'} onClick={() => patch({ align: 'center' })}>
                      <AlignCenter className="h-4 w-4" />
                    </Toggle>
                    <Toggle title="Align right" on={selected.align === 'right'} onClick={() => patch({ align: 'right' })}>
                      <AlignRight className="h-4 w-4" />
                    </Toggle>
                  </div>
                </div>
              )}

              {isText && (
                <Label text="Border">
                  <Select className={input} value={selected.border ?? 'none'} onChange={(event) => patch({ border: event.target.value as DesignElement['border'] })}>
                    <option value="none">None</option>
                    <option value="all">Box around</option>
                    <option value="top">Line above (signature)</option>
                    <option value="bottom">Line below</option>
                  </Select>
                </Label>
              )}

              {(selected.type === 'line' || selected.type === 'box' || (isText && !!selected.border && selected.border !== 'none')) && (
                <Label text="Line thickness"><NumberInput value={selected.thickness || 1} min={0.5} max={5} onChange={(thickness) => patch({ thickness })} /></Label>
              )}

              {selected.type === 'table' && selected.table && <TableSettings element={selected} info={info} onChange={(table) => patch({ table })} />}

              <div className="space-y-2 border-t border-border pt-3">
                {anchors.length > 0 && (
                  <Label text="Move with a table">
                    <Select className={input} value={selected.follows ?? ''} onChange={(event) => patch({ follows: event.target.value || null })}>
                      <option value="">No, stay where placed</option>
                      {anchors.map((anchor) => (
                        <option key={anchor.id} value={anchor.id}>Below “{tableName(anchor)}”</option>
                      ))}
                    </Select>
                  </Label>
                )}
                {selected.type !== 'table' && !selected.follows && (
                  <Label text="Show on (long documents)">
                    <Select className={input} value={selected.pages ?? 'all'} onChange={(event) => patch({ pages: event.target.value as DesignElement['pages'] })}>
                      <option value="all">Every page</option>
                      <option value="first">First page only</option>
                      <option value="last">Last page only</option>
                    </Select>
                  </Label>
                )}
              </div>
            </div>
          )
        ) : (
          <div className="space-y-4">
            {/* Paper Size & Dimensions */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Paper & Margins</h3>
              <PaperSizeControls paper={template.paper} onChange={onPaperChange ?? ((paper) => onChange({ ...template, paper }))} />
              {(resized || offPage > 0) && (
                <div className="rounded-xl border border-warning/40 bg-warning/15 p-3 text-xs text-accent-foreground space-y-2">
                  <p>
                    {resized ? `Paper changed from ${sizeName(resized)} to ${sizeName(template.paper)}. ` : ''}
                    {offPage > 0 ? `${offPage} block${offPage === 1 ? ' is' : 's are'} off the page.` : 'Fit blocks to the new size?'}
                  </p>
                  <div className="flex flex-col gap-1.5">
                    {resized && onScaleToPaper && (
                      <button
                        type="button"
                        onClick={onScaleToPaper}
                        className="rounded-lg border border-warning/40 bg-popover px-2.5 py-1 text-xs font-semibold text-accent-foreground hover:bg-warning/25"
                      >
                        Stretch blocks to fit
                      </button>
                    )}
                    {onRebuildForPaper && (
                      <button
                        type="button"
                        onClick={onRebuildForPaper}
                        className="rounded-lg border border-warning/40 bg-popover px-2.5 py-1 text-xs font-semibold text-accent-foreground hover:bg-warning/25"
                      >
                        Arrange standard layout
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Document Base Font */}
            <div className="space-y-3 border-t border-border pt-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Document Base Typography</h3>
              <Label text="Font Family">
                <Select className={input} value={template.font.family} onChange={(event) => onChange({ ...template, font: { ...template.font, family: event.target.value } })}>
                  {FONTS.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </Select>
              </Label>
              <Label text="Base text size (pt)">
                <NumberInput value={template.font.size} min={4} max={40} onChange={(size) => onChange({ ...template, font: { ...template.font, size } })} />
              </Label>
            </div>

            {/* Table Sample Rows */}
            {info.tables.length > 0 && onSampleRowsChange && sampleRows !== undefined && (
              <div className="space-y-3 border-t border-border pt-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Sample Data Rows</h3>
                <Label text="Preview rows for tables">
                  <Select
                    className={input}
                    value={sampleRows}
                    onChange={(e) => onSampleRowsChange(Number(e.target.value))}
                  >
                    {[1, 3, 8, 15, 40].map((count) => (
                      <option key={count} value={count}>{count} sample row{count === 1 ? '' : 's'}</option>
                    ))}
                  </Select>
                </Label>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
