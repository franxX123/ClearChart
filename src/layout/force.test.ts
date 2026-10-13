import { describe, expect, it } from 'vitest';
import { forceLayout, type LayoutNode } from './force';

const box = (id: string, fixed?: { x: number; y: number }): LayoutNode => ({ id, w: 160, h: 64, fixed });
const dist = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.hypot(p.x - q.x, p.y - q.y);

describe('forceLayout', () => {
  const nodes = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => box(id));
  const edges: [string, string][] = [
    ['a', 'b'],
    ['b', 'c'],
    ['c', 'a'],
    ['d', 'e'],
  ];

  it('is deterministic and finite', () => {
    const one = forceLayout(nodes, edges);
    const two = forceLayout(nodes, edges);
    expect([...one.entries()]).toEqual([...two.entries()]);
    for (const p of one.values()) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
    }
  });

  it('keeps boxes apart', () => {
    const pos = forceLayout(nodes, edges, { gap: 40 });
    const ids = [...pos.keys()];
    for (const i of ids) {
      for (const j of ids) {
        if (i >= j) continue;
        const p = pos.get(i)!;
        const q = pos.get(j)!;
        const apart = Math.abs(p.x - q.x) >= 160 + 40 - 0.5 || Math.abs(p.y - q.y) >= 64 + 40 - 0.5;
        expect(apart).toBe(true);
      }
    }
  });

  it('pulls linked nodes closer than unlinked ones', () => {
    const pos = forceLayout(nodes, edges);
    const linked = dist(pos.get('d')!, pos.get('e')!);
    const unlinked = dist(pos.get('d')!, pos.get('f')!);
    expect(linked).toBeLessThan(unlinked);
  });

  it('never moves fixed nodes and places free ones near what they link to', () => {
    const anchor = { x: 1000, y: 1000 };
    const pos = forceLayout([box('old', anchor), box('new'), box('far', { x: -1000, y: -1000 })], [['old', 'new']]);
    expect(pos.get('old')).toEqual(anchor);
    expect(pos.get('far')).toEqual({ x: -1000, y: -1000 });
    expect(dist(pos.get('new')!, anchor)).toBeLessThan(600);
  });
});
