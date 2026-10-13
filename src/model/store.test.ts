import { beforeEach, describe, expect, it } from 'vitest';
import { BUILT_IN_DEVICES } from '../shapes/deviceIcons';
import { LIBRARY } from '../shapes/library';
import { addItems, DEFAULT_SHAPE_STYLE, emptyDoc, makeConnector, makeShape } from './doc';
import { currentPage, useStore } from './store';
import { nodeFromTemplate } from './templates';
import type { Connector, NodeTemplate, Shape } from './types';

const st = () => useStore.getState();
const page = () => currentPage(st());
const rect = LIBRARY.find((e) => e.kind === 'rect')!;
const BUILT_INS = BUILT_IN_DEVICES.map((d) => d.name);
/** The id of the document's node element with this name. */
const nodeId = (name: string) => st().doc.templates!.nodes.find((t) => t.name === name)!.id;

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
    expect(st().doc.templates?.nodes).toHaveLength(BUILT_INS.length);

    // Every platform in the file is a Cisco switch (N9K, C9500, C9200): drawn as Switch pictures.
    const core = shapes().find((x) => x.data?.hostName === 'core1')!;
    expect(core).toMatchObject({ kind: 'image', textPosition: 'right', text: 'core1\n10.0.0.1\nN9K', templateId: nodeId('Switch') });
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
    expect(st().doc.templates?.nodes).toHaveLength(BUILT_INS.length);
  });

  it('brings the default templates back for an import when every template was deleted', () => {
    load();
    for (const t of [...st().doc.templates!.nodes, ...st().doc.templates!.lines]) st().deleteTemplate(t.id);
    expect(st().doc.templates).toEqual({ nodes: [], lines: [] });
    expect(st().doc.assets).toEqual({});
    st().importLinks(LINKS);
    expect(st().doc.templates!.nodes.map((t) => t.name)).toEqual(BUILT_INS);
    expect(st().doc.templates!.lines.map((t) => t.name)).toEqual(['Link']);
    expect(Object.keys(st().doc.assets!)).toHaveLength(BUILT_INS.length);
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

describe('tools', () => {
  it('the Place tool holds what to place; any other tool forgets it', () => {
    load();
    st().setPlacing({ kind: 'shape', entry: 1 });
    expect(st()).toMatchObject({ tool: 'place', placing: { kind: 'shape', entry: 1 }, toolLocked: false });
    st().setTool('arrow');
    expect(st()).toMatchObject({ tool: 'arrow', placing: null });
    st().setPlacing({ kind: 'shape', entry: 0 }, true);
    expect(st().toolLocked).toBe(true);
    st().setTool('select');
    expect(st()).toMatchObject({ tool: 'select', placing: null, toolLocked: false });
    // Picking a line template for the Arrow tool also leaves Place.
    st().setPlacing({ kind: 'shape', entry: 0 });
    st().setArrowTemplate(st().doc.templates!.lines[0].id);
    expect(st()).toMatchObject({ tool: 'arrow', placing: null });
  });

  it('a shape drawn by dragging is one undo step, selected, at the drawn rect', () => {
    load();
    const circle = LIBRARY.find((e) => e.kind === 'circle')!;
    const before = st().history.past.length;
    st().beginBatch();
    const id = st().drawShape(circle, { x: 0, y: 0, w: 10, h: 10 });
    st().updatePage((p) => Object.assign(p.items[id], { x: 0, y: 0, w: 120, h: 120 }));
    st().endBatch();
    expect(st().history.past.length).toBe(before + 1);
    expect(st().selection).toEqual([id]);
    expect(page().items[id]).toMatchObject({ kind: 'circle', w: 120, h: 120 });
    st().undo();
    expect(page().items[id]).toBeUndefined();
  });

  it('deleting the element being placed puts the tool back to Select', () => {
    load();
    const t = st().doc.templates!.nodes[0];
    st().setPlacing({ kind: 'template', id: t.id });
    st().deleteTemplate(t.id);
    expect(st()).toMatchObject({ tool: 'select', placing: null });
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

const DEVICES = [
  'hostName,hostIP,hostPlatform,neighborName,neighborIP,neighborPlatform',
  'core1,10.0.0.1,Nexus 9300,dist1,10.0.1.1,C9500-24Y4C',
  'core2,10.0.0.2,Nexus 9300,dist1,10.0.1.1,C9500-24Y4C',
  'dist1,10.0.1.1,C9500-24Y4C,mx1,10.0.9.1,Juniper MX204',
].join('\n');
const PIC_A = 'data:image/png;base64,QUFB';
const PIC_B = 'data:image/png;base64,QkJC';

describe('device pictures and platform rules', () => {
  const device = (name: string) =>
    page()
      .order.map((id) => page().items[id])
      .find((it): it is Shape => it.type === 'shape' && it.data?.hostName === name)!;
  const elementOf = (name: string) => st().doc.templates!.nodes.find((t) => t.id === device(name).templateId)?.name;
  const assetOf = (templateId: string) => st().doc.templates!.nodes.find((t) => t.id === templateId)!.image!.asset;

  /** A new doc with two uploaded elements: "Nexus 9300" (rule 9300) and "Catalyst 9500" (rule 9500). */
  function withUploads() {
    load();
    const n93 = st().addDeviceTemplate('Nexus 9300', PIC_A, 400, 200);
    st().updateTemplate(n93, { platforms: ['9300'] });
    const c95 = st().addDeviceTemplate('Catalyst 9500', PIC_B, 120, 120);
    st().updateTemplate(c95, { platforms: ['9500'] });
    return { n93, c95 };
  }

  it('new documents start with the built-in elements and pictures, Generic device as default', () => {
    load();
    const t = st().doc.templates!;
    expect(t.nodes.map((n) => n.name)).toEqual(BUILT_INS);
    expect(t.defaultNodeId).toBe(nodeId('Generic device'));
    for (const n of t.nodes) expect(st().doc.assets?.[n.image!.asset]).toMatch(/^data:image\/svg\+xml,/);
  });

  it('an uploaded picture becomes an element sized to fit, with the device fields beside it', () => {
    const { n93 } = withUploads();
    const t = st().doc.templates!.nodes.find((n) => n.id === n93)!;
    expect(t).toMatchObject({ kind: 'image', w: 96, h: 48, textPosition: 'right', text: '{hostName}\n{hostIP}\n{hostPlatform}', platforms: ['9300'] });
    expect(st().doc.assets![t.image!.asset]).toBe(PIC_A);
  });

  it('imports give each device the element its platform matches best, others the default', () => {
    withUploads();
    const s = st().importLinks(DEVICES);
    expect(elementOf('core1')).toBe('Nexus 9300');
    expect(elementOf('core2')).toBe('Nexus 9300');
    expect(elementOf('dist1')).toBe('Catalyst 9500');
    expect(elementOf('mx1')).toBe('Generic device');
    expect(s.byTemplate).toEqual([
      { name: 'Nexus 9300', count: 2 },
      { name: 'Catalyst 9500', count: 1 },
      { name: 'Generic device', count: 1 },
    ]);
    expect(device('core1')).toMatchObject({ kind: 'image', textPosition: 'right', w: 96, h: 48, text: 'core1\n10.0.0.1\nNexus 9300' });
  });

  it('stores each picture once, however many devices show it', () => {
    withUploads();
    st().importLinks(DEVICES);
    expect(device('core1').image).toEqual(device('core2').image);
    expect(device('core1').image!.src).toBeUndefined();
    expect(JSON.stringify(st().doc).split(PIC_A).length - 1).toBe(1);
  });

  it('the import dialog choice for unmatched devices becomes the default', () => {
    withUploads();
    st().importLinks(DEVICES, { nodeTemplateId: nodeId('Router') });
    expect(elementOf('mx1')).toBe('Router');
    expect(st().doc.templates!.defaultNodeId).toBe(nodeId('Router'));
  });

  it('rule changes apply at once to devices already drawn, as one undo step each', () => {
    const { n93, c95 } = withUploads();
    st().importLinks(DEVICES);
    st().updateTemplate(c95, { platforms: [] });
    expect(elementOf('dist1')).toBe('Switch'); // the built-in "c9" rule
    st().updateTemplate(n93, { platforms: ['mx204'] });
    expect(elementOf('core1')).toBe('Switch'); // "nexus"
    expect(elementOf('mx1')).toBe('Nexus 9300');
    expect(device('mx1').image).toEqual({ asset: assetOf(n93) });
    st().undo();
    expect(elementOf('core1')).toBe('Nexus 9300');
    expect(elementOf('mx1')).toBe('Generic device');
    expect(elementOf('dist1')).toBe('Switch');
  });

  it('changing the default element moves the unmatched devices', () => {
    withUploads();
    st().importLinks(DEVICES);
    st().setDefaultNodeTemplate(nodeId('Cloud'));
    expect(elementOf('mx1')).toBe('Cloud');
    expect(elementOf('core1')).toBe('Nexus 9300');
  });

  it("editing a device's platform switches its element", () => {
    withUploads();
    st().importLinks(DEVICES);
    st().setItemData(device('mx1').id, 'hostPlatform', 'ISR4451-X/K9');
    expect(elementOf('mx1')).toBe('Router');
    expect(device('mx1').text).toBe('mx1\n10.0.9.1\nISR4451-X/K9');
  });

  it('leaves unlinked devices alone, and documents without rules', () => {
    const { n93 } = withUploads();
    st().importLinks(DEVICES);
    const core1 = device('core1');
    st().unlinkTemplate([core1.id]);
    st().updateTemplate(n93, { platforms: [] });
    expect(device('core1')).toEqual({ ...core1, templateId: undefined });
    expect(elementOf('core2')).toBe('Switch');

    // A document whose elements have no rules: nothing moves between elements.
    const doc = emptyDoc();
    const a: NodeTemplate = { id: 'A', name: 'A', kind: 'rect', w: 100, h: 50, style: { ...DEFAULT_SHAPE_STYLE }, text: '{hostName}' };
    const b: NodeTemplate = { ...a, id: 'B', name: 'B', kind: 'ellipse' };
    doc.templates = { nodes: [a, b], lines: [] };
    const node = nodeFromTemplate(b, { hostName: 'x', hostPlatform: 'C9300' }, { x: 0, y: 0 });
    addItems(doc.pages[0], [node]);
    st().loadDoc(doc);
    st().setDefaultNodeTemplate('A');
    st().setItemData(node.id, 'hostPlatform', 'C9400');
    expect(page().items[node.id]).toMatchObject({ templateId: 'B', kind: 'ellipse' });
  });

  it('changing or removing an element picture restyles its devices and drops unused pictures', () => {
    const { n93, c95 } = withUploads();
    st().importLinks(DEVICES);
    st().setTemplatePicture(n93, PIC_B, 50, 100);
    const asset = assetOf(n93);
    expect(device('core1').image).toEqual({ asset });
    expect(st().doc.assets![asset]).toBe(PIC_B);
    expect(device('core1')).toMatchObject({ w: 48, h: 96 });
    expect(JSON.stringify(st().doc)).not.toContain(PIC_A);
    st().removeTemplatePicture(n93);
    expect(device('core1')).toMatchObject({ kind: 'roundRect', textPosition: 'right', w: 72, h: 48 });
    expect(device('core1').image).toBeUndefined();
    expect(st().doc.assets![asset]).toBeUndefined();
    // Deleting an unused element drops its picture too…
    const spare = st().addDeviceTemplate('Spare', PIC_A, 10, 10);
    st().deleteTemplate(spare);
    expect(JSON.stringify(st().doc)).not.toContain(PIC_A);
    // …but a picture still shown by a device stays.
    const kept = assetOf(c95);
    st().deleteTemplate(c95);
    expect(device('dist1').image).toEqual({ asset: kept });
    expect(st().doc.assets![kept]).toBe(PIC_B);
  });

  it('adds missing built-in devices to an older document in one undo step, keeping its default', () => {
    const doc = emptyDoc();
    const box: NodeTemplate = { id: 'dev', name: 'Device', kind: 'roundRect', w: 160, h: 64, style: { ...DEFAULT_SHAPE_STYLE }, text: '{hostName}' };
    doc.templates = { nodes: [box], lines: [] };
    doc.assets = undefined;
    const sw = nodeFromTemplate(box, { hostName: 'sw', hostPlatform: 'C9300-48P' }, { x: 0, y: 0 });
    const other = nodeFromTemplate(box, { hostName: 'mx', hostPlatform: 'Juniper MX204' }, { x: 300, y: 0 });
    addItems(doc.pages[0], [sw, other]);
    st().loadDoc(doc);
    const before = st().history.past.length;
    st().addBuiltInDevices();
    expect(st().history.past.length).toBe(before + 1);
    expect(st().doc.templates!.nodes.map((t) => t.name)).toEqual(['Device', ...BUILT_INS]);
    expect(st().doc.templates!.defaultNodeId).toBe('dev');
    expect(page().items[sw.id]).toMatchObject({ kind: 'image', templateId: nodeId('Switch') });
    expect(page().items[other.id]).toMatchObject({ kind: 'roundRect', templateId: 'dev' });
    // Already complete: nothing to add, no undo step.
    st().addBuiltInDevices();
    expect(st().history.past.length).toBe(before + 1);
    st().undo();
    expect(st().doc.templates!.nodes.map((t) => t.name)).toEqual(['Device']);
    expect(page().items[sw.id]).toMatchObject({ kind: 'roundRect', templateId: 'dev' });
  });

  /** An older document: a "Device" box element as the (implicit) default, built-ins added later. */
  function olderDoc(withBuiltIns: boolean) {
    const doc = emptyDoc();
    const box: NodeTemplate = { id: 'dev', name: 'Device', kind: 'roundRect', w: 160, h: 64, style: { ...DEFAULT_SHAPE_STYLE }, text: '{hostName}' };
    doc.templates = { nodes: [box], lines: [...doc.templates!.lines] };
    doc.assets = undefined;
    st().loadDoc(doc);
    if (withBuiltIns) st().addBuiltInDevices();
  }
  /** Types `text` into a device's field one character at a time, like the Data panel does. */
  const typeInto = (id: string, key: string, text: string, seen: string[]) => {
    for (let i = 1; i <= text.length; i++) {
      st().setItemData(id, key, text.slice(0, i), `data:${id}:${key}`);
      seen.push((page().items[id] as Shape).kind);
    }
  };

  it('typing a platform into a picture device never turns it into the default element', () => {
    olderDoc(true);
    const mine = st().addDeviceTemplate('My switch', PIC_A, 100, 50);
    const plain = st().addDeviceTemplate('Lab box', PIC_B, 100, 50);
    st().updateTemplate(mine, { platforms: ['9300'] });
    const a = st().addFromTemplate(mine, { x: 0, y: 0 })!;
    const b = st().addFromTemplate(plain, { x: 300, y: 0 })!;
    const seen: string[] = [];
    typeInto(a, 'hostName', 'sw-lab-1', seen);
    typeInto(a, 'hostPlatform', 'prototype', seen);
    typeInto(b, 'hostPlatform', 'xyz-1000', seen);
    // Nothing matched: both keep their own pictures, never the "Device" box.
    expect(seen.every((k) => k === 'image')).toBe(true);
    expect(page().items[a]).toMatchObject({ templateId: mine, kind: 'image' });
    expect(page().items[b]).toMatchObject({ templateId: plain, kind: 'image' });
    // A platform that does match a rule still switches (your own element beating the built-in Switch).
    st().setItemData(a, 'hostPlatform', '');
    typeInto(a, 'hostPlatform', 'C9300-48P', seen);
    expect(page().items[a]).toMatchObject({ templateId: mine, kind: 'image' });
    expect(seen.every((k) => k === 'image')).toBe(true);
  });

  it('a rule change moves the devices its old rule matched, not ones placed by hand', () => {
    olderDoc(false);
    const n93 = st().addDeviceTemplate('Nexus 9300', PIC_A, 100, 50);
    st().updateTemplate(n93, { platforms: ['9300'] });
    st().importLinks(DEVICES);
    expect(elementOf('core1')).toBe('Nexus 9300');
    expect(elementOf('dist1')).toBe('Device');
    const manual = st().addFromTemplate(n93, { x: 0, y: 600 })!;
    st().setItemData(manual, 'hostName', 'lab1');
    st().setItemData(manual, 'hostPlatform', 'prototype');
    expect(page().items[manual]).toMatchObject({ templateId: n93, kind: 'image' });
    // Adding a rule to the element doesn't throw the hand-placed device out.
    st().updateTemplate(n93, { platforms: ['9300', 'N93'] });
    expect(page().items[manual]).toMatchObject({ templateId: n93, kind: 'image' });
    // Changing the rule: the cores no longer match it and go back to the default; dist1 matches now.
    st().updateTemplate(n93, { platforms: ['9500'] });
    expect(elementOf('core1')).toBe('Device');
    expect(elementOf('dist1')).toBe('Nexus 9300');
    expect(page().items[manual]).toMatchObject({ templateId: n93, kind: 'image' });
  });

  it('changing the default moves only the devices that had the old default', () => {
    const { n93 } = withUploads();
    st().importLinks(DEVICES);
    const manual = st().addFromTemplate(n93, { x: 0, y: 600 })!;
    st().setItemData(manual, 'hostPlatform', 'prototype');
    st().setDefaultNodeTemplate(nodeId('Cloud'));
    expect(elementOf('mx1')).toBe('Cloud');
    expect(page().items[manual]).toMatchObject({ templateId: n93 });
  });

  it('unlinked pictures with text beside them can be text-edited', () => {
    load();
    const id = st().addFromTemplate(nodeId('Router'), { x: 0, y: 0 })!;
    st().setEditing(id);
    expect(st().editingId).toBeNull();
    st().unlinkTemplate([id]);
    st().setEditing(id);
    expect(st().editingId).toBe(id);
    st().commitText(id, 'edge\n10.1.1.1');
    expect(page().items[id]).toMatchObject({ kind: 'image', text: 'edge\n10.1.1.1', w: 56, h: 56 });
  });
});
