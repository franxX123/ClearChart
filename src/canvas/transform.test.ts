import { describe, expect, it } from 'vitest';
import { makeShape } from '../model/doc';
import type { Point } from '../model/types';
import { localToWorld, pointInShape, resizeRect, shapeBox, snapAngle, worldToLocal } from './transform';

const close = (p: Point, q: Point) => {
  expect(p.x).toBeCloseTo(q.x);
  expect(p.y).toBeCloseTo(q.y);
};

describe('shape rotation', () => {
  const rotated = () => {
    const s = makeShape('rect', { x: 0, y: 0, w: 100, h: 50 });
    s.rotation = 90;
    return s;
  };

  it('maps local points to world and back', () => {
    const s = rotated();
    // The top-left corner swings to the top-right of the rotated footprint.
    close(localToWorld(s, { x: 0, y: 0 }), { x: 75, y: -25 });
    close(worldToLocal(s, localToWorld(s, { x: 30, y: 10 })), { x: 30, y: 10 });
  });

  it('bounds and hit tests follow the rotation', () => {
    const s = rotated();
    const b = shapeBox(s);
    close(b, { x: 25, y: -25 });
    expect(b.w).toBeCloseTo(50);
    expect(b.h).toBeCloseTo(100);
    expect(pointInShape({ x: 50, y: -20 }, s)).toBe(true);
    expect(pointInShape({ x: 5, y: 25 }, s)).toBe(false);
  });

  it('snaps angles to degrees, 15° steps with shift, and right angles when close', () => {
    expect(snapAngle(33.4, false)).toBe(33);
    expect(snapAngle(33.4, true)).toBe(30);
    expect(snapAngle(92, false)).toBe(90);
    expect(snapAngle(-2, false)).toBe(0);
    expect(snapAngle(-45, false)).toBe(315);
  });
});

describe('resizeRect', () => {
  const orig = { x: 100, y: 100, w: 100, h: 50 };

  it('moves only the dragged corner of an unrotated shape, snapping to the grid', () => {
    const r = resizeRect(orig, 0, 'se', { x: 23, y: 7 }, 10, (v) => Math.round(v / 10) * 10);
    expect(r).toEqual({ x: 100, y: 100, w: 120, h: 60 });
  });

  it('enforces the minimum size from the fixed side', () => {
    expect(resizeRect(orig, 0, 'nw', { x: 500, y: 500 }, 10)).toEqual({ x: 190, y: 140, w: 10, h: 10 });
  });

  it('keeps the aspect ratio when asked, following the larger change', () => {
    // Dragging se mostly sideways: width doubles, so height doubles too; no grid snap.
    const snap = (v: number) => Math.round(v / 10) * 10;
    expect(resizeRect(orig, 0, 'se', { x: 100, y: 3 }, 10, snap, true)).toEqual({ x: 100, y: 100, w: 200, h: 100 });
    // From the nw corner the se corner stays put.
    expect(resizeRect(orig, 0, 'nw', { x: 50, y: 0 }, 10, undefined, true)).toEqual({ x: 150, y: 125, w: 50, h: 25 });
    // Never below the minimum size on the short side.
    expect(resizeRect(orig, 0, 'se', { x: -500, y: -500 }, 10, undefined, true)).toEqual({ x: 100, y: 100, w: 20, h: 10 });
  });

  it('keeps aspect on a rotated shape with the opposite corner fixed', () => {
    const s = makeShape('rect', orig);
    s.rotation = 45;
    const fixed = localToWorld(s, { x: 0, y: 0 });
    const r = resizeRect(orig, 45, 'se', { x: 30, y: 30 }, 10, undefined, true);
    expect(r.w / r.h).toBeCloseTo(2);
    close(localToWorld({ ...s, ...r }, { x: 0, y: 0 }), fixed);
  });

  it('keeps the opposite corner fixed on a rotated shape', () => {
    const s = makeShape('rect', orig);
    s.rotation = 30;
    const fixed = localToWorld(s, { x: 0, y: 0 });
    const r = resizeRect(orig, 30, 'se', { x: 40, y: 25 }, 10);
    expect(r.w).toBeGreaterThan(orig.w);
    close(localToWorld({ ...s, ...r }, { x: 0, y: 0 }), fixed);
  });
});
