import { beforeEach, describe, expect, it } from 'vitest';
import { LIBRARY } from '../shapes/library';
import { addItems, emptyDoc, makeConnector, makeShape } from './doc';
import { currentPage, useStore } from './store';
import type { Connector, Shape } from './types';

const st = () => useStore.getState();
const page = () => currentPage(st());
const rect = LIBRARY.find((e) => e.kind === 'rect')!;

/** Loads a one-page doc with shapes a (0,0) and b (200,100) joined by a line. */
function load() {
  const doc = emptyDoc();
  const a = makeShape('rect', { x: 0, y: 0, w: 100, h: 50 });
  const b = makeShape('rect', { x: 200, y: 100, w: 100, h: 50 });
  const line = makeConnector({ shapeId: a.id, port: 1, x: 0, y: 0 }, { shapeId: b.id, port: 3, x: 0, y: 0 });
  addItems(doc.pages[0], [a, b, line]);
  st().loadDoc(doc);
  return { a: a.id, b: b.id, line: line.id };
}

beforeEach(() => {
  useStore.setState({ snapToGrid: true, clipboard: null });
});

describe('pages', () => {
  it('undo jumps back to the page the change was made on', () => {
    const { a } = load();
    const first = page().id;
    st().setSelection([a]);
    st().nudge(5, 0);
    st().addPage();
    expect(page().id).not.toBe(first);
    st().undo(); // removes the new page
    st().undo(); // the nudge, on the first page
    expect(page().id).toBe(first);
    expect((page().items[a] as Shape).x).toBe(0);
  });

  it('deleting the active page shows its neighbor', () => {
    load();
    st().addPage();
    const second = page().id;
    st().deletePage(second);
    expect(st().doc.pages).toHaveLength(1);
    expect(page().id).toBe(st().doc.pages[0].id);
  });
});

describe('layers', () => {
  it('deleting a layer deletes its items and detaches lines to them', () => {
    const { a, b, line } = load();
    st().addLayer();
    const top = st().activeLayerId;
    st().setSelection([b]);
    st().moveSelectionToLayer(top);
    st().deleteLayer(top);
    expect(page().items[b]).toBeUndefined();
    expect(page().items[a]).toBeDefined();
    const c = page().items[line] as Connector;
    expect(c.target.shapeId).toBeUndefined();
    expect(c.target).toMatchObject({ x: 200, y: 125 });
  });

  it('hiding a layer drops its items from the selection', () => {
    const { a } = load();
    st().setSelection([a]);
    st().setLayerFlags(page().layers[0].id, { visible: false });
    expect(st().selection).toEqual([]);
  });

  it('adding to a hidden layer reveals it, in the same undo step', () => {
    load();
    const layer = page().layers[0].id;
    st().setLayerFlags(layer, { visible: false });
    const id = st().addShape(rect, { x: 500, y: 500 });
    expect(page().layers[0].visible).toBe(true);
    expect(page().items[id].layerId).toBe(layer);
    st().undo();
    expect(page().items[id]).toBeUndefined();
    expect(page().layers[0].visible).toBe(false);
  });
});

describe('pictures, arrows and paste', () => {
  it('menu paste centers the copies on the given point', () => {
    const { a } = load(); // 100×50 at (0, 0)
    st().setSelection([a]);
    st().copy();
    st().paste({ x: 500, y: 400 });
    const copy = page().items[st().selection[0]] as Shape;
    expect(copy).toMatchObject({ x: 450, y: 375, w: 100, h: 50 });
    st().paste();
    expect(page().items[st().selection[0]]).toMatchObject({ x: 470, y: 395 });
  });

  it('adds a picture on the active layer, scaled to fit, without a text editor', () => {
    load();
    st().addLayer();
    const id = st().addImage('data:image/png;base64,AAAA', 1600, 800, { x: 0, y: 0 });
    const pic = page().items[id] as Shape;
    expect(pic).toMatchObject({ kind: 'image', x: -200, y: -100, w: 400, h: 200, layerId: st().activeLayerId });
    expect(pic.image?.src).toContain('data:image/png');
    st().setEditing(id);
    expect(st().editingId).toBeNull();
  });

  it('new arrows are straight, and switching to curved gives them a starting bend', () => {
    const { a, b } = load();
    const id = st().addConnector({ shapeId: a, at: { x: 1, y: 0.5 }, x: 0, y: 0 }, { shapeId: b, at: { x: 0, y: 0.5 }, x: 0, y: 0 });
    expect((page().items[id] as Connector).routing).toBe('straight');
    st().setSelection([id]);
    st().editConnectors({ routing: 'curved' });
    // Chord from (100, 25) to (200, 125): length ≈ 141, so bend ≈ 28.
    expect((page().items[id] as Connector).bend).toBe(28);
  });

  it('an aborted arrow leaves no undo step', () => {
    load();
    const before = st().history.past.length;
    st().beginBatch();
    st().addConnector({ x: 0, y: 0 }, { x: 1, y: 1 });
    st().abortBatch();
    expect(st().history.past.length).toBe(before);
    expect(page().order).toHaveLength(3);
  });
});

describe('text editing', () => {
  it('a new text box left empty disappears without an undo step', () => {
    load();
    const before = st().history.past.length;
    const id = st().addTextBox({ x: 300, y: 300 });
    expect(st().editingId).toBe(id);
    expect(st().editingNew).toBe(true);
    st().commitText(id, '   ');
    expect(page().items[id]).toBeUndefined();
    expect(st().history.past.length).toBe(before);
    expect(st().history.batch).toBeNull();
    expect(st().editingId).toBeNull();
  });

  it('a new text box with text is one undo step, fitted and left-aligned', () => {
    load();
    const before = st().history.past.length;
    const id = st().addTextBox({ x: 300, y: 300 });
    st().commitText(id, 'Hi\nthere');
    const box = page().items[id] as Shape;
    expect(box).toMatchObject({ kind: 'text', text: 'Hi\nthere', autoSize: true, w: 45, h: 39, x: 298 });
    expect(box.style).toMatchObject({ fill: 'none', stroke: 'none', textAlign: 'left' });
    expect(st().history.past.length).toBe(before + 1);
    st().undo();
    expect(page().items[id]).toBeUndefined();
  });

  it('font changes re-fit an auto-sized box', () => {
    load();
    const id = st().addTextBox({ x: 0, y: 0 });
    st().commitText(id, 'Hello');
    const w = (page().items[id] as Shape).w;
    st().setSelection([id]);
    st().styleShapes({ fontSize: 28 });
    expect((page().items[id] as Shape).w).toBeGreaterThan(w * 1.8);
    expect((page().items[id] as Shape).h).toBe(Math.ceil(28 * 1.25 + 4));
  });

  it('editing an existing shape is one undo step and keeps its size', () => {
    const { a } = load();
    const before = st().history.past.length;
    st().setEditing(a);
    st().commitText(a, 'Renamed');
    expect(page().items[a]).toMatchObject({ text: 'Renamed', w: 100, h: 50 });
    expect(st().history.past.length).toBe(before + 1);
    // An existing shape left empty is just emptied, not deleted.
    st().setEditing(a);
    st().commitText(a, '');
    expect(page().items[a]).toMatchObject({ text: '' });
  });

  it('switching page while typing into a new box drops it', () => {
    load();
    const id = st().addTextBox({ x: 0, y: 0 });
    const first = page().id;
    st().addPage();
    expect(st().editingId).toBeNull();
    expect(st().history.batch).toBeNull();
    st().setActivePage(first);
    expect(page().items[id]).toBeUndefined();
  });
});

const LINKS = [
  'hostName,hostInterface,hostIP,hostPlatform,neighborName,neighborInterface,neighborIP,neighborPlatform,speed',
  'core1,Eth1/1,10.0.0.1,N9K,dist1,Te1/1/1,10.0.1.1,C9500,10G',
  'dist1,Te1/1/1,10.0.1.1,C9500,core1,Eth1/1,10.0.0.1,N9K,',
  'core1,Eth1/2,10.0.0.1,N9K,dist1,Te1/1/2,10.0.1.1,C9500,10G',
  'dist1,Gi1/0/1,,,acc1,Gi0/1,,C9200,1G',
  ',,,,acc2,,,,',
].join('\n');

describe('CSV import', () => {
  const shapes = () => page().order.map((id) => page().items[id]).filter((it): it is Shape => it.type === 'shape');
  const lines = () => page().order.map((id) => page().items[id]).filter((it): it is Connector => it.type === 'connector');

  it('previews without changing anything', () => {
    load();
    const before = st().doc;
    const s = st().previewImport(LINKS);
    expect(s).toMatchObject({ devicesNew: 3, devicesExisting: 0, linksNew: 3, linksExisting: 0, merged: 1 });
    expect(s.skipped).toEqual([{ line: 6, reason: 'missing hostName' }]);
    expect(st().doc).toBe(before);
  });

  it('creates devices and links from templates as one undo step', () => {
    load();
    const before = st().history.past.length;
    const s = st().importLinks(LINKS);
    expect(s).toMatchObject({ devicesNew: 3, linksNew: 3, merged: 1 });
    expect(st().history.past.length).toBe(before + 1);
    expect(st().doc.templates?.nodes).toHaveLength(1);

    const core = shapes().find((x) => x.data?.hostName === 'core1')!;
    expect(core).toMatchObject({ text: 'core1\n10.0.0.1\nN9K', templateId: st().doc.templates!.nodes[0].id });
    const acc = shapes().find((x) => x.data?.hostName === 'acc1')!;
    expect(acc.text).toBe('acc1\nC9200');

    const ls = lines();
    expect(ls).toHaveLength(4); // the sample's own line + 3 imported
    const uplinks = ls.filter((c) => c.data?.speed === '10G');
    expect(uplinks.map((c) => c.startLabel).sort()).toEqual(['Eth1/1', 'Eth1/2']);
    // Two links between core1 and dist1: one straight, one fanned out.
    expect(uplinks.map((c) => c.routing).sort()).toEqual(['curved', 'straight']);
    // Floating ends attached to the devices.
    expect(uplinks[0].source).toEqual({ shapeId: core.id, x: 0, y: 0 });

    st().undo();
    expect(shapes().some((x) => x.data)).toBe(false);
    // The document's own starting templates were used, so undo leaves them alone.
    expect(st().doc.templates?.nodes).toHaveLength(1);
  });

  it('brings the default templates back for an import when every template was deleted', () => {
    load();
    for (const t of [...st().doc.templates!.nodes, ...st().doc.templates!.lines]) st().deleteTemplate(t.id);
    expect(st().doc.templates).toEqual({ nodes: [], lines: [] });
    st().importLinks(LINKS);
    expect(st().doc.templates!.nodes.map((t) => t.name)).toEqual(['Device']);
    expect(st().doc.templates!.lines.map((t) => t.name)).toEqual(['Link']);
  });

  it('re-importing reuses devices, updates their fields and adds no duplicate links', () => {
    load();
    st().importLinks(LINKS);
    const count = page().order.length;
    const core = shapes().find((x) => x.data?.hostName === 'core1')!;
    const at = { x: core.x, y: core.y };
    const s = st().importLinks(LINKS.replace(/10\.0\.0\.1/g, '10.9.9.9'));
    expect(s).toMatchObject({ devicesNew: 0, devicesExisting: 3, devicesUpdated: 1, linksNew: 0, linksExisting: 3 });
    expect(page().order.length).toBe(count);
    const again = page().items[core.id] as Shape;
    expect(again.text).toBe('core1\n10.9.9.9\nN9K');
    expect(again.x + again.w / 2).toBeCloseTo(at.x + core.w / 2);
  });

  it('adds only new links and devices next to existing ones', () => {
    load();
    st().importLinks(LINKS);
    const s = st().importLinks('hostName,neighborName,hostInterface\nCORE1,edge9,Eth1/9');
    expect(s).toMatchObject({ devicesNew: 1, devicesExisting: 1, linksNew: 1 });
    expect(shapes().find((x) => x.data?.hostName === 'edge9')).toBeDefined();
  });

  it('rejects files without the required columns, changing nothing', () => {
    load();
    const before = st().doc;
    expect(() => st().importLinks('a,b\n1,2')).toThrow('Missing columns: hostName, neighborName');
    expect(st().doc).toBe(before);
    expect(st().history.batch).toBeNull();
  });
});

describe('templates', () => {
  it('saves a template from a shape, and editing it restyles linked nodes on every page', () => {
    const { a } = load();
    st().updatePage((p) => void ((p.items[a] as Shape).text = 'Name: {name}'));
    const id = st().saveTemplate(a, 'Router')!;
    expect(st().doc.templates?.nodes.find((t) => t.id === id)).toMatchObject({ name: 'Router', text: 'Name: {name}', kind: 'rect' });
    const n1 = st().addFromTemplate(id, { x: 0, y: 0 })!;
    st().setItemData(n1, 'name', 'r1');
    expect((page().items[n1] as Shape).text).toBe('Name: r1');
    st().addPage();
    const n2 = st().addFromTemplate(id, { x: 0, y: 0 })!;
    st().updateTemplate(id, { kind: 'hexagon', text: 'R {name}' });
    expect(page().items[n2]).toMatchObject({ kind: 'hexagon', text: '' });
    st().setActivePage(st().doc.pages[0].id);
    expect(page().items[n1]).toMatchObject({ kind: 'hexagon', text: 'R r1' });
  });

  it('templated items are not text-edited by hand; unlinking or deleting the template frees them', () => {
    load();
    st().importLinks(LINKS);
    const node = page().order.map((id) => page().items[id]).find((it) => it.templateId)!;
    st().setEditing(node.id);
    expect(st().editingId).toBeNull();
    const tid = node.templateId!;
    st().deleteTemplate(tid);
    expect(page().items[node.id].templateId).toBeUndefined();
    expect(page().items[node.id].data?.hostName).toBeDefined();
    st().setEditing(node.id);
    expect(st().editingId).toBe(node.id);
  });

  it('the Arrow tool draws with a picked line template until back on Select', () => {
    const { a, b } = load();
    st().importLinks(LINKS);
    const lt = st().doc.templates!.lines[0];
    st().setArrowTemplate(lt.id);
    expect(st().tool).toBe('arrow');
    const c = st().addConnector({ shapeId: a, x: 0, y: 0 }, { shapeId: b, x: 0, y: 0 });
    expect(page().items[c]).toMatchObject({ templateId: lt.id, style: { endArrow: 'none' } });
    st().setTool('select');
    expect(st().arrowTemplateId).toBeNull();
  });
});

describe('groups and arranging', () => {
  it('pasted copies form their own group', () => {
    const { a, b } = load();
    st().setSelection([a, b]);
    st().group();
    const g = page().items[a].groupIds![0];
    st().copy();
    st().paste();
    const copies = st().selection.map((id) => page().items[id]);
    expect(copies).toHaveLength(2);
    expect(copies[0].groupIds![0]).toBe(copies[1].groupIds![0]);
    expect(copies[0].groupIds![0]).not.toBe(g);
  });

  it('ungroup removes only the outermost group', () => {
    const { a, b, line } = load();
    st().setSelection([a, b]);
    st().group();
    st().setSelection([a, b, line]);
    st().group();
    st().ungroup();
    expect(page().items[line].groupIds).toBeUndefined();
    expect(page().items[a].groupIds).toHaveLength(1);
  });

  it('align moves a group as one unit', () => {
    const { a, b } = load();
    const c = st().addShape(rect, { x: 570, y: 335 }); // 140×70 at (500, 300)
    st().setSelection([a, b]);
    st().group();
    st().setSelection([a, b, c]);
    st().align('right');
    // The group's right edge (300) moves to 640, keeping a and b's relative layout.
    expect((page().items[b] as Shape).x).toBe(540);
    expect((page().items[a] as Shape).x).toBe(340);
    expect((page().items[c] as Shape).x).toBe(500);
  });

  it('rotation of 0 removes the field', () => {
    const { a } = load();
    st().setSelection([a]);
    st().rotateShapes(450);
    expect((page().items[a] as Shape).rotation).toBe(90);
    st().rotateShapes(360);
    expect('rotation' in page().items[a]).toBe(false);
  });
});
