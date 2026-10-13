import type { Point, Rect, Shape } from '../model/types';
import { cssFont, LINE_HEIGHT, measureText } from './text';

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

/** Gap between a shape and the text drawn to its right (`textPosition: 'right'`), in px. */
export const SIDE_GAP = 8;
/** Padding inside a side label's box, left of its text. */
export const SIDE_PAD = 2;

/**
 * Where a shape's text sits when it's drawn to the right of the shape: a rect in the shape's
 * local frame, vertically centered on the box, text left-aligned (one line per line break, not
 * wrapped). Null when the text is inside or empty.
 */
export function sideLabelBox(s: Shape): Rect | null {
  if (s.textPosition !== 'right' || !s.text) return null;
  const st = s.style;
  const lines = s.text.split('\n');
  const font = cssFont(st.fontSize, st.bold, st.italic);
  const w = Math.max(...lines.map((l) => measureText(l, font, st.fontSize))) + SIDE_PAD * 2;
  const h = lines.length * st.fontSize * LINE_HEIGHT;
  return { x: s.w + SIDE_GAP, y: s.h / 2 - h / 2, w, h };
}

/**
 * The rect, in the shape's local frame, that arrows attach to and lines route around when the
 * shape has text beside it: its box and the text together, so a line can end on the text too.
 * Null for other shapes (they attach to their kind's outline).
 */
export function attachFrame(s: Shape): Rect | null {
  const label = sideLabelBox(s);
  if (!label) return null;
  const top = Math.min(0, label.y);
  return { x: 0, y: top, w: label.x + label.w, h: Math.max(s.h, label.y + label.h) - top };
}

/** World-space bounds of a local rect of a shape (rotated with it). */
export function localRectBox(s: Shape, r: Rect): Rect {
  const pts = [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ].map((p) => localToWorld(s, p));
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Bounds of everything a shape draws: its (rotated) box plus any text beside it. */
export function shapeExtent(s: Shape): Rect {
  const frame = attachFrame(s);
  return frame ? localRectBox(s, frame) : shapeBox(s);
}

/**
 * Whether `p` is on the shape: inside its (rotated) bounding rect, or its text beside it
 * (`attachFrame`), grown by `pad`.
 */
export function pointInShape(p: Point, s: Shape, pad = 0): boolean {
  const l = worldToLocal(s, p);
  const f = attachFrame(s) ?? { x: 0, y: 0, w: s.w, h: s.h };
  return l.x >= f.x - pad && l.x <= f.x + f.w + pad && l.y >= f.y - pad && l.y <= f.y + f.h + pad;
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
