import { describe, expect, it } from 'vitest';
import { alignDeltas, distributeDeltas } from './arrange';

const rects = [
  { x: 0, y: 0, w: 40, h: 20 },
  { x: 100, y: 50, w: 20, h: 40 },
  { x: 30, y: 200, w: 60, h: 10 },
];

describe('align', () => {
  it('aligns to the edges and centers of the combined bounds', () => {
    expect(alignDeltas(rects, 'left').map((d) => d.x)).toEqual([0, -100, -30]);
    expect(alignDeltas(rects, 'right').map((d) => d.x)).toEqual([80, 0, 30]);
    expect(alignDeltas(rects, 'center').map((d) => d.x)).toEqual([40, -50, 0]);
    expect(alignDeltas(rects, 'bottom').map((d) => d.y)).toEqual([190, 120, 0]);
    expect(alignDeltas(rects, 'middle').every((d) => d.x === 0)).toBe(true);
  });
});

describe('distribute', () => {
  it('equalizes gaps between rects, keeping the outer two in place', () => {
    const row = [
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 90, y: 0, w: 30, h: 10 },
      { x: 20, y: 0, w: 10, h: 10 },
      { x: 190, y: 0, w: 10, h: 10 },
    ];
    const d = distributeDeltas(row, 'x');
    const xs = row.map((r, i) => r.x + d[i].x);
    // Span 0..200 holds 60 px of shapes, so each of the 3 gaps is 140 / 3.
    const gap = 140 / 3;
    expect(xs[0]).toBe(0);
    expect(xs[2]).toBeCloseTo(10 + gap);
    expect(xs[1]).toBeCloseTo(20 + gap * 2);
    expect(xs[3]).toBeCloseTo(190);
    expect(d.every((v) => v.y === 0)).toBe(true);
  });

  it('needs at least three rects', () => {
    expect(distributeDeltas(rects.slice(0, 2), 'y')).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ]);
  });
});
