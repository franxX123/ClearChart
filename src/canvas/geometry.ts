import { connectorPoints } from '../connectors/routing';
import { isConnector, isShape } from '../model/doc';
import type { Doc, Point, Rect, Shape } from '../model/types';

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

/** Topmost shape under `p`. */
export function hitShape(doc: Doc, p: Point, pad = 0): Shape | null {
  for (let i = doc.order.length - 1; i >= 0; i--) {
    const it = doc.items[doc.order[i]];
    if (isShape(it) && pointInRect(p, it, pad)) return it;
  }
  return null;
}

/** Bounds of everything an item draws, in world coordinates. */
export function itemBounds(doc: Doc, id: string): Rect | null {
  const it = doc.items[id];
  if (isShape(it)) return { x: it.x, y: it.y, w: it.w, h: it.h };
  if (isConnector(it)) return boundsOfPoints(connectorPoints(doc, it));
  return null;
}

export function docBounds(doc: Doc): Rect | null {
  return unionRects(doc.order.map((id) => itemBounds(doc, id)).filter((r): r is Rect => r !== null));
}

export function itemsInRect(doc: Doc, r: Rect): string[] {
  return doc.order.filter((id) => {
    const b = itemBounds(doc, id);
    return b !== null && rectContains(r, b);
  });
}
