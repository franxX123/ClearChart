import type { Point, Rect } from '../model/types';
import { unionRects } from './geometry';

// Align and distribute: pure functions from bounds to per-rect offsets. The store applies them.

export type AlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

/** Offsets that line every rect up with the matching edge or center of their combined bounds. */
export function alignDeltas(rects: Rect[], mode: AlignMode): Point[] {
  const b = unionRects(rects);
  if (!b) return [];
  return rects.map((r) => {
    switch (mode) {
      case 'left':
        return { x: b.x - r.x, y: 0 };
      case 'center':
        return { x: b.x + b.w / 2 - (r.x + r.w / 2), y: 0 };
      case 'right':
        return { x: b.x + b.w - (r.x + r.w), y: 0 };
      case 'top':
        return { x: 0, y: b.y - r.y };
      case 'middle':
        return { x: 0, y: b.y + b.h / 2 - (r.y + r.h / 2) };
      case 'bottom':
        return { x: 0, y: b.y + b.h - (r.y + r.h) };
    }
  });
}

/**
 * Offsets that make the gaps between consecutive rects equal along `axis`, keeping the first
 * and last (by center) where they are. Needs at least three rects.
 */
export function distributeDeltas(rects: Rect[], axis: 'x' | 'y'): Point[] {
  const out = rects.map(() => ({ x: 0, y: 0 }));
  if (rects.length < 3) return out;
  const pos = (r: Rect) => (axis === 'x' ? r.x : r.y);
  const size = (r: Rect) => (axis === 'x' ? r.w : r.h);
  const sorted = rects.map((_, i) => i).sort((i, j) => pos(rects[i]) + size(rects[i]) / 2 - (pos(rects[j]) + size(rects[j]) / 2));
  const first = rects[sorted[0]];
  const last = rects[sorted[sorted.length - 1]];
  const span = pos(last) + size(last) - pos(first);
  const gap = (span - rects.reduce((sum, r) => sum + size(r), 0)) / (rects.length - 1);
  let cursor = pos(first);
  for (const i of sorted) {
    out[i][axis] = cursor - pos(rects[i]);
    cursor += size(rects[i]) + gap;
  }
  return out;
}
