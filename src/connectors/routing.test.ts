import { describe, expect, it } from 'vitest';
import { addItems, emptyDoc, makeConnector, makeShape } from '../model/doc';
import type { Point } from '../model/types';
import { connectorPoints, elbowRoute, findAttachment, polylineMidpoint, simplify } from './routing';

const isOrthogonal = (pts: Point[]) =>
  pts.slice(1).every((p, i) => Math.abs(p.x - pts[i].x) < 1e-9 || Math.abs(p.y - pts[i].y) < 1e-9);

function twoShapes() {
  const doc = emptyDoc();
  const a = makeShape('rect', { x: 0, y: 0, w: 100, h: 50 });
  const b = makeShape('rect', { x: 300, y: 200, w: 100, h: 50 });
  addItems(doc, [a, b]);
  return { doc, a, b };
}

describe('connector routing', () => {
  it('attaches to fixed ports', () => {
    const { doc, a, b } = twoShapes();
    const c = makeConnector({ shapeId: a.id, port: 1, x: 0, y: 0 }, { shapeId: b.id, port: 3, x: 0, y: 0 });
    c.routing = 'straight';
    expect(connectorPoints(doc, c)).toEqual([
      { x: 100, y: 25 },
      { x: 300, y: 225 },
    ]);
  });

  it('auto-picks the ports that face each other', () => {
    const { doc, a, b } = twoShapes();
    const c = makeConnector({ shapeId: a.id, x: 0, y: 0 }, { shapeId: b.id, x: 0, y: 0 });
    c.routing = 'straight';
    const pts = connectorPoints(doc, c);
    // a's right port is nearest b's center; b's left port is nearest a's center.
    expect(pts[0]).toEqual({ x: 100, y: 25 });
    expect(pts[1]).toEqual({ x: 300, y: 225 });
  });

  it('follows the shape when it moves', () => {
    const { doc, a, b } = twoShapes();
    const c = makeConnector({ shapeId: a.id, port: 2, x: 0, y: 0 }, { shapeId: b.id, port: 0, x: 0, y: 0 });
    const before = connectorPoints(doc, c);
    a.x += 40;
    const after = connectorPoints(doc, c);
    expect(after[0].x).toBe(before[0].x + 40);
  });

  it('elbow routes are orthogonal and leave ports in their direction', () => {
    const cases = [
      [{ x: 1, y: 0 }, { x: -1, y: 0 }],
      [{ x: 1, y: 0 }, { x: 1, y: 0 }],
      [{ x: 0, y: 1 }, { x: 0, y: -1 }],
      [{ x: 1, y: 0 }, { x: 0, y: -1 }],
      [{ x: 0, y: 1 }, { x: -1, y: 0 }],
      [{ x: -1, y: 0 }, { x: 0, y: 1 }],
    ];
    for (const [d1, d2] of cases) {
      const pts = elbowRoute({ p: { x: 0, y: 0 }, dir: d1 }, { p: { x: 200, y: 150 }, dir: d2 });
      expect(isOrthogonal(pts)).toBe(true);
      expect(pts[0]).toEqual({ x: 0, y: 0 });
      expect(pts[pts.length - 1]).toEqual({ x: 200, y: 150 });
      const first = { x: Math.sign(pts[1].x - pts[0].x), y: Math.sign(pts[1].y - pts[0].y) };
      expect(first).toEqual(d1);
    }
  });

  it('elbow route to a free end is orthogonal', () => {
    const pts = elbowRoute({ p: { x: 0, y: 0 }, dir: { x: 0, y: 1 } }, { p: { x: 120, y: 80 }, dir: null });
    expect(isOrthogonal(pts)).toBe(true);
  });

  it('simplify drops duplicate and collinear points', () => {
    expect(
      simplify([
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 10 },
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 10 },
    ]);
  });

  it('finds the midpoint by length', () => {
    expect(
      polylineMidpoint([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 30 },
      ]),
    ).toEqual({ x: 10, y: 10 });
  });

  it('findAttachment prefers a nearby port, then the shape body', () => {
    const { doc, a } = twoShapes();
    expect(findAttachment(doc, { x: 98, y: 26 }, 10)).toMatchObject({ shapeId: a.id, port: 1 });
    const body = findAttachment(doc, { x: 50, y: 25 }, 10);
    expect(body?.shapeId).toBe(a.id);
    expect(body?.port).toBeUndefined();
    expect(findAttachment(doc, { x: 200, y: 120 }, 10)).toBeNull();
  });
});
