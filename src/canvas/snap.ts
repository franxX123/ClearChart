import type { Rect } from '../model/types';

/** An alignment guide line: vertical when axis is 'x', horizontal when 'y'. */
export interface Guide {
  axis: 'x' | 'y';
  pos: number;
  from: number;
  to: number;
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: Guide[];
}

const xs = (r: Rect) => [r.x, r.x + r.w / 2, r.x + r.w];
const ys = (r: Rect) => [r.y, r.y + r.h / 2, r.y + r.h];

function snapAxis(moving: Rect, others: Rect[], threshold: number, axis: 'x' | 'y') {
  const lines = axis === 'x' ? xs : ys;
  let best: { delta: number; pos: number; other: Rect } | null = null;
  for (const o of others) {
    for (const m of lines(moving)) {
      for (const t of lines(o)) {
        const delta = t - m;
        if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) {
          best = { delta, pos: t, other: o };
        }
      }
    }
  }
  return best;
}

/**
 * Snaps a moving rect to edges and centers of other rects; on an axis with
 * nothing to align to, falls back to the grid (when `grid` > 0).
 */
export function snapMove(moving: Rect, others: Rect[], threshold: number, grid: number): SnapResult {
  const guides: Guide[] = [];
  const sx = snapAxis(moving, others, threshold, 'x');
  const sy = snapAxis(moving, others, threshold, 'y');
  let dx = 0;
  let dy = 0;

  if (sx) {
    dx = sx.delta;
    const top = Math.min(moving.y, sx.other.y);
    const bottom = Math.max(moving.y + moving.h, sx.other.y + sx.other.h);
    guides.push({ axis: 'x', pos: sx.pos, from: top, to: bottom });
  } else if (grid > 0) {
    dx = Math.round(moving.x / grid) * grid - moving.x;
  }

  if (sy) {
    dy = sy.delta;
    const left = Math.min(moving.x, sy.other.x);
    const right = Math.max(moving.x + moving.w, sy.other.x + sy.other.w);
    guides.push({ axis: 'y', pos: sy.pos, from: left, to: right });
  } else if (grid > 0) {
    dy = Math.round(moving.y / grid) * grid - moving.y;
  }

  // Guide extents were measured before the snap; widen them to cover the snapped rect.
  for (const g of guides) {
    if (g.axis === 'x') {
      g.from = Math.min(g.from, moving.y + dy);
      g.to = Math.max(g.to, moving.y + dy + moving.h);
    } else {
      g.from = Math.min(g.from, moving.x + dx);
      g.to = Math.max(g.to, moving.x + dx + moving.w);
    }
  }
  return { dx, dy, guides };
}
