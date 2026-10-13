import { describe, expect, it } from 'vitest';
import { drawRect } from './geometry';

describe('drawRect', () => {
  it('covers the drag in any direction, from the start corner', () => {
    expect(drawRect({ x: 10, y: 20 }, { x: 110, y: 70 }, false)).toEqual({ x: 10, y: 20, w: 100, h: 50 });
    expect(drawRect({ x: 110, y: 70 }, { x: 10, y: 20 }, false)).toEqual({ x: 10, y: 20, w: 100, h: 50 });
    expect(drawRect({ x: 110, y: 20 }, { x: 10, y: 70 }, false)).toEqual({ x: 10, y: 20, w: 100, h: 50 });
  });

  it('makes a square from the longer side, toward the drag', () => {
    expect(drawRect({ x: 0, y: 0 }, { x: 100, y: 40 }, true)).toEqual({ x: 0, y: 0, w: 100, h: 100 });
    expect(drawRect({ x: 0, y: 0 }, { x: -30, y: -80 }, true)).toEqual({ x: -80, y: -80, w: 80, h: 80 });
  });

  it('snaps both corners to the grid and keeps a minimum size', () => {
    expect(drawRect({ x: 3, y: 7 }, { x: 98, y: 52 }, false, 10)).toEqual({ x: 0, y: 10, w: 100, h: 40 });
    expect(drawRect({ x: 0, y: 0 }, { x: 2, y: 1 }, false)).toEqual({ x: 0, y: 0, w: 10, h: 10 });
    expect(drawRect({ x: 0, y: 0 }, { x: -2, y: 50 }, false, 0, 20)).toEqual({ x: -20, y: 0, w: 20, h: 50 });
  });
});
