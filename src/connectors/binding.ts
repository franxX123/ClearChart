import { localToWorld, rotateDir, rotationOf, worldToLocal } from '../canvas/transform';
import type { Point, Shape } from '../model/types';
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

/**
 * Where an arrow end dropped at world point `p` pins onto shape `s`: snapped onto the outline
 * when within `snap` of it, otherwise exactly where it was dropped (e.g. inside a picture).
 * Returned as fractions of the shape's unrotated box, so it follows moves, resizes and rotation.
 */
export function bindPoint(s: Shape, p: Point, snap: number): Point {
  const local = worldToLocal(s, p);
  const edge = nearestOnPolygon(SHAPES[s.kind].outline(s.w, s.h), local);
  const q = edge.dist <= snap ? edge.point : local;
  const frac = (v: number, size: number) => (size > 0 ? Math.max(0, Math.min(1, v / size)) : 0.5);
  return { x: frac(q.x, s.w), y: frac(q.y, s.h) };
}

/** World position of a pinned point. */
export const pinnedPoint = (s: Shape, at: Point): Point => localToWorld(s, { x: at.x * s.w, y: at.y * s.h });

/**
 * Direction an elbow line leaves a pinned point: straight out of the nearest side of the
 * shape's box, turned with the shape and snapped to an axis.
 */
export function pinnedDir(s: Shape, at: Point): Point {
  const sides: [number, Point][] = [
    [at.y * s.h, { x: 0, y: -1 }],
    [(1 - at.x) * s.w, { x: 1, y: 0 }],
    [(1 - at.y) * s.h, { x: 0, y: 1 }],
    [at.x * s.w, { x: -1, y: 0 }],
  ];
  const nearest = sides.reduce((best, side) => (side[0] < best[0] ? side : best));
  return rotateDir(nearest[1], rotationOf(s));
}
