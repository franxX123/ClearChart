import { describe, expect, it } from 'vitest';
import { resizeRect } from './geometry';

describe('resizeRect', () => {
  const box = { x: 0, y: 0, w: 100, h: 50 };

  it('moves only the dragged corner’s edges', () => {
    expect(resizeRect(box, 'se', 30, 20)).toEqual({ x: 0, y: 0, w: 130, h: 70 });
    expect(resizeRect(box, 'nw', 10, -10)).toEqual({ x: 10, y: -10, w: 90, h: 60 });
    expect(resizeRect(box, 'ne', 20, 10)).toEqual({ x: 0, y: 10, w: 120, h: 40 });
    expect(resizeRect(box, 'sw', -20, 10)).toEqual({ x: -20, y: 0, w: 120, h: 60 });
  });

  it('snaps moved edges to the grid', () => {
    expect(resizeRect(box, 'se', 33, 17, { grid: 10 })).toEqual({ x: 0, y: 0, w: 130, h: 70 });
  });

  it('never goes below the minimum size', () => {
    expect(resizeRect(box, 'nw', 95, 80)).toEqual({ x: 90, y: 40, w: 10, h: 10 });
    expect(resizeRect(box, 'se', -500, -500)).toEqual({ x: 0, y: 0, w: 10, h: 10 });
  });

  it('turns a rectangle into a square, and a circle into an ellipse, on a free drag', () => {
    expect(resizeRect(box, 'se', 0, 50)).toMatchObject({ w: 100, h: 100 });
    const circle = { x: 100, y: 100, w: 80, h: 80 };
    expect(resizeRect(circle, 'se', 40, 0)).toEqual({ x: 100, y: 100, w: 120, h: 80 });
  });

  it('keeps proportions with the opposite corner fixed', () => {
    // Mostly-horizontal drag on a 2:1 box: 140×70, still anchored at the top-left.
    expect(resizeRect(box, 'se', 50, 0, { keepRatio: true })).toEqual({ x: 0, y: 0, w: 140, h: 70 });
    const circle = { x: 100, y: 100, w: 80, h: 80 };
    expect(resizeRect(circle, 'nw', -20, -20, { keepRatio: true })).toEqual({ x: 80, y: 80, w: 100, h: 100 });
    // A sideways drag still keeps it round.
    const r = resizeRect(circle, 'ne', 40, 0, { keepRatio: true });
    expect(r.w).toBeCloseTo(r.h);
    expect(r.x).toBe(100);
    expect(r.y + r.h).toBeCloseTo(180);
  });

  it('ignores the grid and respects the minimum when keeping proportions', () => {
    const r = resizeRect(box, 'se', 33, 0, { keepRatio: true, grid: 10 });
    expect(r.w / r.h).toBeCloseTo(2);
    expect(resizeRect(box, 'se', -1000, -1000, { keepRatio: true })).toEqual({ x: 0, y: 0, w: 20, h: 10 });
  });
});
