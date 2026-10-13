import { describe, expect, it } from 'vitest';
import { addItems, makeShape } from '../model/doc';
import { makePage } from '../model/page';
import type { Point } from '../model/types';
import { itemBounds } from './geometry';
import { LINE_HEIGHT } from './text';
import {
  attachFrame,
  localToWorld,
  pointInShape,
  resizeRect,
  shapeBox,
  shapeExtent,
  SIDE_GAP,
  sideLabelBox,
  snapAngle,
  worldToLocal,
} from './transform';

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

describe('text beside a shape', () => {
  /** A 56×40 picture at (100, 100) with two lines of 12 px text to its right. */
  const device = (text = 'a-long-hostname\n10.0.0.1') => {
    const s = makeShape('image', { x: 100, y: 100, w: 56, h: 40 }, text, { fontSize: 12 });
    s.textPosition = 'right';
    return s;
  };

  it('sits right of the box, vertically centered, one line per line break', () => {
    const s = device();
    const b = sideLabelBox(s)!;
    expect(b.x).toBe(56 + SIDE_GAP);
    expect(b.h).toBeCloseTo(2 * 12 * LINE_HEIGHT);
    expect(b.y + b.h / 2).toBeCloseTo(20);
    expect(b.w).toBeGreaterThan(56); // the hostname is long
    expect(sideLabelBox({ ...s, text: '' })).toBeNull();
    expect(sideLabelBox({ ...s, textPosition: undefined })).toBeNull();
  });

  it('forms one frame with the box: bounds, hits and attaching all use it', () => {
    const s = device();
    const b = sideLabelBox(s)!;
    expect(attachFrame(s)).toEqual({ x: 0, y: 0, w: b.x + b.w, h: 40 });
    const e = shapeExtent(s);
    expect(e).toEqual({ x: 100, y: 100, w: b.x + b.w, h: 40 });
    expect(shapeBox(s)).toEqual({ x: 100, y: 100, w: 56, h: 40 });
    // On the text (and the gap before it) counts as on the shape; past the text doesn't.
    expect(pointInShape({ x: 100 + b.x + 10, y: 120 }, s)).toBe(true);
    expect(pointInShape({ x: 100 + 56 + 3, y: 120 }, s)).toBe(true);
    expect(pointInShape({ x: 100 + b.x + b.w + 5, y: 120 }, s)).toBe(false);
    const page = makePage();
    addItems(page, [s]);
    expect(itemBounds(page, s.id)).toEqual(e);
    // A shape without text beside it: no frame, extent and box agree.
    const plain = makeShape('rect', { x: 0, y: 0, w: 10, h: 10 }, 'inside');
    expect(attachFrame(plain)).toBeNull();
    expect(shapeExtent(plain)).toEqual(shapeBox(plain));
  });

  it('grows the frame when the text is taller than the shape', () => {
    const s = device('a\nb\nc\nd'); // 4 lines of 15 px: 60 px, centered on a 40 px box
    const f = attachFrame(s)!;
    expect(f.y).toBeCloseTo(-10);
    expect(f.h).toBeCloseTo(60);
  });

  it('turns with the shape', () => {
    const s = device();
    s.rotation = 180;
    const e = shapeExtent(s);
    // Upside down, the text sits on the left.
    expect(e.x + e.w).toBeCloseTo(156);
    expect(e.x).toBeCloseTo(156 - attachFrame(s)!.w);
  });
});
