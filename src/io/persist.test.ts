import { describe, expect, it } from 'vitest';
import { addItems, DEFAULT_SHAPE_STYLE, makeConnector, makeShape } from '../model/doc';
import { defaultTemplates, nodeFromTemplate } from '../model/templates';
import { exampleDoc } from '../test/exampleDoc';
import { parseDoc, serializeDoc } from './persist';

describe('document files', () => {
  it('round-trips a document', () => {
    const doc = exampleDoc();
    expect(parseDoc(serializeDoc(doc))).toEqual(doc);
  });

  it('round-trips pinned arrows, curves and pictures', () => {
    const doc = exampleDoc();
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
    const doc = exampleDoc();
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
    const doc = exampleDoc();
    doc.templates = defaultTemplates();
    doc.templates.nodes[0].text = 'Name: {name}\n{ IP }\n{platform} ({other})';
    const node = nodeFromTemplate(doc.templates.nodes[0], {}, { x: 0, y: 0 });
    node.data = { name: 'sw1', ip: '10.0.0.1', platform: 'C9300', site: 'HQ' };
    addItems(doc.pages[0], [node]);
    const back = parseDoc(serializeDoc(doc));
    expect(back.templates!.nodes[0].text).toBe('Name: {hostName}\n{hostIP}\n{hostPlatform} ({other})');
    expect(back.pages[0].items[node.id].data).toEqual({ hostName: 'sw1', hostIP: '10.0.0.1', hostPlatform: 'C9300', site: 'HQ' });
  });

  it('gives documents without templates the built-in elements and pictures, but not ones whose templates were deleted', () => {
    const doc = exampleDoc();
    const builtIns = defaultTemplates().nodes.map((t) => t.name);
    expect(doc.templates?.nodes.map((t) => t.name)).toEqual(builtIns);
    expect(doc.templates?.lines.map((t) => t.name)).toEqual(['Link']);
    // Saved before templates existed: no `templates` or `assets` key at all (stringify drops undefined).
    const older = parseDoc(JSON.stringify({ ...doc, templates: undefined, assets: undefined }));
    expect(older.templates?.nodes.map((t) => t.name)).toEqual(builtIns);
    expect(older.templates?.defaultNodeId).toBe(older.templates?.nodes.find((t) => t.name === 'Generic device')?.id);
    for (const t of older.templates!.nodes) expect(older.assets?.[t.image!.asset]).toMatch(/^data:image\/svg\+xml,/);
    const emptied = parseDoc(JSON.stringify({ ...doc, templates: { nodes: [], lines: [] }, assets: undefined }));
    expect(emptied.templates).toEqual({ nodes: [], lines: [] });
    expect(emptied.assets).toBeUndefined();
  });

  it('round-trips uploaded pictures, picture elements with rules, the default element and picture devices', () => {
    const doc = exampleDoc();
    doc.assets = { ...doc.assets, up1: 'data:image/png;base64,iVBORw0KGgo=' };
    const t = { ...doc.templates!.nodes[0], id: 'n9k', name: 'Nexus 9300', image: { asset: 'up1' }, platforms: ['9300', 'N9K'] };
    doc.templates!.nodes.push(t);
    doc.templates!.defaultNodeId = 'n9k';
    addItems(doc.pages[0], [nodeFromTemplate(t, { hostName: 'core1', hostPlatform: 'N9K-C93180' }, { x: 0, y: 0 })]);
    const back = parseDoc(serializeDoc(doc));
    expect(back).toEqual(doc);
    expect(back.pages[0].items[back.pages[0].order.at(-1)!]).toMatchObject({ kind: 'image', image: { asset: 'up1' }, textPosition: 'right' });
  });

  it('moves device text saved below pictures to their right', () => {
    const doc = exampleDoc();
    const t = doc.templates!.nodes[0];
    const node = nodeFromTemplate(t, { hostName: 'sw1' }, { x: 0, y: 0 });
    addItems(doc.pages[0], [node]);
    const json = serializeDoc(doc).replace(/"textPosition": "right"/g, '"textPosition": "below"');
    expect(json).toContain('"textPosition": "below"');
    const back = parseDoc(json);
    expect(back.templates!.nodes.every((n) => n.textPosition === 'right')).toBe(true);
    expect(back.pages[0].items[node.id]).toMatchObject({ textPosition: 'right' });
    expect(back).toEqual(doc);
  });

  it('turns flowchart shapes (no longer drawn) into rectangles, keeping their text, look and lines', () => {
    const doc = exampleDoc();
    const page = doc.pages[0];
    const [start, step, check] = page.order;
    const box = { id: 'box', name: 'Decision box', kind: 'rect' as const, w: 100, h: 60, style: { ...DEFAULT_SHAPE_STYLE }, text: '' };
    doc.templates!.nodes.push(box);
    // As an older file would have them.
    const json = JSON.parse(serializeDoc(doc));
    json.pages[0].items[start].kind = 'terminator';
    json.pages[0].items[check].kind = 'diamond';
    json.pages[0].items[step].kind = 'cylinder';
    json.templates.nodes.find((t: { id: string }) => t.id === 'box').kind = 'parallelogram';
    const back = parseDoc(JSON.stringify(json));
    expect(back.pages[0].items[start]).toMatchObject({ kind: 'roundRect', text: 'Start', style: { fill: '#dff3e4' } });
    expect(back.pages[0].items[check]).toMatchObject({ kind: 'rect', text: 'Approved?' });
    expect(back.pages[0].items[step]).toMatchObject({ kind: 'rect' });
    expect(back.templates!.nodes.find((t) => t.id === 'box')!.kind).toBe('rect');
    // Lines attached to them are untouched.
    const lines = (d: typeof doc) => d.pages[0].order.map((id) => d.pages[0].items[id]).filter((it) => it.type === 'connector');
    expect(lines(back)).toEqual(lines(doc));
  });

  it('keeps only picture data among stored assets', () => {
    const doc = { ...exampleDoc(), assets: { ok: 'data:image/png;base64,AA', bad: 7, worse: { x: 1 } } };
    expect(parseDoc(JSON.stringify(doc)).assets).toEqual({ ok: 'data:image/png;base64,AA' });
  });

  it('drops malformed templates instead of failing', () => {
    const doc = exampleDoc();
    const raw = { ...doc, templates: { nodes: [{ id: 'x' }, 7], lines: 'nope' } };
    expect(parseDoc(JSON.stringify(raw)).templates).toEqual({ nodes: [], lines: [] });
  });

  it('migrates version 1 files to a single page', () => {
    const v1 = exampleDoc().pages[0];
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
