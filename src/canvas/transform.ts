import type { Point, Rect, Shape } from '../model/types';

// Rotation math for shapes. A leaf module (types only) so routing and geometry can both use it.

export type Handle = 'nw' | 'ne' | 'se' | 'sw';

const RAD = Math.PI / 180;
const ORIGIN = { x: 0, y: 0 };

export const rotationOf = (s: { rotation?: number }) => s.rotation ?? 0;

/** Maps any angle into [0, 360). */
export const normalizeAngle = (deg: number) => ((deg % 360) + 360) % 360;

export const rectCenter = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** Rotates `p` clockwise (in screen coordinates, y down) by `deg` around `c`. */
export function rotatePoint(p: Point, c: Point, deg: number): Point {
  if (!deg) return { x: p.x, y: p.y };
  const cos = Math.cos(deg * RAD);
  const sin = Math.sin(deg * RAD);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

/** Shape-local point, (0,0)–(w,h), to world coordinates. */
export const localToWorld = (s: Shape, p: Point): Point =>
  rotatePoint({ x: s.x + p.x, y: s.y + p.y }, rectCenter(s), rotationOf(s));

/** World point to shape-local coordinates, (0,0)–(w,h). */
export function worldToLocal(s: Shape, p: Point): Point {
  const q = rotatePoint(p, rectCenter(s), -rotationOf(s));
  return { x: q.x - s.x, y: q.y - s.y };
}

/** Axis-aligned bounds of a shape, including its rotation. */
export function shapeBox(s: Shape): Rect {
  if (!rotationOf(s)) return { x: s.x, y: s.y, w: s.w, h: s.h };
  const pts = [
    { x: 0, y: 0 },
    { x: s.w, y: 0 },
    { x: s.w, y: s.h },
    { x: 0, y: s.h },
  ].map((p) => localToWorld(s, p));
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Whether `p` is inside the shape's (rotated) bounding rect, grown by `pad`. */
export function pointInShape(p: Point, s: Shape, pad = 0): boolean {
  const l = worldToLocal(s, p);
  return l.x >= -pad && l.x <= s.w + pad && l.y >= -pad && l.y <= s.h + pad;
}

/** Rotates a unit direction and snaps it to the nearest axis (elbow routing only leaves ports along an axis). */
export function rotateDir(d: Point, deg: number): Point {
  const r = rotatePoint(d, ORIGIN, deg);
  return Math.abs(r.x) >= Math.abs(r.y) ? { x: Math.sign(r.x), y: 0 } : { x: 0, y: Math.sign(r.y) };
}

/**
 * Snaps a rotation-handle angle: whole degrees (15° steps with Shift), pulled onto
 * right angles when within 3°.
 */
export function snapAngle(deg: number, coarse: boolean): number {
  const step = coarse ? 15 : 1;
  let a = Math.round(normalizeAngle(deg) / step) * step;
  const right = Math.round(a / 90) * 90;
  if (Math.abs(a - right) <= 3) a = right;
  return normalizeAngle(a);
}

/**
 * New bounds of a (possibly rotated) shape when the corner `handle` is dragged by world
 * `delta`. The opposite corner stays fixed on screen. `snap` (grid) is only applied to
 * unrotated shapes, whose edges are world-aligned. With `keepAspect` the shape scales
 * uniformly, following whichever axis the drag changed most (no grid snap).
 */
export function resizeRect(
  orig: Rect,
  rotation: number,
  handle: Handle,
  delta: Point,
  minSize: number,
  snap: (v: number) => number = (v) => v,
  keepAspect = false,
): Rect {
  const d = rotatePoint(delta, ORIGIN, -rotation);
  // Edges in the shape's local frame, relative to its original top-left.
  let left = 0;
  let right = orig.w;
  let top = 0;
  let bottom = orig.h;
  const sx = (v: number) => (rotation || keepAspect ? v : snap(orig.x + v) - orig.x);
  const sy = (v: number) => (rotation || keepAspect ? v : snap(orig.y + v) - orig.y);
  if (handle.includes('w')) left = sx(d.x);
  if (handle.includes('e')) right = sx(orig.w + d.x);
  if (handle.includes('n')) top = sy(d.y);
  if (handle.includes('s')) bottom = sy(orig.h + d.y);
  if (keepAspect && orig.w > 0 && orig.h > 0) {
    const fx = (right - left) / orig.w;
    const fy = (bottom - top) / orig.h;
    const f = Math.max(Math.abs(fx - 1) >= Math.abs(fy - 1) ? fx : fy, minSize / Math.min(orig.w, orig.h));
    const w = orig.w * f;
    const h = orig.h * f;
    if (handle.includes('w')) left = orig.w - w;
    else right = w;
    if (handle.includes('n')) top = orig.h - h;
    else bottom = h;
  }
  if (right - left < minSize) {
    if (handle.includes('w')) left = right - minSize;
    else right = left + minSize;
  }
  if (bottom - top < minSize) {
    if (handle.includes('n')) top = bottom - minSize;
    else bottom = top + minSize;
  }
  const w = right - left;
  const h = bottom - top;
  // Move the new center out from the old one along the rotated axes.
  const c0 = rectCenter(orig);
  const offset = { x: left + w / 2 - orig.w / 2, y: top + h / 2 - orig.h / 2 };
  const c = rotatePoint({ x: c0.x + offset.x, y: c0.y + offset.y }, c0, rotation);
  return { x: c.x - w / 2, y: c.y - h / 2, w, h };
}
