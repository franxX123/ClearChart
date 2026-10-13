import { describe, expect, it } from 'vitest';
import { addItems, defaultTemplates, makeConnector, makeShape, sampleDoc } from '../model/doc';
import { makeLayer, makePage } from '../model/page';
import { lineFromTemplate, nodeFromTemplate } from '../model/templates';
import type { Doc } from '../model/types';
import { buildVsdx, decodeDataUrl, visioImageExt } from './vsdx';
import { readZip } from './zip';

const text = (files: Map<string, Uint8Array>, name: string) => new TextDecoder().decode(files.get(name));

/** Well-formedness check: every tag closes in order (enough to catch broken generated XML). */
function assertWellFormed(xml: string, name: string) {
  const stack: string[] = [];
  for (const m of xml.matchAll(/<(\/?)([A-Za-z_][\w:.-]*)([^>]*?)(\/?)>/g)) {
    const [, closing, tag, , selfClosing] = m;
    if (selfClosing) continue;
    if (closing) expect(stack.pop(), `${name}: </${tag}>`).toBe(tag);
    else stack.push(tag);
  }
  expect(stack, `${name}: unclosed`).toEqual([]);
  // No raw "<" or "&" left inside attribute values or text.
  expect(/&(?!amp;|lt;|gt;|quot;|apos;|#)/.test(xml), `${name}: unescaped &`).toBe(false);
}

/** A tiny 1×1 PNG. */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function networkDoc(): Doc {
  const doc = sampleDoc();
  const t = defaultTemplates();
  const page = makePage('Network & <core>');
  const a = nodeFromTemplate(t.nodes[0], { hostName: 'core1', hostIP: '10.0.0.1' }, { x: 100, y: 100 });
  const b = nodeFromTemplate(t.nodes[0], { hostName: 'dist1' }, { x: 400, y: 300 });
  b.style.opacity = 0.5;
  b.rotation = 30;
  const link = lineFromTemplate(t.lines[0], { hostInterface: 'Eth1/1', neighborInterface: 'Te1/1/1' }, { shapeId: a.id, x: 0, y: 0 }, { shapeId: b.id, x: 0, y: 0 });
  const free = makeConnector({ x: 0, y: 500 }, { x: 200, y: 500 }, 'free & "quoted"');
  free.routing = 'curved';
  free.bend = 30;
  const pic = makeShape('image', { x: 600, y: 100, w: 80, h: 60 });
  pic.image = { src: PNG };
  const hiddenLayer = makeLayer('Hidden');
  hiddenLayer.visible = false;
  page.layers.push(hiddenLayer);
  const hidden = makeShape('rect', { x: 0, y: 0, w: 10, h: 10 }, 'secret');
  hidden.layerId = hiddenLayer.id;
  addItems(page, [a, b, link, free, pic, hidden]);
  doc.pages.push(page);
  return doc;
}

describe('buildVsdx', () => {
  it('writes a complete package whose parts are well-formed and all referenced', () => {
    const doc = networkDoc();
    const png = decodeDataUrl(PNG)!;
    const pic = Object.values(doc.pages[1].items).find((it) => it.type === 'shape' && it.kind === 'image')!;
    const files = readZip(buildVsdx(doc, new Map([[pic.id, { bytes: png.bytes, ext: 'png' as const }]])));
    expect([...files.keys()]).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'docProps/app.xml',
      'docProps/core.xml',
      'visio/document.xml',
      'visio/_rels/document.xml.rels',
      'visio/pages/pages.xml',
      'visio/pages/_rels/pages.xml.rels',
      'visio/pages/page1.xml',
      'visio/pages/page2.xml',
      'visio/pages/_rels/page2.xml.rels',
      'visio/media/image1.png',
    ]);
    for (const [name, data] of files) if (!name.endsWith('.png')) assertWellFormed(new TextDecoder().decode(data), name);
    // Every page part has a content type, and every relationship target exists.
    const types = text(files, '[Content_Types].xml');
    expect(types).toContain('PartName="/visio/pages/page2.xml"');
    expect(types).toContain('Extension="png"');
    expect(text(files, 'visio/pages/_rels/page2.xml.rels')).toContain('Target="../media/image1.png"');
    expect(files.get('visio/media/image1.png')).toEqual(png.bytes);
    // Page names are escaped.
    expect(text(files, 'visio/pages/pages.xml')).toContain('Name="Network &amp; &lt;core&gt;"');
  });

  it('writes shapes with geometry, text, data, opacity and rotation; lines glued to them', () => {
    const files = readZip(buildVsdx(networkDoc()));
    const page = text(files, 'visio/pages/page2.xml');
    // Two devices, two lines, the picture placeholder and two end labels; the hidden shape is left out.
    expect(page.match(/<Shape /g)).toHaveLength(7);
    expect(page).not.toContain('secret');
    expect(page).toContain('<Text>core1\n10.0.0.1</Text>');
    expect(page).toContain('<Row N="hostName"><Cell N="Value" V="core1" U="STR"/><Cell N="Label" V="hostName"/>');
    expect(page).toContain('<Cell N="FillForegndTrans" V="0.5"/>');
    expect(page).toContain(`<Cell N="Angle" V="${+(-Math.PI / 6).toFixed(6)}"/>`);
    expect(page).toContain('<Section N="Geometry" IX="0">');
    // The device link: glued at both ends to sheets 1 and 2, with the interface names as labels.
    expect(page).toContain('<Connect FromSheet="3" FromCell="BeginX" FromPart="9" ToSheet="1" ToCell="PinX" ToPart="3"/>');
    expect(page).toContain('<Connect FromSheet="3" FromCell="EndX" FromPart="12" ToSheet="2" ToCell="PinX" ToPart="3"/>');
    expect(page).toContain('F="_XFTRIGGER(Sheet.1!EventXFMod)"');
    expect(page).toContain('<Text>Eth1/1</Text>');
    expect(page).toContain('<Text>Te1/1/1</Text>');
    // The free curved line: not glued, curved style, label escaped.
    expect(page).toContain('<Cell N="ConLineRouteExt" V="2"/>');
    expect(page).toContain('<Text>free &amp; &quot;quoted&quot;</Text>');
    // Without picture bytes, the picture becomes a dashed placeholder (one LinePattern cell only).
    const picture = page.slice(page.indexOf('NameU="Picture.'));
    expect(picture.slice(0, picture.indexOf('</Shape>')).match(/N="LinePattern"/g)).toHaveLength(1);
  });

  it('gives an empty page a letter-size sheet', () => {
    const doc = sampleDoc();
    doc.pages[0] = makePage();
    const pages = text(readZip(buildVsdx(doc)), 'visio/pages/pages.xml');
    expect(pages).toContain('<Cell N="PageWidth" V="8.5"/><Cell N="PageHeight" V="11"/>');
  });
});

describe('picture helpers', () => {
  it('decodes base64 and plain data URLs', () => {
    const png = decodeDataUrl(PNG)!;
    expect(png.mime).toBe('image/png');
    expect([...png.bytes.slice(1, 4)].map((c) => String.fromCharCode(c)).join('')).toBe('PNG');
    expect(new TextDecoder().decode(decodeDataUrl('data:image/svg+xml,%3Csvg%2F%3E')!.bytes)).toBe('<svg/>');
    expect(decodeDataUrl('https://example.com/x.png')).toBeNull();
  });

  it('knows which formats Visio embeds directly', () => {
    expect(visioImageExt('image/jpeg')).toBe('jpeg');
    expect(visioImageExt('image/svg+xml')).toBeNull();
    expect(visioImageExt('image/webp')).toBeNull();
  });
});
