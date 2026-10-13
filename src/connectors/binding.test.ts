import { describe, expect, it } from 'vitest';
import { makeShape } from '../model/doc';
import { bindPoint, nearestOnPolygon, pinnedDir, pinnedPoint } from './binding';

describe('arrow binding', () => {
  it('finds the nearest point on a polygon edge', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(nearestOnPolygon(square, { x: 4, y: -3 })).toEqual({ point: { x: 4, y: 0 }, dist: 3 });
    expect(nearestOnPolygon(square, { x: 8, y: 5 }).point).toEqual({ x: 10, y: 5 });
  });

  it('snaps onto a diamond outline, not its bounding box', () => {
    const d = makeShape('diamond', { x: 0, y: 0, w: 100, h: 100 });
    // Just inside the upper-right edge, well inside the bounding box.
    const at = bindPoint(d, { x: 74, y: 22 }, 8);
    const p = pinnedPoint(d, at);
    // On the edge from (50,0) to (100,50): y = x - 50.
    expect(p.y).toBeCloseTo(p.x - 50);
  });

  it('snaps onto an ellipse outline', () => {
    const e = makeShape('ellipse', { x: 0, y: 0, w: 200, h: 100 });
    const p = pinnedPoint(e, bindPoint(e, { x: 100, y: 4 }, 8));
    expect(p.x).toBeCloseTo(100, 0);
    expect(p.y).toBeCloseTo(0, 0);
  });

  it('pins exactly where dropped when far from the edge', () => {
    const r = makeShape('rect', { x: 0, y: 0, w: 200, h: 100 });
    expect(bindPoint(r, { x: 50, y: 40 }, 8)).toEqual({ x: 0.25, y: 0.4 });
  });

  it('pinned points move, resize and rotate with the shape', () => {
    const r = makeShape('rect', { x: 0, y: 0, w: 100, h: 50 });
    const at = { x: 1, y: 0.5 }; // middle of the right edge
    expect(pinnedPoint(r, at)).toEqual({ x: 100, y: 25 });
    r.x = 20;
    r.w = 200;
    expect(pinnedPoint(r, at)).toEqual({ x: 220, y: 25 });
    expect(pinnedDir(r, at)).toEqual({ x: 1, y: 0 });
    r.rotation = 90;
    const p = pinnedPoint(r, at);
    // Rotating 90° clockwise about the center (120, 25) moves the right-edge middle to the bottom.
    expect(p.x).toBeCloseTo(120);
    expect(p.y).toBeCloseTo(125);
    expect(pinnedDir(r, at)).toEqual({ x: 0, y: 1 });
  });
});
