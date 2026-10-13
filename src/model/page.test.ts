import { describe, expect, it } from 'vitest';
import { addItems, makeConnector, makeShape } from './doc';
import { clonePage, copyItems, expandGroups, groupUnits, isInteractive, makeLayer, makePage, renderOrder } from './page';
import type { Connector } from './types';

function fixture() {
  const page = makePage();
  const a = makeShape('rect', { x: 0, y: 0, w: 10, h: 10 });
  const b = makeShape('rect', { x: 20, y: 0, w: 10, h: 10 });
  const c = makeShape('rect', { x: 40, y: 0, w: 10, h: 10 });
  const line = makeConnector({ shapeId: a.id, x: 0, y: 0 }, { shapeId: b.id, x: 0, y: 0 });
  a.groupIds = ['g1'];
  b.groupIds = ['g1', 'inner'];
  addItems(page, [a, b, c, line]);
  return { page, a, b, c, line };
}

describe('layers', () => {
  it('paints layer by layer and treats unknown layers as the bottom one', () => {
    const { page, a, b, c, line } = fixture();
    const top = makeLayer('Top');
    page.layers.push(top);
    a.layerId = top.id;
    c.layerId = 'gone';
    expect(renderOrder(page)).toEqual([b.id, c.id, line.id, a.id]);
    top.visible = false;
    expect(renderOrder(page)).not.toContain(a.id);
    expect(isInteractive(page, a)).toBe(false);
  });
});

describe('groups', () => {
  it('expands a member to its whole outermost group', () => {
    const { page, a, b, c } = fixture();
    expect(expandGroups(page, [b.id])).toEqual([a.id, b.id]);
    expect(expandGroups(page, [c.id])).toEqual([c.id]);
  });

  it('skips locked members when expanding', () => {
    const { page, a, b } = fixture();
    const locked = makeLayer('Locked');
    locked.locked = true;
    page.layers.push(locked);
    a.layerId = locked.id;
    expect(expandGroups(page, [b.id])).toEqual([b.id]);
  });

  it('splits a selection into arrangement units', () => {
    const { page, a, b, c, line } = fixture();
    expect(groupUnits(page, [a.id, b.id, c.id, line.id])).toEqual([[a.id, b.id], [c.id], [line.id]]);
  });
});

describe('copying', () => {
  it('remaps ids, connector ends and groups to the copies', () => {
    const { a, b, line } = fixture();
    const { copies } = copyItems([a, b, line]);
    const [ca, cb, cl] = copies;
    expect(ca.id).not.toBe(a.id);
    expect((cl as Connector).source.shapeId).toBe(ca.id);
    expect((cl as Connector).target.shapeId).toBe(cb.id);
    expect(ca.groupIds![0]).toBe(cb.groupIds![0]);
    expect(ca.groupIds![0]).not.toBe('g1');
    expect(cb.groupIds![1]).not.toBe('inner');
  });

  it('leaves ends attached to uncopied shapes pointing at the original', () => {
    const { a, line } = fixture();
    const { copies } = copyItems([line]);
    expect((copies[0] as Connector).source.shapeId).toBe(a.id);
  });

  it('clones a page with fresh ids throughout', () => {
    const { page } = fixture();
    const extra = makeLayer('Extra');
    page.layers.push(extra);
    page.items[page.order[2]].layerId = extra.id;
    const copy = clonePage(page, 'Copy');
    expect(copy.name).toBe('Copy');
    expect(copy.id).not.toBe(page.id);
    expect(copy.order).toHaveLength(page.order.length);
    expect(copy.order.some((id) => page.items[id])).toBe(false);
    expect(copy.layers.map((l) => l.name)).toEqual(['Layer 1', 'Extra']);
    expect(copy.items[copy.order[2]].layerId).toBe(copy.layers[1].id);
    const line = copy.items[copy.order[3]] as Connector;
    expect(line.source.shapeId).toBe(copy.order[0]);
  });
});
