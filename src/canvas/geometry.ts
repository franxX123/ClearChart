import { connectorPoints } from '../connectors/routing';
import { isConnector, isShape } from '../model/doc';
import type { Doc, Point, Rect, Shape } from '../model/types';

export const GRID = 10;

export const snapToGrid = (v: number, grid = GRID) => Math.round(v / grid) * grid;

/** Resize handle at a shape corner. */
export type Handle = 'nw' | 'ne' | 'se' | 'sw';
/** Smallest width or height a resize leaves. */
export const MIN_SIZE = 10;

/**
 * Bounds of `orig` after its `handle` corner is dragged by (dx, dy). Moved edges snap to `grid`
 * (0 = no snapping). With `keepRatio` the opposite corner stays put and the size scales
 * uniformly, by the drag projected onto the shape's diagonal (so a circle stays a circle); the
 * grid is ignored then, since snapping both sides would break the proportions.
 */
export function resizeRect(
  orig: Rect,
  handle: Handle,
  dx: number,
  dy: number,
  { keepRatio = false, grid = 0 }: { keepRatio?: boolean; grid?: number } = {},
): Rect {
  const west = handle.includes('w');
  const north = handle.includes('n');
  if (keepRatio) {
    const w = orig.w + (west ? -dx : dx);
    const h = orig.h + (north ? -dy : dy);
    const fit = (w * orig.w + h * orig.h) / (orig.w * orig.w + orig.h * orig.h);
    const s = Math.max(fit, MIN_SIZE / Math.min(orig.w, orig.h));
    const nw = orig.w * s;
    const nh = orig.h * s;
    return { x: west ? orig.x + orig.w - nw : orig.x, y: north ? orig.y + orig.h - nh : orig.y, w: nw, h: nh };
  }
  const g = (v: number) => (grid ? snapToGrid(v, grid) : v);
  let left = orig.x;
  let right = orig.x + orig.w;
  let top = orig.y;
  let bottom = orig.y + orig.h;
  if (west) left = g(left + dx);
  else right = g(right + dx);
  if (north) top = g(top + dy);
  else bottom = g(bottom + dy);
  if (right - left < MIN_SIZE) {
    if (west) left = right - MIN_SIZE;
    else right = left + MIN_SIZE;
  }
  if (bottom - top < MIN_SIZE) {
    if (north) top = bottom - MIN_SIZE;
    else bottom = top + MIN_SIZE;
  }
  return { x: left, y: top, w: right - left, h: bottom - top };
}

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
