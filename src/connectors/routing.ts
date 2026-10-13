import {
  attachFrame,
  localRectBox,
  localToWorld,
  pointInShape,
  rectCenter,
  rotateDir,
  rotationOf,
  shapeBox,
  shapeExtent,
  worldToLocal,
} from '../canvas/transform';
import { isShape } from '../model/doc';
import { isInteractive, isVisible, renderOrder } from '../model/page';
import type { Connector, Endpoint, Page, Point, Rect, Shape } from '../model/types';
import { SHAPES, type PortDef } from '../shapes/library';
import { bindPoint, localFrame, localOutline, nearestOnPolygon, pinnedDir, pinnedPoint } from './binding';

export interface Anchor {
  p: Point;
  /** Direction the line leaves the shape; null for a free end. */
  dir: Point | null;
  /** Bounds of the shape the end is attached to, so obstacle routing can leave it cleanly. */
  box?: Rect;
}

/** How far an elbow line runs straight out of a port before turning. */
const STUB = 20;
/** Gap obstacle routing keeps between a line and the shapes it goes around. */
const CLEARANCE = 10;
/** Cost of one bend, in px of length: A* prefers fewer turns over slightly shorter paths. */
const BEND_COST = 40;
/** Obstacle routing ignores shapes further than this outside the box spanning both ends. */
const SEARCH_MARGIN = 200;
const EPS = 0.5;

const dist2 = (a: Point, b: Point) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

/**
 * A shape's ports in its local frame: its kind's ports, or for a shape with text beside it, the
 * middles of the sides of the rectangle around the shape and its text (top/right/bottom/left).
 */
function localPorts(s: Shape): PortDef[] {
  const f = attachFrame(s);
  if (!f) return SHAPES[s.kind].ports(s.w, s.h);
  return [
    { x: f.x + f.w / 2, y: f.y, dir: { x: 0, y: -1 } },
    { x: f.x + f.w, y: f.y + f.h / 2, dir: { x: 1, y: 0 } },
    { x: f.x + f.w / 2, y: f.y + f.h, dir: { x: 0, y: 1 } },
    { x: f.x, y: f.y + f.h / 2, dir: { x: -1, y: 0 } },
  ];
}

/** World bounds of what a line attached to `s` leaves from (its box, with any text beside it). */
const attachBox = (s: Shape): Rect => {
  const f = attachFrame(s);
  return f ? localRectBox(s, f) : shapeBox(s);
};

/** A shape's ports in world coordinates. On a rotated shape, directions snap to the nearest axis. */
export function shapePorts(s: Shape): Anchor[] {
  const rot = rotationOf(s);
  return localPorts(s).map((pt) => ({ p: localToWorld(s, pt), dir: rotateDir(pt.dir, rot) }));
}

/** Rough position of an end, used to pick the facing port on the other end. */
function anchorGuess(page: Page, ep: Endpoint): Point {
  const s = ep.shapeId ? page.items[ep.shapeId] : undefined;
  if (!isShape(s)) return { x: ep.x, y: ep.y };
  if (ep.at) return pinnedPoint(s, ep.at);
  if (ep.port != null) {
    const port = shapePorts(s)[ep.port];
    if (port) return port.p;
  }
  return rectCenter(s);
}

export function resolveEndpoint(page: Page, ep: Endpoint, towards: Point): Anchor {
  const s = ep.shapeId ? page.items[ep.shapeId] : undefined;
  if (!isShape(s)) return { p: { x: ep.x, y: ep.y }, dir: null };
  const box = attachBox(s);
  if (ep.at) return { p: pinnedPoint(s, ep.at), dir: pinnedDir(s, ep.at), box };
  // A fixed port (files from before pinned arrows), or floating: the port facing the other end.
  const ports = shapePorts(s);
  if (ep.port != null && ports[ep.port]) return { ...ports[ep.port], box };
  return { ...ports[floatingPort(ports, towards)], box };
}

/** The port a floating end uses: the one nearest `towards`. */
function floatingPort(ports: Anchor[], towards: Point): number {
  let best = 0;
  ports.forEach((pt, i) => {
    if (dist2(pt.p, towards) < dist2(ports[best].p, towards)) best = i;
  });
  return best;
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

/** Orthogonal route between two anchors by case analysis; ignores obstacles. */
function directElbow(a: Anchor, b: Anchor): Point[] {
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

const inflate = (r: Rect, by: number): Rect => ({ x: r.x - by, y: r.y - by, w: r.w + by * 2, h: r.h + by * 2 });

const strictlyInside = (p: Point, r: Rect) =>
  p.x > r.x + EPS && p.x < r.x + r.w - EPS && p.y > r.y + EPS && p.y < r.y + r.h - EPS;

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Whether an axis-aligned segment passes through the interior of `r` (running along an edge doesn't count). */
function segmentHitsRect(p: Point, q: Point, r: Rect): boolean {
  if (Math.abs(p.y - q.y) < 1e-9) {
    if (p.y <= r.y + EPS || p.y >= r.y + r.h - EPS) return false;
    return Math.max(Math.min(p.x, q.x), r.x) < Math.min(Math.max(p.x, q.x), r.x + r.w) - EPS;
  }
  if (p.x <= r.x + EPS || p.x >= r.x + r.w - EPS) return false;
  return Math.max(Math.min(p.y, q.y), r.y) < Math.min(Math.max(p.y, q.y), r.y + r.h) - EPS;
}

/** Whether an orthogonal polyline crosses the interior of any rect. */
export const routeHits = (pts: Point[], rects: Rect[]) =>
  pts.slice(1).some((q, i) => rects.some((r) => segmentHitsRect(pts[i], q, r)));

/** Where an attached end's stub stops: STUB out from the port, and at least clear of its own shape's margin. */
function stubEnd(an: Anchor): Point {
  if (!an.dir) return an.p;
  let len = STUB;
  if (an.box) {
    const b = inflate(an.box, CLEARANCE);
    const exit =
      an.dir.x > 0 ? b.x + b.w - an.p.x : an.dir.x < 0 ? an.p.x - b.x : an.dir.y > 0 ? b.y + b.h - an.p.y : an.p.y - b.y;
    len = Math.max(len, exit);
  }
  return { x: an.p.x + an.dir.x * len, y: an.p.y + an.dir.y * len };
}

/** Right, down, left, up. Index + 2 (mod 4) is the opposite direction. */
const DIRS: Point[] = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
];
const dirIndex = (d: Point | null) => (d ? DIRS.findIndex((v) => v.x === d.x && v.y === d.y) : -1);

/** Minimal binary min-heap of (priority, value). */
class Heap {
  private items: [number, number][] = [];
  get size() {
    return this.items.length;
  }
  push(prio: number, value: number) {
    const a = this.items;
    a.push([prio, value]);
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (a[parent][0] <= a[i][0]) break;
      [a[parent], a[i]] = [a[i], a[parent]];
      i = parent;
    }
  }
  pop(): number {
    const a = this.items;
    const top = a[0][1];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Shortest orthogonal path from `start` to `goal` around `boxes`, by A* over the sparse grid
 * formed by every box edge and both endpoints. Each bend costs BEND_COST. The path leaves
 * `start` without reversing `startDir`, and arrives at `goal` heading against `goalDir` (the
 * direction the goal's line leaves its port). Returns null when the goal is unreachable.
 */
export function orthogonalPath(
  start: Point,
  startDir: Point | null,
  goal: Point,
  goalDir: Point | null,
  boxes: Rect[],
): Point[] | null {
  const uniq = (v: number[]) => [...new Set(v)].sort((p, q) => p - q);
  const xs = uniq([start.x, goal.x, (start.x + goal.x) / 2, ...boxes.flatMap((b) => [b.x, b.x + b.w])]);
  const ys = uniq([start.y, goal.y, (start.y + goal.y) / 2, ...boxes.flatMap((b) => [b.y, b.y + b.h])]);
  const nx = xs.length;
  const nodes = nx * ys.length;
  const blocked = (p: Point) => boxes.some((b) => strictlyInside(p, b));
  const free = new Uint8Array(nodes);
  for (let j = 0; j < ys.length; j++) {
    for (let i = 0; i < nx; i++) free[j * nx + i] = blocked({ x: xs[i], y: ys[j] }) ? 0 : 1;
  }

  const startNode = ys.indexOf(start.y) * nx + xs.indexOf(start.x);
  const goalNode = ys.indexOf(goal.y) * nx + xs.indexOf(goal.x);
  if (!free[startNode] || !free[goalNode]) return null;
  const arrive = goalDir ? (dirIndex(goalDir) + 2) % 4 : -1;

  // A search state is (node, direction travelled into it); slot 4 means "hasn't moved yet".
  const key = (node: number, dir: number) => node * 5 + (dir < 0 ? 4 : dir);
  const cost = new Float64Array(nodes * 5).fill(Infinity);
  const prev = new Int32Array(nodes * 5).fill(-1);
  const h = (node: number) => Math.abs(xs[node % nx] - goal.x) + Math.abs(ys[Math.floor(node / nx)] - goal.y);
  const heap = new Heap();
  const s0 = key(startNode, dirIndex(startDir));
  cost[s0] = 0;
  heap.push(h(startNode), s0);

  while (heap.size) {
    const state = heap.pop();
    const node = Math.floor(state / 5);
    const dir = state % 5 === 4 ? -1 : state % 5;
    if (node === goalNode) {
      const path: Point[] = [];
      for (let s = state; s !== -1; s = prev[s]) {
        const n = Math.floor(s / 5);
        path.push({ x: xs[n % nx], y: ys[Math.floor(n / nx)] });
      }
      return path.reverse();
    }
    const i = node % nx;
    const j = Math.floor(node / nx);
    for (let nd = 0; nd < 4; nd++) {
      if (dir >= 0 && nd === (dir + 2) % 4) continue;
      const ni = i + DIRS[nd].x;
      const nj = j + DIRS[nd].y;
      if (ni < 0 || nj < 0 || ni >= nx || nj >= ys.length) continue;
      const next = nj * nx + ni;
      // Grid lines include every box edge, so a step is clear iff its midpoint is.
      if (!free[next] || blocked({ x: (xs[i] + xs[ni]) / 2, y: (ys[j] + ys[nj]) / 2 })) continue;
      let c = cost[state] + Math.abs(xs[ni] - xs[i]) + Math.abs(ys[nj] - ys[j]);
      if (dir >= 0 && nd !== dir) c += BEND_COST;
      if (next === goalNode && arrive >= 0) {
        if (nd === (arrive + 2) % 4) continue;
        if (nd !== arrive) c += BEND_COST;
      }
      const ns = key(next, nd);
      if (c < cost[ns]) {
        cost[ns] = c;
        prev[ns] = state;
        heap.push(c + h(next), ns);
      }
    }
  }
  return null;
}

/**
 * Orthogonal route between two anchors. Uses the simple case-based route when it doesn't
 * cross any of `obstacles` (shape bounds); otherwise goes around them with A*, falling back
 * to the simple route when there's no clear path.
 */
export function elbowRoute(a: Anchor, b: Anchor, obstacles: Rect[] = []): Point[] {
  const direct = directElbow(a, b);
  if (obstacles.length === 0 || !routeHits(direct, obstacles)) return direct;
  const s1 = stubEnd(a);
  const s2 = stubEnd(b);
  const span = inflate(
    { x: Math.min(s1.x, s2.x), y: Math.min(s1.y, s2.y), w: Math.abs(s1.x - s2.x), h: Math.abs(s1.y - s2.y) },
    SEARCH_MARGIN,
  );
  const boxes = obstacles
    .filter((o) => overlaps(o, span))
    .map((o) => inflate(o, CLEARANCE))
    // An end sitting inside an obstacle (e.g. a free end under a shape) can't route around it.
    .filter((bx) => !strictlyInside(s1, bx) && !strictlyInside(s2, bx));
  const path = orthogonalPath(s1, a.dir, s2, b.dir, boxes);
  return path ? simplify([a.p, ...path, b.p]) : direct;
}

/** Bounds of the visible shapes on a page (with any text beside them): what elbow lines route around. */
export function routeObstacles(page: Page): Rect[] {
  return page.order
    .map((id) => page.items[id])
    .filter((it): it is Shape => isShape(it) && isVisible(page, it))
    .map(shapeExtent);
}

/** Unit normal of the chord a→b (pointing left of the direction of travel, y down), or null if a = b. */
function chordNormal(a: Point, b: Point): Point | null {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  return len ? { x: -(b.y - a.y) / len, y: (b.x - a.x) / len } : null;
}

/** Point on a curved line's midpoint, `bend` px off the chord: where its bend handle sits. */
export function curveMidpoint(a: Point, b: Point, bend: number): Point {
  const n = chordNormal(a, b) ?? { x: 0, y: 0 };
  return { x: (a.x + b.x) / 2 + n.x * bend, y: (a.y + b.y) / 2 + n.y * bend };
}

/** The bend that puts a curve's midpoint at `p` (its signed distance from the chord). */
export function bendThrough(a: Point, b: Point, p: Point): number {
  const n = chordNormal(a, b);
  return n ? (p.x - (a.x + b.x) / 2) * n.x + (p.y - (a.y + b.y) / 2) * n.y : 0;
}

/** A quadratic curve from a to b whose midpoint is `bend` px off the chord, sampled as a polyline. */
export function curvePoints(a: Point, b: Point, bend: number, samples = 32): Point[] {
  // A quadratic's midpoint is halfway between the chord midpoint and the control point.
  const c = curveMidpoint(a, b, bend * 2);
  return Array.from({ length: samples + 1 }, (_, i) => {
    const t = i / samples;
    const u = 1 - t;
    return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
  });
}

/** Both resolved ends of a connector. */
export function connectorEnds(page: Page, c: Connector): [Anchor, Anchor] {
  const slots = floatingSlots(page);
  return [
    slots.get(slotKey(c.id, 'source'))?.anchor ?? resolveEndpoint(page, c.source, anchorGuess(page, c.target)),
    slots.get(slotKey(c.id, 'target'))?.anchor ?? resolveEndpoint(page, c.target, anchorGuess(page, c.source)),
  ];
}

/** An end label's place in the stack of lines leaving one side of a shape. */
export interface EndStack {
  /** 0 = nearest the shape. */
  rank: number;
  /** Outward direction of that side (axis-aligned). */
  dir: Point;
}

/**
 * For each end of a line that shares a side of a shape with other lines: its rank and the
 * side's direction, so labels can be stacked outward instead of drawn on top of each other.
 */
export function endLabelStacks(page: Page, c: Connector): [EndStack | null, EndStack | null] {
  const slots = floatingSlots(page);
  const stack = (end: 'source' | 'target') => {
    const s = slots.get(slotKey(c.id, end));
    return s ? { rank: s.rank, dir: s.anchor.dir! } : null;
  };
  return [stack('source'), stack('target')];
}

/**
 * Walking a polyline from its start (or end), the first point that is `depth` away from that
 * end along `dir`, and the path length walked to get there; null if the line never gets that far.
 */
export function pointAtDepth(pts: Point[], dir: Point, depth: number, fromEnd = false): { p: Point; walked: number } | null {
  const path = fromEnd ? [...pts].reverse() : pts;
  const o = path[0];
  const depthOf = (p: Point) => (p.x - o.x) * dir.x + (p.y - o.y) * dir.y;
  let walked = 0;
  for (let i = 1; i < path.length; i++) {
    const a = depthOf(path[i - 1]);
    const b = depthOf(path[i]);
    const len = Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
    if (b >= depth && b > a) {
      const t = Math.max(0, (depth - a) / (b - a));
      return {
        p: { x: path[i - 1].x + (path[i].x - path[i - 1].x) * t, y: path[i - 1].y + (path[i].y - path[i - 1].y) * t },
        walked: walked + len * t,
      };
    }
    walked += len;
  }
  return null;
}

/** Max distance between neighboring floating ends spread along one side of a shape. */
const SLOT_SPACING = 26;

interface Slot {
  anchor: Anchor;
  rank: number;
}

const slotKey = (id: string, end: 'source' | 'target') => `${id}:${end}`;
const slotCache = new WeakMap<Page, Map<string, Slot>>();

/**
 * Floating ends (attached to a shape without `at` or `port`) use the shape's side facing the
 * other end. When several lines leave the same side, they're spread along it, ordered toward
 * their other ends so they don't cross. Computed per page and cached: pages from the store are
 * frozen (immutable); unfrozen ones (tests, drafts) are recomputed each time.
 */
function floatingSlots(page: Page): Map<string, Slot> {
  const cached = slotCache.get(page);
  if (cached) return cached;
  const groups = new Map<string, { key: string; towards: Point; shape: Shape; port: number }[]>();
  for (const id of page.order) {
    const c = page.items[id];
    if (c?.type !== 'connector') continue;
    for (const end of ['source', 'target'] as const) {
      const ep = c[end];
      if (!ep.shapeId || ep.at || ep.port != null) continue;
      const s = page.items[ep.shapeId];
      if (!isShape(s)) continue;
      const towards = anchorGuess(page, end === 'source' ? c.target : c.source);
      const ports = shapePorts(s);
      if (!ports.length) continue;
      const port = floatingPort(ports, towards);
      const gk = `${s.id}:${port}`;
      if (!groups.has(gk)) groups.set(gk, []);
      groups.get(gk)!.push({ key: slotKey(c.id, end), towards, shape: s, port });
    }
  }
  const out = new Map<string, Slot>();
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const { shape: s, port } = members[0];
    const def = localPorts(s)[port];
    const tangent = { x: -def.dir.y, y: def.dir.x };
    // Order along the side by where each line is heading, in the shape's own (unrotated) frame.
    const along = (p: Point) => {
      const l = worldToLocal(s, p);
      return l.x * tangent.x + l.y * tangent.y;
    };
    members.sort((a, b) => along(a.towards) - along(b.towards));
    const frame = localFrame(s);
    const side = tangent.x !== 0 ? frame.w : frame.h;
    const spacing = Math.min(SLOT_SPACING, (side * 0.8) / (members.length - 1));
    const outline = localOutline(s);
    const anchorBase = { dir: rotateDir(def.dir, rotationOf(s)), box: attachBox(s) };
    members.forEach((m, i) => {
      const off = (i - (members.length - 1) / 2) * spacing;
      // Keep the spread points on the shape's edge (it may not be straight, e.g. an ellipse).
      const local = nearestOnPolygon(outline, { x: def.x + tangent.x * off, y: def.y + tangent.y * off }).point;
      out.set(m.key, { anchor: { p: localToWorld(s, local), ...anchorBase }, rank: i });
    });
  }
  if (Object.isFrozen(page)) slotCache.set(page, out);
  return out;
}

/** A connector's polyline. Pass `obstacles` (from `routeObstacles`) when routing many lines at once. */
export function connectorPoints(page: Page, c: Connector, obstacles?: Rect[]): Point[] {
  const [a, b] = connectorEnds(page, c);
  if (c.routing === 'straight') return [a.p, b.p];
  if (c.routing === 'curved') return curvePoints(a.p, b.p, c.bend ?? 0);
  return elbowRoute(a, b, obstacles ?? routeObstacles(page));
}

/**
 * The point `dist` along a polyline from its start (or from its end when `fromEnd`), clamped
 * to the line's length.
 */
export function pointAlong(pts: Point[], dist: number, fromEnd = false): Point {
  const path = fromEnd ? [...pts].reverse() : pts;
  let remaining = Math.max(0, dist);
  for (let i = 1; i < path.length; i++) {
    const len = Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
    if (remaining <= len && len > 0) {
      const t = remaining / len;
      return { x: path[i - 1].x + (path[i].x - path[i - 1].x) * t, y: path[i - 1].y + (path[i].y - path[i - 1].y) * t };
    }
    remaining -= len;
  }
  return path[path.length - 1];
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
 * Where a dragged arrow end attaches: pinned to the topmost selectable shape (including any text
 * beside it) within `snap` of `p` (onto its outline when that close to it, else exactly at
 * `p`), or nowhere.
 */
export function findAttachment(page: Page, p: Point, snap: number): Endpoint | null {
  const order = renderOrder(page);
  for (let i = order.length - 1; i >= 0; i--) {
    const s = page.items[order[i]];
    if (isShape(s) && isInteractive(page, s) && pointInShape(p, s, snap)) {
      return { shapeId: s.id, at: bindPoint(s, p, snap), x: p.x, y: p.y };
    }
  }
  return null;
}
