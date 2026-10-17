import { beforeEach, describe, expect, it } from 'vitest';
import { LIBRARY, type ShapeEntry } from '../shapes/library';
import { emptyDoc, isConnector, isShape, DEFAULT_SHAPE_STYLE } from './doc';
import { useStore } from './store';
import type { NodeComponent, Shape } from './types';

const st = useStore.getState;
const rect = LIBRARY.find((e) => e.kind === 'rect') as ShapeEntry;

function reset() {
  for (const id of st().tabs.slice(1)) st().closeTab(id);
  st().loadDoc(emptyDoc());
  useStore.setState({ clipboard: null, snapToGrid: false });
}

const shapes = () => st().doc.order.map((id) => st().doc.items[id]).filter(isShape);

beforeEach(reset);

describe('tabs', () => {
  it('keeps each tab’s diagram and undo history separate', () => {
    const first = st().activeTab;
    st().addShape(rect, { x: 0, y: 0 });
    const second = st().newTab();
    expect(st().tabs).toEqual([first, second]);
    expect(st().doc.order).toEqual([]);
    expect(st().history.past).toHaveLength(0);

    st().addShape(rect, { x: 100, y: 0 });
    st().addShape(rect, { x: 200, y: 0 });
    st().switchTab(first);
    expect(shapes()).toHaveLength(1);
    st().undo();
    expect(shapes()).toHaveLength(0);

    st().switchTab(second);
    expect(shapes()).toHaveLength(2);
    st().undo();
    expect(shapes()).toHaveLength(1);
  });

  it('opens a new tab next to the active one', () => {
    const a = st().activeTab;
    const b = st().newTab();
    st().switchTab(a);
    const c = st().newTab();
    expect(st().tabs).toEqual([a, c, b]);
  });

  it('closing the active tab shows a neighbour; closing the last leaves an empty tab', () => {
    const a = st().activeTab;
    st().update((d) => void (d.title = 'A'));
    const b = st().newTab();
    st().closeTab(b);
    expect(st().tabs).toEqual([a]);
    expect(st().activeTab).toBe(a);
    expect(st().doc.title).toBe('A');
    expect(st().parked).toEqual({});

    st().closeTab(a);
    expect(st().tabs).toHaveLength(1);
    expect(st().activeTab).not.toBe(a);
    expect(st().doc.order).toEqual([]);
  });
});

describe('clipboard', () => {
  const comp: NodeComponent = {
    id: 'sw',
    name: 'Switch',
    rule: null,
    w: 100,
    h: 50,
    parts: [{ kind: 'rect', x: 0, y: 0, w: 100, h: 50, text: '{{name}}', style: DEFAULT_SHAPE_STYLE }],
  };

  it('pastes a component into another tab together with its definition', () => {
    st().addComponent(comp, { x: 0, y: 0 });
    st().copy();
    st().newTab();
    expect(st().doc.components).toBeUndefined();
    st().paste();
    const [pasted] = shapes();
    expect(pasted.componentId).toBe('sw');
    expect(st().doc.components?.sw).toEqual(comp);
  });

  it('pastes centered on a point, and frees line ends whose shape was not copied', () => {
    const a = st().addShape(rect, { x: 0, y: 0 });
    const b = st().addShape(rect, { x: 300, y: 0 });
    const line = st().addConnector({ shapeId: a, x: 0, y: 0 }, { shapeId: b, x: 0, y: 0 });
    st().setSelection([b, line]);
    st().copy();
    st().paste({ x: 1000, y: 1000 });
    const ids = st().selection;
    const copy = shapes().find((s) => ids.includes(s.id))!;
    const c = ids.map((id) => st().doc.items[id]).find(isConnector)!;
    expect(c.source.shapeId).toBeUndefined();
    expect(c.target.shapeId).toBe(copy.id);
    // The copy (shape plus the free end) is centered on the point.
    const left = Math.min(copy.x, c.source.x);
    const right = Math.max(copy.x + copy.w, c.source.x);
    expect((left + right) / 2).toBeCloseTo(1000);
  });
});

describe('grouping', () => {
  it('groups and ungroups in one undo step each', () => {
    const a = st().addShape(rect, { x: 0, y: 0 });
    const b = st().addShape(rect, { x: 200, y: 0 });
    st().setSelection([a, b]);
    st().group();
    const g = (st().doc.items[a] as Shape).groups;
    expect(g).toHaveLength(1);
    expect((st().doc.items[b] as Shape).groups).toEqual(g);

    st().setSelection([a]);
    st().ungroup();
    expect(st().selection.sort()).toEqual([a, b].sort());
    expect(st().doc.items[b]).not.toHaveProperty('groups');

    st().undo();
    expect((st().doc.items[b] as Shape).groups).toEqual(g);
    st().undo();
    expect(st().doc.items[a]).not.toHaveProperty('groups');
  });

  it('needs two or more things to group', () => {
    const a = st().addShape(rect, { x: 0, y: 0 });
    st().setSelection([a]);
    const before = st().history.past.length;
    st().group();
    expect(st().history.past).toHaveLength(before);
  });

  it('duplicates a group as a separate group', () => {
    const a = st().addShape(rect, { x: 0, y: 0 });
    const b = st().addShape(rect, { x: 200, y: 0 });
    st().setSelection([a, b]);
    st().group();
    st().duplicate();
    const copies = st().selection.map((id) => st().doc.items[id] as Shape);
    expect(copies).toHaveLength(2);
    expect(copies[0].groups).toEqual(copies[1].groups);
    expect(copies[0].groups).not.toEqual((st().doc.items[a] as Shape).groups);
  });
});

describe('library lines and opacity', () => {
  it('adds a free, straight arrow line centered on the point', () => {
    useStore.setState({ snapToGrid: true });
    const id = st().addLine({ x: 203, y: 98 });
    const c = st().doc.items[id];
    expect(isConnector(c)).toBe(true);
    if (!isConnector(c)) return;
    expect(c.routing).toBe('straight');
    expect(c.style.endArrow).toBe('arrow');
    expect(c.source).toEqual({ x: 140, y: 100 });
    expect(c.target).toEqual({ x: 260, y: 100 });
    expect(st().selection).toEqual([id]);
  });

  it('a slider drag of fill opacity or opacity is one undo step each', () => {
    const a = st().addShape(rect, { x: 0, y: 0 });
    const steps = st().history.past.length;
    for (const v of [0.9, 0.7, 0.5]) st().styleShapes({ fillOpacity: v }, 'fillOpacity');
    for (const v of [0.8, 0.6]) st().styleShapes({ opacity: v }, 'opacity');
    expect(st().history.past).toHaveLength(steps + 2);
    expect((st().doc.items[a] as Shape).style).toMatchObject({ fillOpacity: 0.5, opacity: 0.6 });
    st().undo();
    expect((st().doc.items[a] as Shape).style.opacity).toBeUndefined();
    st().undo();
    expect((st().doc.items[a] as Shape).style.fillOpacity).toBeUndefined();
  });
});
