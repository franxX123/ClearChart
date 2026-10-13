import { connectorPoints } from '../connectors/routing';
import { isConnector, isShape } from '../model/doc';
import { isInteractive, isVisible, renderOrder } from '../model/page';
import type { Page, Point, Rect, Shape } from '../model/types';
import { pointInShape, shapeBox } from './transform';

export { localToWorld, pointInShape, resizeRect, rotatePoint, shapeBox, worldToLocal } from './transform';

export const GRID = 10;

export const snapToGrid = (v: number, grid = GRID) => Math.round(v / grid) * grid;

export const normRect = (a: Point, b: Point): Rect => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  w: Math.abs(a.x - b.x),
  h: Math.abs(a.y - b.y),
});

export const pointInRect = (p: Point, r: Rect, pad = 0) =>
  p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad;

export const rectContains = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.w <= outer.x + outer.w &&
  inner.y + inner.h <= outer.y + outer.h;

export function boundsOfPoints(pts: Point[]): Rect | null {
  if (pts.length === 0) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function unionRects(rects: Rect[]): Rect | null {
  return boundsOfPoints(rects.flatMap((r) => [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y + r.h }]));
}

/** Topmost selectable shape under `p` (hidden and locked layers are skipped). */
export function hitShape(page: Page, p: Point, pad = 0): Shape | null {
  const order = renderOrder(page);
  for (let i = order.length - 1; i >= 0; i--) {
    const it = page.items[order[i]];
    if (isShape(it) && isInteractive(page, it) && pointInShape(p, it, pad)) return it;
  }
  return null;
}

/** Axis-aligned bounds of everything an item draws, in world coordinates. */
export function itemBounds(page: Page, id: string): Rect | null {
  const it = page.items[id];
  if (isShape(it)) return shapeBox(it);
  if (isConnector(it)) return boundsOfPoints(connectorPoints(page, it));
  return null;
}

/** Bounds of the visible items on a page. */
export function docBounds(page: Page): Rect | null {
  return unionRects(
    page.order
      .filter((id) => isVisible(page, page.items[id]))
      .map((id) => itemBounds(page, id))
      .filter((r): r is Rect => r !== null),
  );
}

/** Selectable items lying fully inside `r`. */
export function itemsInRect(page: Page, r: Rect): string[] {
  return page.order.filter((id) => {
    if (!isInteractive(page, page.items[id])) return false;
    const b = itemBounds(page, id);
    return b !== null && rectContains(r, b);
  });
}
