import { isShape } from '../model/doc';
import type { Connector, Doc, Endpoint, Point, Shape } from '../model/types';
import { SHAPES } from '../shapes/library';

export interface Anchor {
  p: Point;
  /** Direction the line leaves the shape; null for a free end. */
  dir: Point | null;
}

/** How far an elbow line runs straight out of a port before turning. */
const STUB = 20;

const dist2 = (a: Point, b: Point) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

export function shapePorts(s: Shape): Anchor[] {
  return SHAPES[s.kind].ports(s.w, s.h).map((pt) => ({ p: { x: s.x + pt.x, y: s.y + pt.y }, dir: pt.dir }));
}

/** Rough position of an end, used to pick the facing port on the other end. */
function anchorGuess(doc: Doc, ep: Endpoint): Point {
  const s = ep.shapeId ? doc.items[ep.shapeId] : undefined;
  if (!isShape(s)) return { x: ep.x, y: ep.y };
  if (ep.port != null) {
    const port = shapePorts(s)[ep.port];
    if (port) return port.p;
  }
  return { x: s.x + s.w / 2, y: s.y + s.h / 2 };
}

/**
 * Where the line from the shape's center toward `towards` crosses its bounding box, with the
 * outward direction of the side it crosses (so elbow routes still leave squarely).
 */
export function perimeterAnchor(s: Shape, towards: Point): Anchor {
  const cx = s.x + s.w / 2;
  const cy = s.y + s.h / 2;
  const dx = towards.x - cx;
  const dy = towards.y - cy;
  if (dx === 0 && dy === 0) return { p: { x: cx, y: s.y }, dir: { x: 0, y: -1 } };
  const tx = dx === 0 ? Infinity : s.w / 2 / Math.abs(dx);
  const ty = dy === 0 ? Infinity : s.h / 2 / Math.abs(dy);
  const t = Math.min(tx, ty);
  return {
    p: { x: cx + dx * t, y: cy + dy * t },
    dir: tx < ty ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) },
  };
}

export function resolveEndpoint(doc: Doc, ep: Endpoint, towards: Point): Anchor {
  const s = ep.shapeId ? doc.items[ep.shapeId] : undefined;
  if (!isShape(s)) return { p: { x: ep.x, y: ep.y }, dir: null };
  if (ep.perimeter && ep.port == null) return perimeterAnchor(s, towards);
  const ports = shapePorts(s);
  if (ep.port != null && ports[ep.port]) return ports[ep.port];
  return ports.reduce((best, pt) => (dist2(pt.p, towards) < dist2(best.p, towards) ? pt : best));
}

/** Direction along the dominant axis from `from` toward `to`. */
function axisDir(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return Math.abs(dx) >= Math.abs(dy) ? { x: Math.sign(dx) || 1, y: 0 } : { x: 0, y: Math.sign(dy) || 1 };
}

/** Drops repeated points and points in the middle of a straight run. */
export function simplify(pts: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.01 && Math.abs(last.y - p.y) < 0.01) continue;
    const prev = out[out.length - 2];
    if (
      prev &&
      last &&
      ((Math.abs(prev.x - last.x) < 0.01 && Math.abs(last.x - p.x) < 0.01) ||
        (Math.abs(prev.y - last.y) < 0.01 && Math.abs(last.y - p.y) < 0.01))
    ) {
      out[out.length - 1] = p;
      continue;
    }
    out.push(p);
  }
  return out;
}

/** Orthogonal route between two anchors. */
export function elbowRoute(a: Anchor, b: Anchor): Point[] {
  const d1 = a.dir ?? axisDir(a.p, b.p);
  const d2 = b.dir ?? axisDir(b.p, a.p);
  const s1 = a.dir ? { x: a.p.x + d1.x * STUB, y: a.p.y + d1.y * STUB } : a.p;
  const s2 = b.dir ? { x: b.p.x + d2.x * STUB, y: b.p.y + d2.y * STUB } : b.p;
  const h1 = d1.x !== 0;
  const h2 = d2.x !== 0;
  let mid: Point[];

  if (h1 && h2) {
    if (d1.x === d2.x) {
      const mx = d1.x > 0 ? Math.max(s1.x, s2.x) : Math.min(s1.x, s2.x);
      mid = [{ x: mx, y: s1.y }, { x: mx, y: s2.y }];
    } else if ((s2.x - s1.x) * d1.x >= 0) {
      const mx = (s1.x + s2.x) / 2;
      mid = [{ x: mx, y: s1.y }, { x: mx, y: s2.y }];
    } else {
      const my = (s1.y + s2.y) / 2;
      mid = [{ x: s1.x, y: my }, { x: s2.x, y: my }];
    }
  } else if (!h1 && !h2) {
    if (d1.y === d2.y) {
      const my = d1.y > 0 ? Math.max(s1.y, s2.y) : Math.min(s1.y, s2.y);
      mid = [{ x: s1.x, y: my }, { x: s2.x, y: my }];
    } else if ((s2.y - s1.y) * d1.y >= 0) {
      const my = (s1.y + s2.y) / 2;
      mid = [{ x: s1.x, y: my }, { x: s2.x, y: my }];
    } else {
      const mx = (s1.x + s2.x) / 2;
      mid = [{ x: mx, y: s1.y }, { x: mx, y: s2.y }];
    }
  } else if (h1) {
    const c = { x: s2.x, y: s1.y };
    const ok = (c.x - s1.x) * d1.x >= 0 && (c.y - s2.y) * d2.y >= 0;
    mid = [ok ? c : { x: s1.x, y: s2.y }];
  } else {
    const c = { x: s1.x, y: s2.y };
    const ok = (c.y - s1.y) * d1.y >= 0 && (c.x - s2.x) * d2.x >= 0;
    mid = [ok ? c : { x: s2.x, y: s1.y }];
  }

  return simplify([a.p, s1, ...mid, s2, b.p]);
}

export function connectorPoints(doc: Doc, c: Connector): Point[] {
  const a = resolveEndpoint(doc, c.source, anchorGuess(doc, c.target));
  const b = resolveEndpoint(doc, c.target, anchorGuess(doc, c.source));
  return c.routing === 'straight' ? [a.p, b.p] : elbowRoute(a, b);
}

/** Point halfway along a polyline, measured by length. */
export function polylineMidpoint(pts: Point[]): Point {
  const lens = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y));
  let remaining = lens.reduce((a, b) => a + b, 0) / 2;
  for (let i = 0; i < lens.length; i++) {
    if (remaining <= lens[i] && lens[i] > 0) {
      const t = remaining / lens[i];
      return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * t, y: pts[i].y + (pts[i + 1].y - pts[i].y) * t };
    }
    remaining -= lens[i];
  }
  return pts[0];
}

/**
 * Point `dist` along a polyline from its start (or its end, with `fromEnd`), with the unit
 * direction of travel there. Clamped to the far end of the line.
 */
export function pointAlong(pts: Point[], dist: number, fromEnd = false): { p: Point; dir: Point } {
  const path = fromEnd ? [...pts].reverse() : pts;
  let remaining = Math.max(0, dist);
  let dir = { x: 1, y: 0 };
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) continue;
    dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    if (remaining <= len) return { p: { x: a.x + dir.x * remaining, y: a.y + dir.y * remaining }, dir };
    remaining -= len;
  }
  return { p: path[path.length - 1] ?? { x: 0, y: 0 }, dir };
}

/** Finds where a dragged connector end should attach: a port, a shape body, or nowhere. */
export function findAttachment(doc: Doc, p: Point, portRadius: number): Endpoint | null {
  let best: Endpoint | null = null;
  let bestD = portRadius ** 2;
  for (const id of doc.order) {
    const s = doc.items[id];
    if (!isShape(s)) continue;
    const ports = shapePorts(s);
    for (let i = 0; i < ports.length; i++) {
      const d = dist2(ports[i].p, p);
      if (d <= bestD) {
        bestD = d;
        best = { shapeId: s.id, port: i, x: p.x, y: p.y };
      }
    }
  }
  if (best) return best;
  for (let i = doc.order.length - 1; i >= 0; i--) {
    const s = doc.items[doc.order[i]];
    if (isShape(s) && p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h) {
      return { shapeId: s.id, x: p.x, y: p.y };
    }
  }
  return null;
}
