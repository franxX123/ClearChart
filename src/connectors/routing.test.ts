import { describe, expect, it } from 'vitest';
import { addItems, makeConnector, makeShape } from '../model/doc';
import { makeLayer, makePage } from '../model/page';
import type { Point, Rect } from '../model/types';
import { attachFrame, localRectBox, sideLabelBox } from '../canvas/transform';
import { pinnedDir, pinnedPoint } from './binding';
import {
  bendThrough,
  connectorPoints,
  curveMidpoint,
  elbowRoute,
  endLabelStacks,
  findAttachment,
  orthogonalPath,
  pointAlong,
  pointAtDepth,
  polylineMidpoint,
  routeHits,
  shapePorts,
  simplify,
} from './routing';

const isOrthogonal = (pts: Point[]) =>
  pts.slice(1).every((p, i) => Math.abs(p.x - pts[i].x) < 1e-9 || Math.abs(p.y - pts[i].y) < 1e-9);

function twoShapes() {
  const doc = makePage();
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

  it('finds points a distance along a polyline from either end', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 30 },
    ];
    expect(pointAlong(pts, 4)).toEqual({ x: 4, y: 0 });
    expect(pointAlong(pts, 15)).toEqual({ x: 10, y: 5 });
    expect(pointAlong(pts, 5, true)).toEqual({ x: 10, y: 25 });
    expect(pointAlong(pts, 999)).toEqual({ x: 10, y: 30 });
  });

  it('finds where a line first gets a given depth away from its end', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 30, y: -10 },
      { x: 30, y: -50 },
    ];
    const up = { x: 0, y: -1 };
    expect(pointAtDepth(pts, up, 5)?.p).toEqual({ x: 15, y: -5 });
    const hit = pointAtDepth(pts, up, 30)!;
    expect(hit.p).toEqual({ x: 30, y: -30 });
    expect(hit.walked).toBeCloseTo(Math.hypot(30, 10) + 20);
    expect(pointAtDepth(pts, up, 60)).toBeNull();
    expect(pointAtDepth(pts, { x: 0, y: 1 }, 10, true)?.p).toEqual({ x: 30, y: -40 });
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

  it('findAttachment pins to the outline near an edge, inside the body otherwise', () => {
    const { doc, a } = twoShapes();
    // 2 px inside the right edge, within snap distance: lands on the edge.
    expect(findAttachment(doc, { x: 98, y: 20 }, 8)).toMatchObject({ shapeId: a.id, at: { x: 1, y: 0.4 } });
    // Just outside the shape but within the snap padding: also onto the edge.
    expect(findAttachment(doc, { x: 104, y: 20 }, 8)?.at).toEqual({ x: 1, y: 0.4 });
    // Deep inside: pinned exactly there.
    expect(findAttachment(doc, { x: 25, y: 25 }, 8)).toMatchObject({ shapeId: a.id, at: { x: 0.25, y: 0.5 } });
    expect(findAttachment(doc, { x: 200, y: 120 }, 8)).toBeNull();
  });

  it('spreads floating ends that leave the same side, in order, and ranks their labels', () => {
    const doc = makePage();
    const hub = makeShape('rect', { x: 0, y: 300, w: 120, h: 60 });
    // Far enough above that the hub's top side faces all three.
    const tops = [-150, 10, 170].map((x) => makeShape('rect', { x, y: -400, w: 100, h: 50 }));
    addItems(doc, [hub, ...tops]);
    // Added right-to-left, so the spread order must come from geometry, not insertion.
    const lines = [...tops].reverse().map((t) => makeConnector({ shapeId: hub.id, x: 0, y: 0 }, { shapeId: t.id, x: 0, y: 0 }));
    addItems(doc, lines);
    const starts = lines.map((c) => connectorPoints(doc, c)[0]);
    expect(starts.every((p) => p.y === 300)).toBe(true);
    expect(new Set(starts.map((p) => p.x)).size).toBe(3);
    // The line to the leftmost device leaves from the left of the side.
    expect(starts[2].x).toBeLessThan(starts[1].x);
    expect(starts[1].x).toBeLessThan(starts[0].x);
    expect(lines.map((c) => endLabelStacks(doc, c)[0])).toEqual([2, 1, 0].map((rank) => ({ rank, dir: { x: 0, y: -1 } })));
    expect(endLabelStacks(doc, lines[0])[1]).toBeNull();
    // A lone floating end still uses the side's midpoint.
    const solo = makeConnector({ shapeId: tops[0].id, x: 0, y: 0 }, { x: -400, y: -375 });
    addItems(doc, [solo]);
    expect(connectorPoints(doc, solo)[0]).toEqual({ x: -150, y: -375 });
  });

  it('legacy port ends still resolve to their port', () => {
    const { doc, a, b } = twoShapes();
    const c = makeConnector({ shapeId: a.id, port: 2, x: 0, y: 0 }, { shapeId: b.id, x: 0, y: 0 });
    c.routing = 'straight';
    expect(connectorPoints(doc, c)[0]).toEqual({ x: 50, y: 50 });
  });

  it('pinned ends follow their shape and leave elbow-routed from the nearest side', () => {
    const { doc, a, b } = twoShapes();
    const c = makeConnector({ shapeId: a.id, at: { x: 0.75, y: 1 }, x: 0, y: 0 }, { shapeId: b.id, at: { x: 0, y: 0.5 }, x: 0, y: 0 });
    let pts = connectorPoints(doc, c);
    expect(pts[0]).toEqual({ x: 75, y: 50 });
    expect(pts[pts.length - 1]).toEqual({ x: 300, y: 225 });
    // Leaves straight down out of the bottom edge (the stub merges into the first run).
    expect(pts[1].x).toBe(75);
    expect(pts[1].y).toBeGreaterThan(50);
    a.x += 10;
    pts = connectorPoints(doc, c);
    expect(pts[0]).toEqual({ x: 85, y: 50 });
  });

  it('curved lines bulge by their bend at the midpoint', () => {
    const c = makeConnector({ x: 0, y: 0 }, { x: 100, y: 0 });
    c.routing = 'curved';
    c.bend = 30;
    const pts = connectorPoints(makePage(), c);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[pts.length - 1]).toEqual({ x: 100, y: 0 });
    const mid = pts[(pts.length - 1) / 2];
    expect(mid.x).toBeCloseTo(50);
    expect(mid.y).toBeCloseTo(30);
    expect(curveMidpoint({ x: 0, y: 0 }, { x: 100, y: 0 }, 30)).toEqual({ x: 50, y: 30 });
    expect(bendThrough({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 40, y: -12 })).toBeCloseTo(-12);
  });

  it('findAttachment skips shapes on hidden or locked layers', () => {
    const { doc, a } = twoShapes();
    const top = makeLayer('Top');
    doc.layers.push(top);
    a.layerId = top.id;
    top.locked = true;
    expect(findAttachment(doc, { x: 50, y: 25 }, 10)).toBeNull();
    top.locked = false;
    top.visible = false;
    expect(findAttachment(doc, { x: 98, y: 26 }, 10)).toBeNull();
  });

  it('rotates ports with the shape and snaps their direction to an axis', () => {
    const s = makeShape('rect', { x: 0, y: 0, w: 100, h: 50 });
    s.rotation = 90;
    const [top, right] = shapePorts(s);
    // Rotated 90° clockwise about (50, 25): the top port moves to the right side.
    expect(top.p.x).toBeCloseTo(75);
    expect(top.p.y).toBeCloseTo(25);
    expect(top.dir).toEqual({ x: 1, y: 0 });
    expect(right.dir).toEqual({ x: 0, y: 1 });
  });
});

const crosses = (pts: Point[], r: Rect) => routeHits(pts, [r]);

describe('obstacle routing', () => {
  /** a → b straight across, with a blocker between them. */
  function blocked() {
    const doc = makePage();
    const a = makeShape('rect', { x: 0, y: 0, w: 100, h: 50 });
    const b = makeShape('rect', { x: 400, y: 0, w: 100, h: 50 });
    const wall = makeShape('rect', { x: 200, y: -60, w: 80, h: 170 });
    addItems(doc, [a, b, wall]);
    const c = makeConnector({ shapeId: a.id, port: 1, x: 0, y: 0 }, { shapeId: b.id, port: 3, x: 0, y: 0 });
    addItems(doc, [c]);
    return { doc, c, wall };
  }

  it('keeps the simple route when nothing is in the way', () => {
    const a = { p: { x: 0, y: 0 }, dir: { x: 1, y: 0 } };
    const b = { p: { x: 200, y: 150 }, dir: { x: -1, y: 0 } };
    const far = [{ x: 1000, y: 1000, w: 50, h: 50 }];
    expect(elbowRoute(a, b, far)).toEqual(elbowRoute(a, b));
  });

  it('routes around a shape that blocks the direct line', () => {
    const { doc, c, wall } = blocked();
    const pts = connectorPoints(doc, c);
    expect(isOrthogonal(pts)).toBe(true);
    expect(crosses(pts, wall)).toBe(false);
    expect(pts[0]).toEqual({ x: 100, y: 25 });
    expect(pts[pts.length - 1]).toEqual({ x: 400, y: 25 });
    // Still leaves a's right port heading right, and enters b's left port heading right.
    expect(pts[1].x).toBeGreaterThan(pts[0].x);
    expect(pts[pts.length - 1].x).toBeGreaterThan(pts[pts.length - 2].x);
  });

  it('ignores shapes on hidden layers', () => {
    const { doc, c, wall } = blocked();
    const hidden = makeLayer('Hidden');
    hidden.visible = false;
    doc.layers.push(hidden);
    wall.layerId = hidden.id;
    expect(connectorPoints(doc, c)).toEqual([
      { x: 100, y: 25 },
      { x: 400, y: 25 },
    ]);
  });

  it('does not route back through its own shape', () => {
    // Leaving a's bottom port toward a target above a: the direct route would cut through a.
    const doc = makePage();
    const a = makeShape('rect', { x: 0, y: 200, w: 100, h: 50 });
    const b = makeShape('rect', { x: 0, y: 0, w: 100, h: 50 });
    addItems(doc, [a, b]);
    const c = makeConnector({ shapeId: a.id, port: 2, x: 0, y: 0 }, { shapeId: b.id, port: 0, x: 0, y: 0 });
    const pts = connectorPoints(doc, c);
    expect(isOrthogonal(pts)).toBe(true);
    expect(crosses(pts, a)).toBe(false);
    expect(crosses(pts, b)).toBe(false);
  });

  it('orthogonalPath finds a path around a box and returns null when walled in', () => {
    const box = { x: 40, y: -50, w: 20, h: 100 };
    const path = orthogonalPath({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 100, y: 0 }, { x: -1, y: 0 }, [box]);
    expect(path).not.toBeNull();
    expect(isOrthogonal(path!)).toBe(true);
    expect(crosses(path!, box)).toBe(false);
    const cage = [
      { x: -20, y: -20, w: 10, h: 40 },
      { x: 10, y: -20, w: 10, h: 40 },
      { x: -20, y: -20, w: 40, h: 10 },
      { x: -20, y: 10, w: 40, h: 10 },
    ];
    expect(orthogonalPath({ x: 0, y: 0 }, null, { x: 100, y: 0 }, null, cage)).toBeNull();
  });
});

describe('shapes with text beside them', () => {
  /** A 56×40 device at the origin with its name to its right. */
  const device = () => {
    const s = makeShape('image', { x: 0, y: 0, w: 56, h: 40 }, 'a-long-hostname\n10.0.0.1', { fontSize: 12 });
    s.textPosition = 'right';
    return s;
  };

  it('arrows attach to the text as well as the picture', () => {
    const doc = makePage();
    const hub = device();
    addItems(doc, [hub]);
    const label = sideLabelBox(hub)!;
    const frame = attachFrame(hub)!;
    expect(findAttachment(doc, { x: 28, y: 20 }, 8)?.shapeId).toBe(hub.id);
    // Dropped on the middle of the text: pinned right there (beyond the picture's own box).
    const mid = { x: label.x + label.w / 2, y: 20 };
    const onText = findAttachment(doc, mid, 4)!;
    expect(onText.shapeId).toBe(hub.id);
    expect(onText.at!.x).toBeGreaterThan(1);
    expect(pinnedPoint(hub, onText.at!)).toEqual(mid);
    // Dropped near the text's right edge: snapped onto it, leaving rightward.
    const edge = findAttachment(doc, { x: frame.w - 3, y: 12 }, 8)!;
    expect(pinnedPoint(hub, edge.at!).x).toBeCloseTo(frame.w);
    expect(pinnedDir(hub, edge.at!)).toEqual({ x: 1, y: 0 });
    // It follows the device when the device moves.
    hub.x += 100;
    expect(pinnedPoint(hub, onText.at!)).toEqual({ x: mid.x + 100, y: 20 });
    // Past the text: nothing.
    expect(findAttachment(doc, { x: 100 + frame.w + 30, y: 20 }, 8)).toBeNull();
  });

  it('floating ends use the sides of the picture and its text together', () => {
    const doc = makePage();
    const hub = device();
    const right = makeShape('rect', { x: 600, y: -5, w: 50, h: 50 });
    const under = makeShape('rect', { x: 0, y: 400, w: 50, h: 50 });
    addItems(doc, [hub, right, under]);
    const frame = attachFrame(hub)!;
    const toRight = makeConnector({ shapeId: hub.id, x: 0, y: 0 }, { shapeId: right.id, x: 0, y: 0 });
    const toUnder = makeConnector({ shapeId: hub.id, x: 0, y: 0 }, { shapeId: under.id, x: 0, y: 0 });
    addItems(doc, [toRight, toUnder]);
    // To the right: from the text's right edge, not from the picture under the text.
    expect(connectorPoints(doc, toRight)[0]).toEqual({ x: frame.w, y: 20 });
    // Downward: from the middle of the bottom of picture + text.
    expect(connectorPoints(doc, toUnder)[0]).toEqual({ x: frame.w / 2, y: 40 });
  });

  it('elbow lines route around the device and its text', () => {
    const doc = makePage();
    const hub = device();
    const a = makeShape('rect', { x: -300, y: -5, w: 100, h: 50 });
    const b = makeShape('rect', { x: 400, y: -5, w: 100, h: 50 });
    addItems(doc, [hub, a, b]);
    // Straight across at y = 20 would run through the picture and its text.
    const c = makeConnector({ shapeId: a.id, port: 1, x: 0, y: 0 }, { shapeId: b.id, port: 3, x: 0, y: 0 });
    addItems(doc, [c]);
    const pts = connectorPoints(doc, c);
    expect(isOrthogonal(pts)).toBe(true);
    expect(crosses(pts, localRectBox(hub, attachFrame(hub)!))).toBe(false);
  });
});
