/**
 * Pure page layout for custom print designs (no DOM): places every block on pages,
 * splitting long tables and moving the blocks that follow them.
 */
import type { DesignElement, PrintTemplate } from './types';

/** Gap kept at the bottom of a sheet for blocks that flow downwards. */
const BOTTOM_SAFETY_MM = 4;
const ROLL_BOTTOM_MM = 4;
const EPSILON = 0.05;

export interface TableMeasure {
  headerHeight: number;
  /** Height of each printed row (one entry per row group when repeatAcross > 1). */
  rowHeights: number[];
}

export interface PlacedElement {
  element: DesignElement;
  y: number;
  /** Tables only: the row groups [from, to) printed in this piece. */
  rows?: [number, number];
}

export interface LayoutPage {
  height: number;
  items: PlacedElement[];
}

const TOKEN = /\{\{\s*([\w.]+)\s*\}\}/g;

/**
 * Replaces {{field}} placeholders. A line made for placeholders that are all empty is
 * left out, so "NIC: {{customer.nic}}" disappears for a customer without a NIC.
 */
export function resolveText(text: string, fields: Record<string, string>): string {
  return text
    .split('\n')
    .flatMap((line) => {
      const keys = Array.from(line.matchAll(TOKEN), (match) => match[1]);
      if (keys.length > 0 && keys.every((key) => !fields[key])) return [];
      return [line.replace(TOKEN, (_, key: string) => fields[key] ?? '')];
    })
    .join('\n');
}

/** Tables ordered so a table comes after the table it follows (loops are broken). */
function orderTables(tables: DesignElement[]): { table: DesignElement; anchor: DesignElement | null }[] {
  const byId = new Map(tables.map((table) => [table.id, table]));
  const ordered: { table: DesignElement; anchor: DesignElement | null }[] = [];
  const done = new Set<string>();
  const visiting = new Set<string>();

  const visit = (table: DesignElement) => {
    if (done.has(table.id)) return;
    visiting.add(table.id);
    let anchor = table.follows ? (byId.get(table.follows) ?? null) : null;
    if (anchor && visiting.has(anchor.id)) anchor = null;
    if (anchor) visit(anchor);
    visiting.delete(table.id);
    done.add(table.id);
    ordered.push({ table, anchor });
  };

  tables.forEach(visit);
  return ordered;
}

interface TableEnd {
  element: DesignElement;
  page: number;
  y: number;
  /** Where content continues at the top of a following page. */
  continueY: number;
  /** Set when the following blocks moved to the next page: their designed top. */
  movedTop: number | null;
}

export function layoutDocument(
  template: PrintTemplate,
  measures: Record<string, TableMeasure>
): LayoutPage[] {
  const { height_mm: paperHeight } = template.paper;
  const roll = paperHeight <= 0;
  const flowLimit = roll ? Infinity : paperHeight - BOTTOM_SAFETY_MM;
  const placed: PlacedElement[][] = [[]];
  const put = (page: number, item: PlacedElement) => {
    while (placed.length <= page) placed.push([]);
    placed[page].push(item);
  };

  // Blocks that follow a table keep their designed distance below its last row.
  const placeFollowers = (end: TableEnd) => {
    const group = template.elements.filter(
      (element) => element.follows === end.element.id && !(element.type === 'table' && element.table)
    );
    if (group.length === 0) return;

    const offset = end.y - (end.element.y + end.element.h);
    const bottom = Math.max(...group.map((element) => element.y + offset + element.h));
    const designedBottom = Math.max(...group.map((element) => element.y + element.h));
    // Move the whole group to a new page when it would run off the sheet.
    const overflows = !roll && bottom > Math.max(paperHeight, designedBottom) + EPSILON;
    const top = Math.min(...group.map((element) => element.y));
    if (overflows) end.movedTop = top;

    for (const element of group) {
      if (overflows) put(end.page + 1, { element, y: end.continueY + (element.y - top) });
      else put(end.page, { element, y: element.y + offset });
    }
  };

  const tables = template.elements.filter((element) => element.type === 'table' && element.table);
  const tableIds = new Set(tables.map((table) => table.id));
  const ends = new Map<string, TableEnd>();

  for (const { table, anchor } of orderTables(tables)) {
    const measure = measures[table.id] ?? { headerHeight: 0, rowHeights: [] };
    const header = table.table?.showHeader === false ? 0 : measure.headerHeight;
    const end = anchor ? ends.get(anchor.id) : undefined;

    let page = 0;
    let y = table.y;
    let continueY = table.y;
    // A table on its own stays inside its box; one that follows another may use the rest of the sheet.
    let limit = roll ? Infinity : table.y + table.h;

    if (end) {
      page = end.page;
      y = end.y + (table.y - (end.element.y + end.element.h));
      continueY = end.continueY;
      limit = Math.max(flowLimit, roll ? Infinity : table.y + table.h);
      // The blocks around it moved to the next page: this table goes with them.
      if (end.movedTop !== null) {
        page += 1;
        y = continueY + Math.max(0, table.y - end.movedTop);
      }
    }

    const heights = measure.rowHeights;
    let next = 0;

    // Not even the first row fits under the previous table: start on a new page.
    if (end && heights.length > 0 && y > continueY && y + header + heights[0] > limit + EPSILON) {
      page += 1;
      y = continueY;
    }

    for (;;) {
      const from = next;
      let used = header;
      while (next < heights.length && y + used + heights[next] <= limit + EPSILON) {
        used += heights[next];
        next += 1;
      }
      // A single row taller than the box is printed anyway, never dropped.
      if (next === from && next < heights.length) {
        used += heights[next];
        next += 1;
      }
      put(page, { element: table, y, rows: [from, next] });

      if (next >= heights.length) {
        const end: TableEnd = { element: table, page, y: y + used, continueY, movedTop: null };
        ends.set(table.id, end);
        placeFollowers(end);
        break;
      }
      page += 1;
      y = continueY;
    }
  }

  // Everything else that does not follow a table stays where it was designed.
  const fixed = template.elements.filter(
    (element) => !tableIds.has(element.id) && !(element.follows && ends.has(element.follows))
  );

  const lastPage = placed.length - 1;
  for (const element of fixed) {
    const pages = element.pages ?? 'all';
    if (pages === 'first') put(0, { element, y: element.y });
    else if (pages === 'last') put(lastPage, { element, y: element.y });
    else for (let page = 0; page <= lastPage; page += 1) put(page, { element, y: element.y });
  }

  // Keep the designed stacking order (later blocks draw on top).
  const order = new Map(template.elements.map((element, index) => [element.id, index]));

  return placed.map((items) => {
    items.sort((a, b) => order.get(a.element.id)! - order.get(b.element.id)!);
    const contentBottom = items.reduce((max, item) => {
      let height = item.element.h;
      if (item.rows) {
        const measure = measures[item.element.id] ?? { headerHeight: 0, rowHeights: [] };
        const header = item.element.table?.showHeader === false ? 0 : measure.headerHeight;
        height = header + measure.rowHeights.slice(item.rows[0], item.rows[1]).reduce((a, b) => a + b, 0);
      }
      return Math.max(max, item.y + height);
    }, 0);

    return { items, height: roll ? Math.max(30, Math.ceil(contentBottom + ROLL_BOTTOM_MM)) : paperHeight };
  });
}
