import { describe, expect, it } from 'vitest';
import type { Point } from '../model/types';
import { forceLayout, type LayoutNode } from './layout';

const box = (id: string, fixed?: Point): LayoutNode => ({ id, w: 120, h: 60, fixed });

const center = (p: Point) => ({ x: p.x + 60, y: p.y + 30 });
const dist = (a: Point, b: Point) => Math.hypot(center(a).x - center(b).x, center(a).y - center(b).y);

function overlaps(pos: Record<string, Point>, nodes: LayoutNode[]) {
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = pos[nodes[i].id];
      const b = pos[nodes[j].id];
      const ax = a.x + nodes[i].w;
      const bx = b.x + nodes[j].w;
      if (a.x < bx && b.x < ax && a.y < b.y + nodes[j].h && b.y < a.y + nodes[i].h) return true;
    }
  }
  return false;
}

// A small campus: core pair, four access switches each dual-homed, plus an isolated firewall pair.
const nodes = ['core1', 'core2', 'a1', 'a2', 'a3', 'a4', 'fw1', 'fw2'].map((id) => box(id));
const edges: [string, string][] = [
  ['core1', 'core2'],
  ...['a1', 'a2', 'a3', 'a4'].flatMap((a): [string, string][] => [
    ['core1', a],
    ['core2', a],
  ]),
  ['fw1', 'fw2'],
];
const origin = { x: 0, y: 0 };

describe('forceLayout', () => {
  it('is deterministic', () => {
    expect(forceLayout(nodes, edges, { origin })).toEqual(forceLayout(nodes, edges, { origin }));
  });

  it('places every node on the grid with no overlapping boxes', () => {
    const pos = forceLayout(nodes, edges, { origin });
    expect(Object.keys(pos).sort()).toEqual(nodes.map((n) => n.id).sort());
    for (const p of Object.values(pos)) {
      expect(Math.abs(p.x % 10)).toBe(0);
      expect(Math.abs(p.y % 10)).toBe(0);
    }
    expect(overlaps(pos, nodes)).toBe(false);
  });

  it('keeps connected nodes closer than unconnected ones', () => {
    const chain = ['n0', 'n1', 'n2', 'n3', 'n4', 'n5'].map((id) => box(id));
    const links = chain.slice(1).map((n, i): [string, string] => [chain[i].id, n.id]);
    const pos = forceLayout(chain, links, { origin });
    expect(dist(pos.n0, pos.n1)).toBeLessThan(dist(pos.n0, pos.n5));
    expect(dist(pos.n2, pos.n3)).toBeLessThan(dist(pos.n0, pos.n5));
  });

  it('never moves fixed nodes, and places new ones beside their fixed neighbors', () => {
    const fixed = [box('core1', { x: 0, y: 0 }), box('core2', { x: 400, y: 0 })];
    const fresh = ['a1', 'a2', 'a3'].map((id) => box(id));
    const all = [...fixed, ...fresh];
    const links: [string, string][] = fresh.map((n) => ['core1', n.id]);
    const pos = forceLayout(all, links, { origin: { x: 2000, y: 0 } });
    expect(pos.core1).toEqual({ x: 0, y: 0 });
    expect(pos.core2).toEqual({ x: 400, y: 0 });
    expect(overlaps(pos, all)).toBe(false);
    // Seeded near core1, not out at the free-space origin.
    for (const n of fresh) expect(dist(pos[n.id], pos.core1)).toBeLessThan(1000);
  });

  it('draws a ring with a hub and no crossing lines', () => {
    const ring = Array.from({ length: 8 }, (_, i) => box(`r${i}`));
    const links: [string, string][] = ring.map((n, i) => [n.id, ring[(i + 1) % ring.length].id]);
    const all = [box('hub'), ...ring];
    links.push(['hub', 'r0'], ['hub', 'r4']);
    const pos = forceLayout(all, links, { origin });
    const c = (id: string) => center(pos[id]);
    const side = (p: Point, q: Point, r: Point) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
    let crossings = 0;
    for (const [a, b] of links) {
      for (const [d, e] of links) {
        if ([a, b].some((v) => v === d || v === e)) continue;
        if (side(c(a), c(b), c(d)) * side(c(a), c(b), c(e)) < 0 && side(c(d), c(e), c(a)) * side(c(d), c(e), c(b)) < 0) crossings++;
      }
    }
    expect(crossings).toBe(0);
  });

  it('handles empty and single-node inputs', () => {
    expect(forceLayout([], [], { origin })).toEqual({});
    expect(Object.keys(forceLayout([box('solo')], [], { origin }))).toEqual(['solo']);
  });
});
