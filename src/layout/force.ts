import type { Point } from '../model/types';

// Force-directed layout (Fruchterman–Reingold) for placing imported devices. Deterministic:
// no randomness, so the same input always gives the same picture. Pure.

export interface LayoutNode {
  id: string;
  w: number;
  h: number;
  /** Center of a node that must not move (existing shapes). Free nodes have none. */
  fixed?: Point;
}

export interface LayoutOptions {
  /** Preferred distance between linked nodes' centers. */
  edgeLength?: number;
  iterations?: number;
  /** Where free nodes with no fixed neighbors start, and what they're gently pulled toward. */
  center?: Point;
  /** Minimum gap kept between node boxes at the end. */
  gap?: number;
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Centers for every node (fixed ones unchanged). */
export function forceLayout(nodes: LayoutNode[], edges: [string, string][], opts: LayoutOptions = {}): Map<string, Point> {
  const k = opts.edgeLength ?? 220;
  const iterations = opts.iterations ?? 300;
  const gap = opts.gap ?? 40;
  const center = opts.center ?? { x: 0, y: 0 };
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const pos: Point[] = nodes.map((n) => (n.fixed ? { ...n.fixed } : { x: 0, y: 0 }));
  const free = nodes.map((n) => !n.fixed);
  const radius = nodes.map((n) => Math.max(n.w, n.h) / 2);
  const links = edges
    .map(([a, b]) => [index.get(a), index.get(b)] as const)
    .filter((e): e is readonly [number, number] => e[0] !== undefined && e[1] !== undefined && e[0] !== e[1]);
  const neighbors = nodes.map(() => [] as number[]);
  for (const [a, b] of links) {
    neighbors[a].push(b);
    neighbors[b].push(a);
  }

  // Start: near the fixed nodes a free node links to, otherwise on a sunflower spiral around `center`.
  let spiral = 0;
  nodes.forEach((n, i) => {
    if (n.fixed) return;
    const anchors = neighbors[i].filter((j) => !free[j]);
    const base = anchors.length
      ? { x: anchors.reduce((s, j) => s + pos[j].x, 0) / anchors.length, y: anchors.reduce((s, j) => s + pos[j].y, 0) / anchors.length }
      : center;
    const r = k * 0.5 * Math.sqrt(spiral + 1);
    const a = spiral * GOLDEN_ANGLE;
    pos[i] = { x: base.x + r * Math.cos(a), y: base.y + r * Math.sin(a) };
    spiral++;
  });

  const freeIdx = nodes.map((_, i) => i).filter((i) => free[i]);
  if (freeIdx.length === 0) return new Map(nodes.map((n, i) => [n.id, pos[i]]));

  for (let it = 0; it < iterations; it++) {
    const temp = k * (1 - it / iterations) + 1;
    const disp = nodes.map(() => ({ x: 0, y: 0 }));
    // Repulsion: every free node is pushed away from every other node.
    for (const i of freeIdx) {
      for (let j = 0; j < nodes.length; j++) {
        if (j === i) continue;
        let dx = pos[i].x - pos[j].x;
        let dy = pos[i].y - pos[j].y;
        let d = Math.hypot(dx, dy);
        if (d < 0.01) {
          // Coincident: separate deterministically.
          dx = Math.cos(i + j);
          dy = Math.sin(i + j);
          d = 1;
        }
        // Closer than their sizes allow → push much harder, so boxes don't overlap.
        const room = Math.max(d - radius[i] - radius[j], 1);
        const f = (k * k) / d + (d < radius[i] + radius[j] + gap ? (k * k) / room : 0);
        disp[i].x += (dx / d) * f;
        disp[i].y += (dy / d) * f;
      }
    }
    // Attraction along links.
    for (const [a, b] of links) {
      const dx = pos[a].x - pos[b].x;
      const dy = pos[a].y - pos[b].y;
      const d = Math.max(Math.hypot(dx, dy), 0.01);
      const f = (d * d) / k;
      if (free[a]) {
        disp[a].x -= (dx / d) * f;
        disp[a].y -= (dy / d) * f;
      }
      if (free[b]) {
        disp[b].x += (dx / d) * f;
        disp[b].y += (dy / d) * f;
      }
    }
    for (const i of freeIdx) {
      // Gentle gravity keeps unconnected pieces from drifting off.
      disp[i].x += (center.x - pos[i].x) * 0.02 * (neighbors[i].length ? 0.2 : 1);
      disp[i].y += (center.y - pos[i].y) * 0.02 * (neighbors[i].length ? 0.2 : 1);
      const len = Math.hypot(disp[i].x, disp[i].y);
      if (len > 0) {
        const step = Math.min(len, temp);
        pos[i].x += (disp[i].x / len) * step;
        pos[i].y += (disp[i].y / len) * step;
      }
    }
  }

  // Final pass: nudge apart any free node whose box still overlaps another (plus the gap).
  for (let pass = 0; pass < 50; pass++) {
    let moved = false;
    for (const i of freeIdx) {
      for (let j = 0; j < nodes.length; j++) {
        if (j === i) continue;
        const ox = (nodes[i].w + nodes[j].w) / 2 + gap - Math.abs(pos[i].x - pos[j].x);
        const oy = (nodes[i].h + nodes[j].h) / 2 + gap - Math.abs(pos[i].y - pos[j].y);
        if (ox <= 0 || oy <= 0) continue;
        // Separate along the axis that needs the smaller move; split it if both are free.
        const share = free[j] ? 0.5 : 1;
        if (ox < oy) {
          const s = pos[i].x >= pos[j].x ? 1 : -1;
          pos[i].x += s * ox * share;
          if (free[j]) pos[j].x -= s * ox * share;
        } else {
          const s = pos[i].y >= pos[j].y ? 1 : -1;
          pos[i].y += s * oy * share;
          if (free[j]) pos[j].y -= s * oy * share;
        }
        moved = true;
      }
    }
    if (!moved) break;
  }

  return new Map(nodes.map((n, i) => [n.id, pos[i]]));
}
