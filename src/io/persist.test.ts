import { describe, expect, it } from 'vitest';
import { addItems, makeConnector, makeShape, sampleDoc } from '../model/doc';
import { defaultTemplates, nodeFromTemplate } from '../model/templates';
import { parseDoc, serializeDoc } from './persist';

describe('document files', () => {
  it('round-trips a document', () => {
    const doc = sampleDoc();
    expect(parseDoc(serializeDoc(doc))).toEqual(doc);
  });

  it('round-trips pinned arrows, curves and pictures', () => {
    const doc = sampleDoc();
    const page = doc.pages[0];
    const [first, second] = page.order;
    const pic = makeShape('image', { x: 0, y: 0, w: 40, h: 30 });
    pic.image = { src: 'data:image/png;base64,iVBORw0KGgo=' };
    const arrow = makeConnector({ shapeId: first, at: { x: 0.3, y: 1 }, x: 0, y: 0 }, { shapeId: second, at: { x: 0.5, y: 0.5 }, x: 0, y: 0 });
    arrow.routing = 'curved';
    arrow.bend = -24;
    const note = makeShape('text', { x: 5, y: 5, w: 45, h: 39 }, 'Hi\nthere', { fill: 'none', stroke: 'none', textAlign: 'left' });
    note.autoSize = true;
    addItems(page, [pic, arrow, note]);
    expect(parseDoc(serializeDoc(doc))).toEqual(doc);
  });

  it('round-trips templates, item data and end labels', () => {
    const doc = sampleDoc();
    doc.templates = defaultTemplates();
    const t = doc.templates.nodes[0];
    const page = doc.pages[0];
    const node = nodeFromTemplate(t, { hostName: 'sw1', hostIP: '10.0.0.1' }, { x: 0, y: 0 });
    const line = makeConnector({ shapeId: node.id, x: 0, y: 0 }, { x: 50, y: 50 });
    line.startLabel = 'Gi0/1';
    line.data = { hostInterface: 'Gi0/1' };
    addItems(page, [node, line]);
    expect(parseDoc(serializeDoc(doc))).toEqual(doc);
  });

  it('renames device fields from the first import format to the CSV column names', () => {
    const doc = sampleDoc();
    doc.templates = defaultTemplates();
    doc.templates.nodes[0].text = 'Name: {name}\n{ IP }\n{platform} ({other})';
    const node = nodeFromTemplate(doc.templates.nodes[0], {}, { x: 0, y: 0 });
    node.data = { name: 'sw1', ip: '10.0.0.1', platform: 'C9300', site: 'HQ' };
    addItems(doc.pages[0], [node]);
    const back = parseDoc(serializeDoc(doc));
    expect(back.templates!.nodes[0].text).toBe('Name: {hostName}\n{hostIP}\n{hostPlatform} ({other})');
    expect(back.pages[0].items[node.id].data).toEqual({ hostName: 'sw1', hostIP: '10.0.0.1', hostPlatform: 'C9300', site: 'HQ' });
  });

  it('gives documents without templates the default node and line, but not ones whose templates were deleted', () => {
    const doc = sampleDoc();
    expect(doc.templates?.nodes.map((t) => t.name)).toEqual(['Device']);
    expect(doc.templates?.lines.map((t) => t.name)).toEqual(['Link']);
    // Saved before templates existed: no `templates` key at all (stringify drops undefined).
    const older = { ...doc, templates: undefined };
    expect(parseDoc(JSON.stringify(older)).templates?.nodes.map((t) => t.text)).toEqual(['{hostName}\n{hostIP}\n{hostPlatform}']);
    const emptied = { ...doc, templates: { nodes: [], lines: [] } };
    expect(parseDoc(JSON.stringify(emptied)).templates).toEqual({ nodes: [], lines: [] });
  });

  it('drops malformed templates instead of failing', () => {
    const doc = sampleDoc();
    const raw = { ...doc, templates: { nodes: [{ id: 'x' }, 7], lines: 'nope' } };
    expect(parseDoc(JSON.stringify(raw)).templates).toEqual({ nodes: [], lines: [] });
  });

  it('migrates version 1 files to a single page', () => {
    const v1 = sampleDoc().pages[0];
    const doc = parseDoc(JSON.stringify({ version: 1, title: 'Old', items: v1.items, order: v1.order }));
    expect(doc.version).toBe(2);
    expect(doc.title).toBe('Old');
    expect(doc.pages).toHaveLength(1);
    expect(doc.pages[0]).toMatchObject({ name: 'Page 1', items: v1.items, order: v1.order });
    expect(doc.pages[0].layers).toHaveLength(1);
  });

  it('fills in missing layers and layer flags', () => {
    const page = { id: 'p', name: 'P', items: {}, order: [] };
    const doc = parseDoc(JSON.stringify({ version: 2, title: 'T', pages: [page, { ...page, id: 'q', layers: [{ id: 'l' }] }] }));
    expect(doc.pages[0].layers).toHaveLength(1);
    expect(doc.pages[1].layers).toEqual([{ id: 'l', name: 'Layer 1', visible: true, locked: false }]);
  });

  it('rejects files that are not ClearChart documents', () => {
    expect(() => parseDoc('{"hello":1}')).toThrow('Not a ClearChart document');
    expect(() => parseDoc('not json')).toThrow();
    expect(() =>
      parseDoc(JSON.stringify({ version: 1, items: {}, order: ['missing'] })),
    ).toThrow('Invalid item');
    expect(() => parseDoc(JSON.stringify({ version: 2, title: 'T', pages: [] }))).toThrow('Not a ClearChart document');
  });
});
