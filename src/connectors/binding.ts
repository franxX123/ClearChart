import { attachFrame, localToWorld, rotateDir, rotationOf, worldToLocal } from '../canvas/transform';
import type { Point, Rect, Shape } from '../model/types';
import { SHAPES } from '../shapes/library';

// Pinned arrow ends: where on a shape an end attaches, and how that point moves with the shape.

/** Closest point to `p` on a closed polygon's edges, and its distance. */
export function nearestOnPolygon(poly: Point[], p: Point): { point: Point; dist: number } {
  let best = { point: poly[0], dist: Infinity };
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    const q = { x: a.x + dx * t, y: a.y + dy * t };
    const dist = Math.hypot(p.x - q.x, p.y - q.y);
    if (dist < best.dist) best = { point: q, dist };
  }
  return best;
}

/** The area arrows attach to, in the shape's local frame: its box, or its box plus the text beside it. */
export const localFrame = (s: Shape): Rect => attachFrame(s) ?? { x: 0, y: 0, w: s.w, h: s.h };

const rectPoints = (r: Rect): Point[] => [
  { x: r.x, y: r.y },
  { x: r.x + r.w, y: r.y },
  { x: r.x + r.w, y: r.y + r.h },
  { x: r.x, y: r.y + r.h },
];

/**
 * The outline arrow ends snap onto, in the shape's local frame: the kind's outline, or for a
 * shape with text beside it, the rectangle around the shape and its text.
 */
export function localOutline(s: Shape): Point[] {
  const frame = attachFrame(s);
  return frame ? rectPoints(frame) : SHAPES[s.kind].outline(s.w, s.h);
}

/**
 * Where an arrow end dropped at world point `p` pins onto shape `s`: snapped onto the outline
 * when within `snap` of it, otherwise exactly where it was dropped (e.g. inside a picture, or on
 * the text beside it). Returned as fractions of the shape's unrotated box (beyond 0–1 on the
 * text beside it), so it follows moves, resizes and rotation.
 */
export function bindPoint(s: Shape, p: Point, snap: number): Point {
  const local = worldToLocal(s, p);
  const edge = nearestOnPolygon(localOutline(s), local);
  const q = edge.dist <= snap ? edge.point : local;
  const f = localFrame(s);
  const clamp = (v: number, lo: number, len: number) => Math.max(lo, Math.min(lo + len, v));
  const frac = (v: number, size: number) => (size > 0 ? v / size : 0.5);
  return { x: frac(clamp(q.x, f.x, f.w), s.w), y: frac(clamp(q.y, f.y, f.h), s.h) };
}

/** World position of a pinned point. */
export const pinnedPoint = (s: Shape, at: Point): Point => localToWorld(s, { x: at.x * s.w, y: at.y * s.h });

/**
 * Direction an elbow line leaves a pinned point: straight out of the nearest side of the
 * shape's box (with any text beside it), turned with the shape and snapped to an axis.
 */
export function pinnedDir(s: Shape, at: Point): Point {
  const f = localFrame(s);
  const x = at.x * s.w;
  const y = at.y * s.h;
  const sides: [number, Point][] = [
    [y - f.y, { x: 0, y: -1 }],
    [f.x + f.w - x, { x: 1, y: 0 }],
    [f.y + f.h - y, { x: 0, y: 1 }],
    [x - f.x, { x: -1, y: 0 }],
  ];
  const nearest = sides.reduce((best, side) => (side[0] < best[0] ? side : best));
  return rotateDir(nearest[1], rotationOf(s));
}
