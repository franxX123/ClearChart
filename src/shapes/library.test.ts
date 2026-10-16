import { describe, expect, it } from 'vitest';
import { resizeRect } from '../canvas/transform';
import { ARROW_SHORTCUT, LIBRARY, SHAPES } from './library';

describe('shape library', () => {
  it('Basic is Rectangle, Circle, Triangle, Text, Image on keys 1–5, with the Arrow on 6', () => {
    const basic = LIBRARY.filter((e) => e.category === 'Basic');
    expect(basic.map((e) => [e.label, e.shortcut])).toEqual([
      ['Rectangle', '1'],
      ['Circle', '2'],
      ['Triangle', '3'],
      ['Text', '4'],
      ['Image', '5'],
    ]);
    expect(ARROW_SHORTCUT).toBe('6');
    // Shortcuts are unique and only on Basic entries.
    const keys = LIBRARY.flatMap((e) => (e.shortcut ? [e.shortcut] : []));
    expect(new Set([...keys, ARROW_SHORTCUT]).size).toBe(keys.length + 1);
    expect(LIBRARY.filter((e) => e.shortcut && e.category !== 'Basic')).toEqual([]);
  });

  it('the circle starts round and stays round when resized', () => {
    const circle = LIBRARY.find((e) => e.label === 'Circle')!;
    expect(circle).toMatchObject({ kind: 'circle', w: 80, h: 80 });
    expect(SHAPES.circle.keepAspect).toBe(true);
    expect(SHAPES.image.keepAspect).toBe(true);
    expect(SHAPES.rect.keepAspect).toBeUndefined();
    const r = resizeRect({ x: 0, y: 0, w: 80, h: 80 }, 0, 'se', { x: 40, y: 10 }, 10, (v) => v, true);
    expect(r.w).toBe(r.h);
    expect(r.w).toBeGreaterThan(80);
  });

  it('keeps the kinds that left the Basic section, for existing diagrams', () => {
    for (const kind of ['roundRect', 'ellipse', 'note', 'hexagon'] as const) expect(SHAPES[kind]).toBeDefined();
  });

  it('has no Flowchart section or flowchart shapes', () => {
    expect(LIBRARY.every((e) => e.category === 'Basic')).toBe(true);
    for (const kind of ['diamond', 'terminator', 'parallelogram', 'document', 'cylinder', 'subprocess']) {
      expect(kind in SHAPES, kind).toBe(false);
    }
  });
});
