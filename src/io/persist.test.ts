import { describe, expect, it } from 'vitest';
import { addItems, DEFAULT_SHAPE_STYLE, makeShape, sampleDoc } from '../model/doc';
import type { NodeComponent } from '../model/types';
import { parseDoc, parseTabIndex, serializeDoc, serializeTabIndex } from './persist';

describe('document files', () => {
  it('round-trips a document', () => {
    const doc = sampleDoc();
    expect(parseDoc(serializeDoc(doc))).toEqual(doc);
  });

  it('rejects files that are not ClearChart documents', () => {
    expect(() => parseDoc('{"hello":1}')).toThrow('Not a ClearChart document');
    expect(() => parseDoc('not json')).toThrow();
    expect(() =>
      parseDoc(JSON.stringify({ version: 1, items: {}, order: ['missing'] })),
    ).toThrow('Invalid item');
  });
});

describe('components in documents', () => {
  const comp: NodeComponent = {
    id: 'sw',
    name: 'Switch',
    rule: { field: 'platform', values: ['cisco 9300'] },
    w: 120,
    h: 60,
    parts: [{ kind: 'rect', x: 0, y: 0, w: 120, h: 60, text: '{{name}}', style: DEFAULT_SHAPE_STYLE }],
  };

  it('round-trips component definitions, instance data and end labels', () => {
    const doc = sampleDoc();
    const inst = makeShape('component', { x: 0, y: 0, w: 120, h: 60 });
    inst.componentId = 'sw';
    inst.data = { name: 'sw1', ip: '10.0.0.1' };
    addItems(doc, [inst]);
    doc.components = { sw: comp };
    expect(parseDoc(serializeDoc(doc))).toEqual(doc);
  });

  it('turns an instance whose definition is missing into a plain box', () => {
    const doc = sampleDoc();
    const inst = makeShape('component', { x: 0, y: 0, w: 120, h: 60 });
    inst.componentId = 'gone';
    addItems(doc, [inst]);
    doc.components = { bad: { id: 'bad' } as NodeComponent };
    const parsed = parseDoc(serializeDoc(doc));
    expect(parsed.items[inst.id]).toMatchObject({ kind: 'rect' });
    expect(parsed.items[inst.id]).not.toHaveProperty('componentId');
    expect(parsed.components).toEqual({});
  });
});

describe('groups in documents', () => {
  it('keeps valid group lists and drops malformed ones', () => {
    const doc = sampleDoc();
    const [a, b, c] = doc.order;
    doc.items[a].groups = ['g1', 'g2'];
    (doc.items[b] as { groups: unknown }).groups = 'g1';
    (doc.items[c] as { groups: unknown }).groups = [];
    const parsed = parseDoc(serializeDoc(doc));
    expect(parsed.items[a].groups).toEqual(['g1', 'g2']);
    expect(parsed.items[b]).not.toHaveProperty('groups');
    expect(parsed.items[c]).not.toHaveProperty('groups');
  });
});

describe('opacity', () => {
  it('round-trips fill opacity and opacity on shapes and lines', () => {
    const doc = sampleDoc();
    const [shapeId] = doc.order;
    const lineId = doc.order.find((id) => doc.items[id].type === 'connector')!;
    Object.assign(doc.items[shapeId].style, { fillOpacity: 0.4, opacity: 0.8 });
    Object.assign(doc.items[lineId].style, { opacity: 0.5 });
    expect(parseDoc(serializeDoc(doc))).toEqual(doc);
  });
});

describe('tab index', () => {
  it('round-trips, and falls back to the first tab when the active one is unknown', () => {
    expect(parseTabIndex(serializeTabIndex({ tabs: ['a', 'b'], active: 'b' }))).toEqual({ tabs: ['a', 'b'], active: 'b' });
    expect(parseTabIndex(JSON.stringify({ version: 1, tabs: ['a', 'a', 7, 'b'], active: 'zz' }))).toEqual({
      tabs: ['a', 'b'],
      active: 'a',
    });
  });

  it('returns null for missing or malformed data', () => {
    expect(parseTabIndex(null)).toBeNull();
    expect(parseTabIndex('nope')).toBeNull();
    expect(parseTabIndex(JSON.stringify({ version: 1, tabs: [] }))).toBeNull();
    expect(parseTabIndex(JSON.stringify({ version: 2, tabs: ['a'] }))).toBeNull();
  });
});
