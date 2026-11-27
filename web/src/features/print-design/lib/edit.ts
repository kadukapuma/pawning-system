/** Pure editing operations on a print template (used by the designer). */
import type { DocumentInfo } from './catalog';
import type { DesignElement, ElementType, PrintTemplate } from './types';

const round = (value: number) => Math.round(value * 10) / 10;

export function snapTo(value: number, step: number): number {
  return step > 0 ? round(Math.round(value / step) * step) : round(value);
}

/** Ids of the blocks that follow `id`, directly or through another table. */
export function followerIds(template: PrintTemplate, id: string): Set<string> {
  const found = new Set<string>();
  const queue = [id];
  while (queue.length > 0) {
    const anchor = queue.pop()!;
    for (const element of template.elements) {
      if (element.follows === anchor && element.id !== id && !found.has(element.id)) {
        found.add(element.id);
        queue.push(element.id);
      }
    }
  }
  return found;
}

export function updateElement(template: PrintTemplate, id: string, patch: Partial<DesignElement>): PrintTemplate {
  return {
    ...template,
    elements: template.elements.map((element) => (element.id === id ? { ...element, ...patch } : element)),
  };
}

/** Moves a block; a table takes the blocks that follow it along. */
export function moveElement(template: PrintTemplate, id: string, x: number, y: number): PrintTemplate {
  const target = template.elements.find((element) => element.id === id);
  if (!target) return template;
  const nextX = Math.min(Math.max(0, x), template.paper.width_mm - 1);
  const nextY = Math.min(Math.max(0, y), template.paper.height_mm > 0 ? template.paper.height_mm - 0.5 : 1900);
  const dx = nextX - target.x;
  const dy = nextY - target.y;
  const followers = target.type === 'table' ? followerIds(template, id) : new Set<string>();

  return {
    ...template,
    elements: template.elements.map((element) => {
      if (element.id === id) return { ...element, x: round(nextX), y: round(nextY) };
      if (followers.has(element.id)) return { ...element, x: round(element.x + dx), y: round(element.y + dy) };
      return element;
    }),
  };
}

/**
 * Aligns a block horizontally on the paper:
 * - left: x = 0 (flush with the left edge of the sheet)
 * - center: horizontally centered on the sheet
 * - right: flush with the right edge of the sheet (x = paper.width_mm - target.w)
 */
export function alignElement(
  template: PrintTemplate,
  id: string,
  alignment: 'left' | 'center' | 'right'
): PrintTemplate {
  const target = template.elements.find((element) => element.id === id);
  if (!target) return template;
  const ml = template.paper.margin_left_mm ?? template.paper.margin_x_mm ?? 0;
  const mr = template.paper.margin_right_mm ?? template.paper.margin_x_mm ?? 0;
  let targetX = ml;
  if (alignment === 'left') {
    targetX = ml;
  } else if (alignment === 'center') {
    targetX = ml + Math.max(0, (template.paper.width_mm - ml - mr - target.w) / 2);
  } else if (alignment === 'right') {
    targetX = Math.max(ml, template.paper.width_mm - mr - target.w);
  }
  return moveElement(template, id, round(targetX), target.y);
}

/** Resizes a block; when a table gets taller its followers move down with its bottom edge. */
export function resizeElement(template: PrintTemplate, id: string, w: number, h: number): PrintTemplate {
  const target = template.elements.find((element) => element.id === id);
  if (!target) return template;
  const nextW = Math.max(2, w);
  const nextH = Math.max(target.type === 'line' ? 0.5 : 2, h);
  const dh = nextH - target.h;
  const followers = target.type === 'table' ? followerIds(template, id) : new Set<string>();

  return {
    ...template,
    elements: template.elements.map((element) => {
      if (element.id === id) return { ...element, w: round(nextW), h: round(nextH) };
      if (followers.has(element.id)) return { ...element, y: round(element.y + dh) };
      return element;
    }),
  };
}

/** Number of blocks that reach past the edge of the paper. */
export function offPageCount(template: PrintTemplate): number {
  const { width_mm, height_mm } = template.paper;
  return template.elements.filter(
    (element) =>
      element.x + element.w > width_mm + 0.5 ||
      // A table box and the blocks following it move at print time; a roll has no bottom edge.
      (height_mm > 0 && !element.follows && element.y + element.h > height_mm + 0.5)
  ).length;
}

/**
 * Stretching only reads well when the sheet keeps roughly the same shape (A4 to A5). Between
 * portrait and landscape it would squash the text, so the layout has to be arranged instead.
 */
export function canStretch(from: PrintTemplate['paper'], to: PrintTemplate['paper']): boolean {
  if (from.height_mm <= 0 || to.height_mm <= 0) return false;
  const shape = (to.width_mm / from.width_mm) / (to.height_mm / from.height_mm);
  return shape > 0.75 && shape < 1.33;
}

/** Stretches every block from the old paper size to the current one. */
export function scaleToPaper(template: PrintTemplate, from: PrintTemplate['paper']): PrintTemplate {
  const to = template.paper;
  const sx = to.width_mm / from.width_mm;
  // Roll paper has no height to scale against.
  const sy = from.height_mm > 0 && to.height_mm > 0 ? to.height_mm / from.height_mm : 1;
  // Text only gets smaller when space does; it is not blown up on bigger paper.
  const shrink = Math.min(1, sx, sy);
  const size = (value: number) => Math.max(5, Math.round(value * shrink * 2) / 2);

  return {
    ...template,
    font: { ...template.font, size: size(template.font.size) },
    elements: template.elements.map((element) => ({
      ...element,
      x: round(element.x * sx),
      y: round(element.y * sy),
      w: round(element.w * sx),
      h: element.type === 'line' ? element.h : round(element.h * sy),
      fontSize: element.fontSize ? size(element.fontSize) : element.fontSize,
    })),
  };
}

export function newId(template: PrintTemplate, type: ElementType): string {
  const used = new Set(template.elements.map((element) => element.id));
  let n = template.elements.length + 1;
  while (used.has(`${type}-${n}`)) n += 1;
  return `${type}-${n}`;
}

export function createElement(
  template: PrintTemplate,
  info: DocumentInfo,
  type: ElementType,
  options: { text?: string; source?: string } = {}
): DesignElement {
  const base = { id: newId(template, type), type, x: 10, y: 10, w: 50, h: 6 };
  if (type === 'text') return { ...base, text: options.text ?? 'New text' };
  if (type === 'logo') return { ...base, w: 25, h: 18 };
  if (type === 'line') return { ...base, w: 80, h: 0.5, thickness: 1 };
  if (type === 'box') return { ...base, w: 60, h: 25, thickness: 1 };

  const table = info.tables.find((item) => item.source === options.source) ?? info.tables[0];
  return {
    ...base,
    w: Math.max(40, template.paper.width_mm - 20),
    h: 30,
    table: {
      source: table.source,
      columns: table.columns.slice(0, 4).map((column) => ({ ...column })),
      showHeader: true,
      rowLines: true,
      columnLines: false,
      repeatAcross: 1,
    },
  };
}

export function removeElement(template: PrintTemplate, id: string): PrintTemplate {
  return {
    ...template,
    elements: template.elements
      .filter((element) => element.id !== id)
      .map((element) => (element.follows === id ? { ...element, follows: null } : element)),
  };
}

/** Moves a block one step in the drawing order. */
export function reorderElement(template: PrintTemplate, id: string, direction: 1 | -1): PrintTemplate {
  const from = template.elements.findIndex((element) => element.id === id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= template.elements.length) return template;
  const elements = [...template.elements];
  [elements[from], elements[to]] = [elements[to], elements[from]];
  return { ...template, elements };
}
