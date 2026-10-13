import { describe, expect, it } from 'vitest';
import { SHAPES } from '../shapes/library';
import { flattenPath } from './svgPath';

describe('flattenPath', () => {
  it('reads lines, H/V and closing', () => {
    expect(flattenPath('M0 0H100V50H0Z')).toEqual([
      {
        closed: true,
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 50 },
          { x: 0, y: 50 },
        ],
      },
    ]);
  });

  it('keeps separate subpaths, open ones marked open', () => {
    const paths = flattenPath(SHAPES.subprocess.path(100, 50));
    expect(paths.map((p) => p.closed)).toEqual([true, false, false]);
    expect(paths[1].points).toEqual([
      { x: 10, y: 0 },
      { x: 10, y: 50 },
    ]);
  });

  it('flattens arcs onto their ellipse', () => {
    const [ellipse] = flattenPath(SHAPES.ellipse.path(200, 100), 12);
    expect(ellipse.closed).toBe(true);
    expect(ellipse.points).toHaveLength(25);
    for (const p of ellipse.points) {
      expect(((p.x - 100) / 100) ** 2 + ((p.y - 50) / 50) ** 2).toBeCloseTo(1, 6);
    }
    // Sweeps through the top and the bottom.
    expect(Math.min(...ellipse.points.map((p) => p.y))).toBeCloseTo(0, 6);
    expect(Math.max(...ellipse.points.map((p) => p.y))).toBeCloseTo(100, 6);
  });

  it('flattens cubic curves through their end points', () => {
    const [doc] = flattenPath(SHAPES.document.path(100, 80), 8);
    expect(doc.points[doc.points.length - 1]).toEqual({ x: 0, y: 72 });
  });

  it('flattens every library shape without NaNs', () => {
    for (const [kind, def] of Object.entries(SHAPES)) {
      const paths = flattenPath(def.path(120, 70));
      expect(paths.length, kind).toBeGreaterThan(0);
      for (const p of paths.flatMap((sp) => sp.points)) expect(Number.isFinite(p.x) && Number.isFinite(p.y), kind).toBe(true);
    }
  });
});
