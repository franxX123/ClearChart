import type { Point } from '../model/types';

export interface LayoutNode {
  id: string;
  w: number;
  h: number;
  /** Top-left of a node already on the canvas; fixed nodes are never moved. */
  fixed?: Point;
}

export interface LayoutOptions {
  /** Top-left of free space for nodes with no fixed neighbor (e.g. right of existing content). */
  origin: Point;
  iterations?: number;
  /** Minimum gap kept between node boxes. */
  gap?: number;
  grid?: number;
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Small seeded PRNG (mulberry32), so layouts are repeatable. Returns values in [0, 1). */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Graph prepared for simulation: nodes by index, links as index pairs. */
interface Graph {
  nodes: LayoutNode[];
  links: (readonly [number, number])[];
  adj: number[][];
  fixed: boolean[];
  free: number[];
  /** Ideal edge length. */
  k: number;
}

/**
 * Force-directed (Fruchterman–Reingold) layout. Deterministic for the same input.
 * Small graphs are laid out from several starting arrangements and the one with the fewest
 * crossing lines wins. Returns top-left positions for every node; fixed nodes keep theirs.
 */
export function forceLayout(nodes: LayoutNode[], edges: [string, string][], opts: LayoutOptions): Record<string, Point> {
  const n = nodes.length;
  const out: Record<string, Point> = {};
  if (n === 0) return out;
  const grid = opts.grid ?? 10;
  const iterations = opts.iterations ?? (n > 400 ? 120 : 300);
  const attempts = n <= 60 ? 8 : n <= 200 ? 3 : 1;

  const index = new Map(nodes.map((nd, i) => [nd.id, i]));
  const links = edges
    .map(([a, b]) => [index.get(a), index.get(b)] as const)
    .filter((e): e is readonly [number, number] => e[0] != null && e[1] != null && e[0] !== e[1]);
  const adj: number[][] = nodes.map(() => []);
  for (const [a, b] of links) {
    adj[a].push(b);
    adj[b].push(a);
  }
  const fixed = nodes.map((nd) => nd.fixed != null);
  const free = nodes.map((_, i) => i).filter((i) => !fixed[i]);
  // Ideal edge length: room for the boxes plus labels on the line between them.
  const k = Math.max(160, ...nodes.map((nd) => Math.hypot(nd.w, nd.h)));
  const g: Graph = { nodes, links, adj, fixed, free, k };

  let best: { px: Float64Array; py: Float64Array; crossings: number; stress: number } | null = null;
  for (let attempt = 0; attempt < (free.length ? attempts : 1); attempt++) {
    const [px, py] = simulate(g, attempt, opts.origin, iterations);
    const crossings = countCrossings(px, py, links);
    // Tie-break on how far edge lengths stray from the ideal.
    const stress = links.reduce((sum, [a, b]) => sum + (Math.hypot(px[a] - px[b], py[a] - py[b]) - k) ** 2, 0);
    if (!best || crossings < best.crossings || (crossings === best.crossings && stress < best.stress)) {
      best = { px, py, crossings, stress };
    }
    if (best.crossings === 0) break;
  }
  const { px, py } = best!;
  separate(nodes, px, py, fixed, opts.gap ?? 40);

  nodes.forEach((nd, i) => {
    out[nd.id] = nd.fixed
      ? { ...nd.fixed }
      : { x: Math.round((px[i] - nd.w / 2) / grid) * grid, y: Math.round((py[i] - nd.h / 2) / grid) * grid };
  });
  return out;
}

/** One seeded run of the simulation; returns node centers. */
function simulate(g: Graph, attempt: number, origin: Point, iterations: number): [Float64Array, Float64Array] {
  const { nodes, adj, fixed, free, k } = g;
  const n = nodes.length;
  const px = new Float64Array(n);
  const py = new Float64Array(n);
  const placed = nodes.map((nd, i) => {
    if (!nd.fixed) return false;
    px[i] = nd.fixed.x + nd.w / 2;
    py[i] = nd.fixed.y + nd.h / 2;
    return true;
  });

  // Seed new nodes breadth-first from the best-connected ones, each near its placed neighbors.
  // The first attempt fans neighbors out by the golden angle; later ones use seeded random
  // angles, so each settles into a genuinely different arrangement.
  const rand = random(attempt);
  const nextAngle = (count: number) => (attempt === 0 ? count * GOLDEN_ANGLE : rand() * Math.PI * 2);
  const spread = k * 0.6 * Math.sqrt(free.length);
  const center = { x: origin.x + spread, y: origin.y + spread };
  let seeded = 0;
  let loose = 0;
  const seed = (i: number) => {
    const nb = adj[i].filter((j) => placed[j]);
    if (nb.length) {
      const angle = nextAngle(seeded++);
      px[i] = nb.reduce((s, j) => s + px[j], 0) / nb.length + Math.cos(angle) * k;
      py[i] = nb.reduce((s, j) => s + py[j], 0) / nb.length + Math.sin(angle) * k;
    } else {
      const r = k * 0.6 * Math.sqrt(loose + 0.5);
      const angle = nextAngle(loose++);
      px[i] = center.x + Math.cos(angle) * r;
      py[i] = center.y + Math.sin(angle) * r;
    }
    placed[i] = true;
  };
  const order = [...free].sort((a, b) => adj[b].length - adj[a].length || a - b);
  // Nodes next to fixed ones go first so they start beside the existing diagram.
  const starts = [...order.filter((i) => adj[i].some((j) => fixed[j])), ...order];
  for (const start of starts) {
    const queue = [start];
    while (queue.length) {
      const i = queue.shift()!;
      if (placed[i]) continue;
      seed(i);
      for (const j of adj[i]) if (!placed[j]) queue.push(j);
    }
  }
  if (free.length) relax(g, px, py, iterations, k * 1.5);
  return [px, py];
}

/** Runs the force simulation on the free nodes, cooling linearly from step size `t0`. */
function relax(g: Graph, px: Float64Array, py: Float64Array, iterations: number, t0: number) {
  const { nodes, links, fixed, free, k } = g;
  const n = nodes.length;
  const dx = new Float64Array(n);
  const dy = new Float64Array(n);
  const k2 = k * k;
  for (let it = 0; it < iterations; it++) {
    dx.fill(0);
    dy.fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (fixed[i] && fixed[j]) continue;
        let ex = px[i] - px[j];
        let ey = py[i] - py[j];
        let d2 = ex * ex + ey * ey;
        if (d2 < 1e-4) {
          // Coincident: push apart in a deterministic direction.
          ex = Math.cos(i + j);
          ey = Math.sin(i + j);
          d2 = 1;
        }
        const f = k2 / d2;
        dx[i] += ex * f;
        dy[i] += ey * f;
        dx[j] -= ex * f;
        dy[j] -= ey * f;
      }
    }
    for (const [a, b] of links) {
      const ex = px[a] - px[b];
      const ey = py[a] - py[b];
      const f = Math.hypot(ex, ey) / k;
      dx[a] -= ex * f;
      dy[a] -= ey * f;
      dx[b] += ex * f;
      dy[b] += ey * f;
    }
    // Weak pull toward the middle keeps disconnected parts from drifting apart.
    let gx = 0;
    let gy = 0;
    for (let i = 0; i < n; i++) {
      gx += px[i] / n;
      gy += py[i] / n;
    }
    const t = t0 * (1 - it / iterations) + 1;
    for (const i of free) {
      const fx = dx[i] + (gx - px[i]) * 0.05;
      const fy = dy[i] + (gy - py[i]) * 0.05;
      const len = Math.hypot(fx, fy);
      if (len < 1e-9) continue;
      const step = Math.min(len, t);
      px[i] += (fx / len) * step;
      py[i] += (fy / len) * step;
    }
  }
}

/** Whether two links cross as straight lines; links sharing a node never count. */
function crosses(px: Float64Array, py: Float64Array, [a, b]: readonly [number, number], [c, d]: readonly [number, number]) {
  if (a === c || a === d || b === c || b === d) return false;
  const side = (p: number, q: number, r: number) =>
    Math.sign((px[q] - px[p]) * (py[r] - py[p]) - (py[q] - py[p]) * (px[r] - px[p]));
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
}

function countCrossings(px: Float64Array, py: Float64Array, links: readonly (readonly [number, number])[]): number {
  let count = 0;
  for (let i = 0; i < links.length; i++) {
    for (let j = i + 1; j < links.length; j++) if (crosses(px, py, links[i], links[j])) count++;
  }
  return count;
}

/** Pushes overlapping boxes apart (keeping `gap` between them) along the axis of least overlap. */
function separate(nodes: LayoutNode[], px: Float64Array, py: Float64Array, fixed: boolean[], gap: number) {
  // Padding covers the grid snap applied afterwards.
  const pad = gap + 10;
  for (let pass = 0; pass < 100; pass++) {
    let moved = false;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        if (fixed[i] && fixed[j]) continue;
        const ox = (nodes[i].w + nodes[j].w) / 2 + pad - Math.abs(px[i] - px[j]);
        const oy = (nodes[i].h + nodes[j].h) / 2 + pad - Math.abs(py[i] - py[j]);
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        const share = fixed[i] ? [0, 1] : fixed[j] ? [1, 0] : [0.5, 0.5];
        if (ox < oy) {
          const s = px[i] < px[j] || (px[i] === px[j] && i < j) ? -1 : 1;
          px[i] += s * ox * share[0];
          px[j] -= s * ox * share[1];
        } else {
          const s = py[i] < py[j] || (py[i] === py[j] && i < j) ? -1 : 1;
          py[i] += s * oy * share[0];
          py[j] -= s * oy * share[1];
        }
      }
    }
    if (!moved) return;
  }
}
