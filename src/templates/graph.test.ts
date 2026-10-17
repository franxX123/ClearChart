import { describe, expect, it } from 'vitest';
import { addItems, DEFAULT_SHAPE_STYLE, emptyDoc, isShape } from '../model/doc';
import type { Doc, NodeComponent } from '../model/types';
import { layoutPlan, parseGraph, planImport, type GraphEdge, type ImportOptions } from './graph';
import type { GraphTemplate, LinkComponent } from './types';

const opts: ImportOptions = { keyField: 'name', endLabelField: 'interface', linkFields: ['interface', 'cableType'] };

const dev = (name: string, platform: string, iface: string, cableType = 'copper') => ({
  name,
  ip: `10.0.0.${name.length}`,
  platform,
  interface: iface,
  cableType,
});

const edges = (json: unknown) => parseGraph(JSON.stringify(json)).edges;

const sample: GraphEdge[] = edges([
  [dev('core1', 'cisco 9500', 'Te1/0/1', 'fiber'), dev('sw1', 'cisco 9300', 'Te1/1/1', 'fiber')],
  [dev('core1', 'cisco 9500', 'Te1/0/2', 'fiber'), dev('sw2', 'cisco 9200', 'Te1/1/1', 'fiber')],
  [dev('sw1', 'cisco 9300', 'Gi1/0/48'), dev('sw2', 'cisco 9200', 'Gi1/0/48')],
  // Same link as row 1, listed from the other side.
  [dev('sw1', 'cisco 9300', 'Te1/1/1', 'fiber'), dev('core1', 'cisco 9500', 'Te1/0/1', 'fiber')],
]);

const comp = (id: string, rule: NodeComponent['rule']): NodeComponent => ({
  id,
  name: id,
  rule,
  w: 120,
  h: 60,
  parts: [{ kind: 'rect', x: 0, y: 0, w: 120, h: 60, text: '{{name}}', style: DEFAULT_SHAPE_STYLE }],
});
const line = (id: string, rule: LinkComponent['rule'], stroke: string): LinkComponent => ({
  id,
  name: id,
  rule,
  routing: 'straight',
  label: '{{cableType}}',
  style: { stroke, strokeWidth: 2, dash: 'solid', startArrow: 'none', endArrow: 'none' },
});
const template: GraphTemplate = {
  id: 't',
  name: 'Network',
  fields: [],
  nodes: [comp('access', { field: 'platform', values: ['cisco 9200', 'cisco 9300'] }), comp('other', null)],
  links: [line('fiber', { field: 'cableType', values: ['fiber'] }, '#e67e22'), line('copper', null, '#3b4452')],
};

/** Applies a plan to a doc the way the store's importGraph does. */
function apply(doc: Doc, plan: ReturnType<typeof planImport>) {
  layoutPlan(doc, plan);
  doc.components = { ...doc.components, ...plan.components };
  addItems(doc, [...plan.connectors, ...plan.shapes]);
}

describe('parseGraph', () => {
  it('reads edges and the union of field names', () => {
    const g = parseGraph(JSON.stringify([[{ name: 'a', port: 1 }, { name: 'b', vlan: null, extra: true }]]));
    expect(g.fields).toEqual(['name', 'port', 'extra']);
    expect(g.edges[0]).toEqual({ a: { name: 'a', port: '1' }, b: { name: 'b', extra: 'true' } });
  });

  it('rejects files that are not edge lists, naming the bad edge', () => {
    expect(() => parseGraph('nope')).toThrow('Not valid JSON');
    expect(() => parseGraph('{"a":1}')).toThrow('array of edges');
    expect(() => parseGraph('[]')).toThrow('no edges');
    expect(() => parseGraph('[[{"name":"a"},{"name":"b"}],[{"name":"a"}]]')).toThrow('Edge 2');
    expect(() => parseGraph('[[{"name":"a"},"b"]]')).toThrow('Edge 1, second node');
  });
});

describe('planImport', () => {
  it('creates each node once and skips repeated links in either direction', () => {
    const plan = planImport(emptyDoc(), sample, template, opts);
    expect(plan.shapes.map((s) => s.data?.name)).toEqual(['core1', 'sw1', 'sw2']);
    expect(plan.connectors).toHaveLength(3);
    expect(plan.report).toMatchObject({ newNodes: 3, reusedNodes: 0, newLinks: 3, duplicateLinks: 1 });
  });

  it('picks components by rule and keeps link fields out of node data', () => {
    const plan = planImport(emptyDoc(), sample, template, opts);
    const byName = Object.fromEntries(plan.shapes.map((s) => [s.data!.name, s]));
    expect(byName.core1.componentId).toBe('other');
    expect(byName.sw1.componentId).toBe('access');
    expect(byName.sw2.componentId).toBe('access');
    expect(byName.sw1.data).toEqual({ name: 'sw1', ip: '10.0.0.3', platform: 'cisco 9300' });
    expect(Object.keys(plan.components).sort()).toEqual(['access', 'other']);
    expect(plan.report.nodeCounts).toEqual({ other: 1, access: 2 });
  });

  it('styles lines by rule, with interface labels at each end', () => {
    const plan = planImport(emptyDoc(), sample, template, opts);
    const [uplink, , crossLink] = plan.connectors;
    expect(uplink).toMatchObject({ label: 'fiber', sourceLabel: 'Te1/0/1', targetLabel: 'Te1/1/1', routing: 'straight' });
    expect(uplink.source).toMatchObject({ perimeter: true });
    expect(uplink.style.stroke).toBe('#e67e22');
    expect(crossLink.style.stroke).toBe('#3b4452');
    expect(crossLink.data).toEqual({ interface: 'Gi1/0/48', cableType: 'copper' });
    expect(plan.report.linkCounts).toEqual({ fiber: 2, copper: 1 });
  });

  it('reuses nodes already on the canvas and skips links already drawn', () => {
    const doc = emptyDoc();
    apply(doc, planImport(doc, sample, template, opts));
    const before = structuredClone(doc);

    const again = planImport(doc, sample, template, opts);
    expect(again.report).toMatchObject({ newNodes: 0, reusedNodes: 3, newLinks: 0, duplicateLinks: 4 });

    const more = planImport(
      doc,
      edges([[dev('SW1', 'cisco 9300', 'Gi1/0/1'), dev('ap1', 'aironet', 'eth0')]]),
      template,
      opts,
    );
    // Keys match case-insensitively; the new link attaches to the existing sw1 shape.
    expect(more.shapes.map((s) => s.data?.name)).toEqual(['ap1']);
    const sw1 = before.order.map((id) => before.items[id]).find((it) => isShape(it) && it.data?.name === 'sw1')!;
    expect(more.connectors[0].source.shapeId).toBe(sw1.id);

    apply(doc, more);
    // Existing nodes don't move.
    for (const id of before.order) {
      const it = before.items[id];
      if (isShape(it)) expect(doc.items[id]).toMatchObject({ x: it.x, y: it.y });
    }
  });

  it('reports edges with a missing key and self-links', () => {
    const plan = planImport(
      emptyDoc(),
      edges([
        [{ ip: '1' }, { name: 'b' }],
        [{ name: 'a', interface: 'x' }, { name: 'A', interface: 'y' }],
      ]),
      null,
      opts,
    );
    expect(plan.report).toMatchObject({ missingKey: 1, selfLoops: 1, newNodes: 1, newLinks: 0 });
  });

  it('falls back to plain boxes and lines without a template', () => {
    const plan = planImport(emptyDoc(), sample, null, opts);
    expect(plan.shapes[0].componentId).toBe('fallback:name');
    expect(plan.components['fallback:name'].parts[0].text).toBe('{{name}}');
    expect(plan.connectors[0].style.endArrow).toBe('none');
  });

  it('lays out new nodes without overlaps', () => {
    const doc = emptyDoc();
    const plan = planImport(doc, sample, template, opts);
    layoutPlan(doc, plan);
    const [a, b, c] = plan.shapes;
    const apart = (p: typeof a, q: typeof a) =>
      p.x + p.w <= q.x || q.x + q.w <= p.x || p.y + p.h <= q.y || q.y + q.h <= p.y;
    expect(apart(a, b) && apart(b, c) && apart(a, c)).toBe(true);
  });
});
