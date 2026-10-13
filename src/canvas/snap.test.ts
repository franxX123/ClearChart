import { describe, expect, it } from 'vitest';
import { snapMove } from './snap';

describe('snapMove', () => {
  const other = { x: 100, y: 100, w: 100, h: 50 };

  it('aligns left edges within the threshold and reports a guide', () => {
    const r = snapMove({ x: 103, y: 300, w: 80, h: 40 }, [other], 6, 0);
    expect(r.dx).toBe(-3);
    expect(r.guides).toEqual([{ axis: 'x', pos: 100, from: 100, to: 340 }]);
  });

  it('aligns centers', () => {
    // Edges at 128/168 are far from 100/150/200; the center (148) is 2 from 150.
    const r = snapMove({ x: 128, y: 300, w: 40, h: 40 }, [other], 6, 0);
    expect(r.dx).toBe(2);
    expect(r.guides[0]).toMatchObject({ axis: 'x', pos: 150 });
  });

  it('falls back to the grid when nothing aligns', () => {
    const r = snapMove({ x: 503, y: 507, w: 80, h: 40 }, [other], 6, 10);
    expect(r).toEqual({ dx: -3, dy: 3, guides: [] });
  });

  it('does nothing without guides or grid', () => {
    expect(snapMove({ x: 503, y: 507, w: 80, h: 40 }, [other], 6, 0)).toEqual({ dx: 0, dy: 0, guides: [] });
  });
});
