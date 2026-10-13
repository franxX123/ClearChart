import { docBounds } from '../canvas/geometry';
import { rectCenter, rotationOf, SIDE_GAP, sideLabelBox } from '../canvas/transform';
import { END_LABEL_SIZE, endLabels, LABEL_SIZE, type PlacedLabel } from '../connectors/labels';
import { connectorPoints, endLabelStacks, routeObstacles } from '../connectors/routing';
import { isConnector, isShape } from '../model/doc';
import { renderOrder } from '../model/page';
import type { ArrowHead, Connector, Doc, Page, Point, Shape } from '../model/types';
import { SHAPES } from '../shapes/library';
import { flattenPath } from './svgPath';
import { zip, type ZipEntry } from './zip';

// Writes a document as a Visio .vsdx: one Visio page per page, each shape a Visio shape with
// its geometry, colors, text and fields (as Shape Data), each line a routable connector glued
// to its shapes, and pictures as embedded images. Hidden layers are left out. Pure: pictures
// are decoded beforehand (see `exportVisio` in export.ts) and passed in.

/**
 * A picture's bytes for a `kind: 'image'` shape, passed by shape id. Shapes showing the same
 * picture should share one object: it's then stored once in the file.
 */
export interface VsdxImage {
  bytes: Uint8Array;
  ext: 'png' | 'jpeg' | 'gif';
}

const PX_PER_IN = 96;
/** Margin around the drawing on each Visio page, in px. */
const PAGE_PAD = 40;
const NS = 'http://schemas.microsoft.com/office/visio/2012/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL_VISIO = 'http://schemas.microsoft.com/visio/2010/relationships';
const REL_OFFICE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const MIME: Record<VsdxImage['ext'], string> = { png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif' };

const esc = (s: string) =>
  s
    // Characters XML 1.0 can't carry at all.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** A number for a cell value: finite, at most 6 decimals, no "-0". */
const num = (v: number) => (Number.isFinite(v) ? String(+v.toFixed(6) || 0) : '0');

function cell(name: string, value: number | string, formula?: string, unit?: string): string {
  const v = typeof value === 'number' ? num(value) : esc(value);
  return `<Cell N="${name}" V="${v}"${unit ? ` U="${unit}"` : ''}${formula ? ` F="${esc(formula)}"` : ''}/>`;
}

/** A CSS hex color as Visio wants it (#RRGGBB); anything else (e.g. "none") falls back. */
function color(c: string, fallback = '#000000'): string {
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(c);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toUpperCase();
  return /^#[0-9a-f]{6}$/i.test(c) ? c.toUpperCase() : fallback;
}

const transparency = (opacity: number | undefined) => 1 - Math.min(1, Math.max(0, opacity ?? 1));
const DASH = { solid: 1, dashed: 2, dotted: 3 } as const;
/** Visio arrowhead styles: 4 = filled triangle, 1 = open "V". */
const ARROW: Record<ArrowHead, number> = { none: 0, arrow: 4, open: 1 };

/** Maps ClearChart world px (y down) to Visio page inches (y up) for one page. */
interface PageFrame {
  width: number;
  height: number;
  pt: (p: Point) => Point;
}

function pageFrame(page: Page): PageFrame {
  const b = docBounds(page);
  if (!b) return { width: 8.5, height: 11, pt: (p) => ({ x: p.x / PX_PER_IN, y: 11 - p.y / PX_PER_IN }) };
  const ox = b.x - PAGE_PAD;
  const oy = b.y - PAGE_PAD;
  const width = (b.w + PAGE_PAD * 2) / PX_PER_IN;
  const height = (b.h + PAGE_PAD * 2) / PX_PER_IN;
  return { width, height, pt: (p) => ({ x: (p.x - ox) / PX_PER_IN, y: height - (p.y - oy) / PX_PER_IN }) };
}

/** Geometry sections for a shape kind at a size: its SVG path as Visio relative-coordinate polylines. */
function geometry(s: Shape): string {
  const w = Math.max(s.w, 1);
  const h = Math.max(s.h, 1);
  return flattenPath(SHAPES[s.kind].path(w, h))
    .map((sp, ix) => {
      const pts = [...sp.points];
      const first = pts[0];
      const last = pts[pts.length - 1];
      if (sp.closed && (first.x !== last.x || first.y !== last.y)) pts.push(first);
      // Relative rows (fractions of width/height) keep the outline right when resized in Visio.
      const rows = pts
        .map(
          (p, i) =>
            `<Row T="${i ? 'RelLineTo' : 'RelMoveTo'}" IX="${i + 1}">${cell('X', p.x / w)}${cell('Y', 1 - p.y / h)}</Row>`,
        )
        .join('');
      return `<Section N="Geometry" IX="${ix}">${cell('NoFill', sp.closed ? 0 : 1)}${cell('NoLine', 0)}${cell('NoShow', 0)}${cell('NoSnap', 0)}${rows}</Section>`;
    })
    .join('');
}

/** A rectangle covering the whole shape, in relative coordinates; unfilled for outlines. */
function rectOutline(unfilled: boolean, noLine = false): string {
  const rows = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
    [0, 0],
  ]
    .map(([x, y], i) => `<Row T="${i ? 'RelLineTo' : 'RelMoveTo'}" IX="${i + 1}">${cell('X', x)}${cell('Y', y)}</Row>`)
    .join('');
  return `<Section N="Geometry" IX="0">${cell('NoFill', unfilled ? 1 : 0)}${cell('NoLine', noLine ? 1 : 0)}${cell('NoShow', 0)}${cell('NoSnap', 0)}${rows}</Section>`;
}

/** A shape's fields as Visio Shape Data (row names must be simple identifiers). */
function shapeData(data: Record<string, string> | undefined): string {
  const entries = Object.entries(data ?? {});
  if (!entries.length) return '';
  const used = new Set<string>();
  const rows = entries.map(([key, value]) => {
    let name = key.replace(/[^A-Za-z0-9_]/g, '_') || 'Field';
    if (/^[0-9]/.test(name)) name = `F_${name}`;
    while (used.has(name)) name += '_';
    used.add(name);
    return `<Row N="${esc(name)}">${cell('Value', value, undefined, 'STR')}${cell('Label', key)}${cell('Type', 0)}</Row>`;
  });
  return `<Section N="Property">${rows.join('')}</Section>`;
}

function textSections(textColor: string, sizePx: number, opacity: number | undefined, bold = false, italic = false, left = false) {
  const style = (bold ? 1 : 0) | (italic ? 2 : 0);
  return (
    `<Section N="Character"><Row IX="0">${cell('Color', color(textColor))}${cell('ColorTrans', transparency(opacity))}` +
    `${cell('Size', sizePx / PX_PER_IN, undefined, 'PT')}${cell('Style', style)}</Row></Section>` +
    `<Section N="Paragraph"><Row IX="0">${cell('HorzAlign', left ? 0 : 1)}</Row></Section>`
  );
}

function shapeXml(s: Shape, id: number, frame: PageFrame, imageRel: string | undefined): string {
  const st = s.style;
  const w = s.w / PX_PER_IN;
  const h = s.h / PX_PER_IN;
  const c = frame.pt(rectCenter(s));
  const trans = transparency(st.opacity);
  const isImage = s.kind === 'image';
  const noLine = st.stroke === 'none' || st.strokeWidth <= 0;
  const noFill = st.fill === 'none' || isImage;
  // A picture whose bytes we don't have becomes a dashed placeholder box.
  const placeholder = isImage && !imageRel;
  const box = SHAPES[s.kind].textBox(s.w, s.h);
  const side = sideLabelBox(s);
  const fx = (v: number) => num(v / Math.max(s.w, 1));
  const fy = (v: number) => num(v / Math.max(s.h, 1));

  const cells = [
    cell('PinX', c.x),
    cell('PinY', c.y),
    cell('Width', w),
    cell('Height', h),
    cell('LocPinX', w / 2, 'Width*0.5'),
    cell('LocPinY', h / 2, 'Height*0.5'),
    // Visio angles are counterclockwise (y up); ClearChart's are clockwise on screen.
    cell('Angle', (-rotationOf(s) * Math.PI) / 180),
    cell('LineWeight', st.strokeWidth / PX_PER_IN),
    cell('LineColor', color(st.stroke)),
    cell('LinePattern', placeholder ? 2 : noLine ? 0 : 1),
    cell('LineColorTrans', trans),
    cell('FillForegnd', color(st.fill, '#FFFFFF')),
    cell('FillPattern', noFill ? 0 : 1),
    cell('FillForegndTrans', trans),
    ...(side
      ? [
          // Text drawn to the right of the shape: a block pinned by its left edge just past the
          // shape's right edge (so it keeps its gap when resized in Visio), vertically centered,
          // a little wider than the text so Visio's fonts don't wrap it.
          cell('TxtPinX', side.x / PX_PER_IN, `Width+${num(SIDE_GAP / PX_PER_IN)}`),
          cell('TxtPinY', h / 2, 'Height*0.5'),
          cell('TxtWidth', (side.w + 16) / PX_PER_IN),
          cell('TxtHeight', side.h / PX_PER_IN),
          cell('TxtLocPinX', 0, 'TxtWidth*0'),
          cell('TxtLocPinY', side.h / 2 / PX_PER_IN, 'TxtHeight*0.5'),
        ]
      : [
          // The text block follows the kind's text box, as fractions of the shape (so it scales).
          cell('TxtPinX', (box.x + box.w / 2) / PX_PER_IN, `Width*${fx(box.x + box.w / 2)}`),
          cell('TxtPinY', (s.h - box.y - box.h / 2) / PX_PER_IN, `Height*${fy(s.h - box.y - box.h / 2)}`),
          cell('TxtWidth', box.w / PX_PER_IN, `Width*${fx(box.w)}`),
          cell('TxtHeight', box.h / PX_PER_IN, `Height*${fy(box.h)}`),
          cell('TxtLocPinX', box.w / 2 / PX_PER_IN, 'TxtWidth*0.5'),
          cell('TxtLocPinY', box.h / 2 / PX_PER_IN, 'TxtHeight*0.5'),
        ]),
    cell('VerticalAlign', 1),
  ];
  const text = s.text ? `<Text>${esc(s.text)}</Text>` : '';
  const sections = textSections(st.textColor, st.fontSize, st.opacity, st.bold, st.italic, !!side || st.textAlign === 'left');

  if (isImage) {
    if (imageRel) {
      cells.push(
        cell('ImgOffsetX', 0, 'ImgWidth*0'),
        cell('ImgOffsetY', 0, 'ImgHeight*0'),
        cell('ImgWidth', w, 'Width*1'),
        cell('ImgHeight', h, 'Height*1'),
        cell('Transparency', trans),
      );
    }
    // A picture has no outline of its own: its border (or the placeholder box) is an unfilled rectangle.
    const outline = placeholder || !noLine ? rectOutline(true) : '';
    const [rId, compression] = imageRel?.split(':') ?? [];
    const foreign = imageRel ? `<ForeignData ForeignType="Bitmap" CompressionType="${compression}"><Rel r:id="${rId}"/></ForeignData>` : '';
    return (
      `<Shape ID="${id}" NameU="Picture.${id}" Name="Picture" Type="${imageRel ? 'Foreign' : 'Shape'}" LineStyle="0" FillStyle="0" TextStyle="0">` +
      cells.join('') +
      (text ? sections : '') +
      outline +
      shapeData(s.data) +
      text +
      foreign +
      `</Shape>`
    );
  }

  return (
    `<Shape ID="${id}" NameU="${esc(s.kind)}.${id}" Name="${esc(s.kind)}" Type="Shape" LineStyle="0" FillStyle="0" TextStyle="0">` +
    cells.join('') +
    sections +
    shapeData(s.data) +
    geometry(s) +
    text +
    `</Shape>`
  );
}

/** A connector as a routable 1-D shape, glued to its shapes' sheets when it's attached. */
function connectorXml(c: Connector, id: number, pts: Point[], frame: PageFrame, glue: [number?, number?]): string {
  const st = c.style;
  const P = pts.map(frame.pt);
  const b = P[0];
  const e = P[P.length - 1];
  const len = Math.hypot(e.x - b.x, e.y - b.y);
  const angle = len ? Math.atan2(e.y - b.y, e.x - b.x) : 0;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // A 1-D shape's geometry is in its own frame: origin at the begin point, x along begin→end.
  const local = (p: Point) => ({ x: (p.x - b.x) * cos + (p.y - b.y) * sin, y: -(p.x - b.x) * sin + (p.y - b.y) * cos });
  const [from, to] = glue;
  const WALK_BEGIN = '_WALKGLUE(BegTrigger,EndTrigger,WalkPreference)';
  const WALK_END = '_WALKGLUE(EndTrigger,BegTrigger,WalkPreference)';
  const trans = transparency(st.opacity);
  const curved = c.routing === 'curved';

  const cells = [
    cell('ObjType', 2), // routable: Visio re-routes it when its shapes move
    cell('BeginX', b.x, from ? WALK_BEGIN : undefined),
    cell('BeginY', b.y, from ? WALK_BEGIN : undefined),
    cell('EndX', e.x, to ? WALK_END : undefined),
    cell('EndY', e.y, to ? WALK_END : undefined),
    ...(from ? [cell('BegTrigger', 2, `_XFTRIGGER(Sheet.${from}!EventXFMod)`)] : []),
    ...(to ? [cell('EndTrigger', 2, `_XFTRIGGER(Sheet.${to}!EventXFMod)`)] : []),
    cell('PinX', (b.x + e.x) / 2, '(BeginX+EndX)/2'),
    cell('PinY', (b.y + e.y) / 2, '(BeginY+EndY)/2'),
    cell('Width', len, 'SQRT((EndX-BeginX)^2+(EndY-BeginY)^2)'),
    cell('Height', 0),
    cell('LocPinX', len / 2, 'Width*0.5'),
    cell('LocPinY', 0, 'Height*0.5'),
    cell('Angle', angle, 'ATAN2(EndY-BeginY,EndX-BeginX)'),
    // Route style: 1 = right-angle, 2 = straight; line style: 1 = straight, 2 = curved.
    cell('ShapeRouteStyle', c.routing === 'straight' ? 2 : 1),
    cell('ConLineRouteExt', curved ? 2 : 1),
    cell('LineWeight', st.strokeWidth / PX_PER_IN),
    cell('LineColor', color(st.stroke)),
    cell('LinePattern', DASH[st.dash] ?? 1),
    cell('LineColorTrans', trans),
    cell('BeginArrow', ARROW[st.startArrow] ?? 0),
    cell('EndArrow', ARROW[st.endArrow] ?? 0),
    cell('BeginArrowSize', 2),
    cell('EndArrowSize', 2),
    cell('FillPattern', 0),
    cell('TxtPinX', len / 2, 'Width*0.5'),
    cell('TxtPinY', 0, 'Height*0.5'),
    ...(c.label ? [cell('TextBkgnd', '#FFFFFF')] : []),
  ];
  const rows = P.map((p, i) => {
    const q = local(p);
    return `<Row T="${i ? 'LineTo' : 'MoveTo'}" IX="${i + 1}">${cell('X', q.x)}${cell('Y', q.y)}</Row>`;
  }).join('');
  const geom = `<Section N="Geometry" IX="0">${cell('NoFill', 1)}${cell('NoLine', 0)}${cell('NoShow', 0)}${cell('NoSnap', 0)}${rows}</Section>`;
  return (
    `<Shape ID="${id}" NameU="Dynamic connector.${id}" Name="Dynamic connector" Type="Shape" LineStyle="0" FillStyle="0" TextStyle="0">` +
    cells.join('') +
    textSections(st.stroke, LABEL_SIZE, st.opacity) +
    shapeData(c.data) +
    geom +
    (c.label ? `<Text>${esc(c.label)}</Text>` : '') +
    `</Shape>`
  );
}

/** An end label (e.g. an interface name) as a small text box on a white patch. */
function labelXml(label: PlacedLabel, id: number, frame: PageFrame, textColor: string, opacity: number | undefined): string {
  const c = frame.pt(label.at);
  const w = label.w / PX_PER_IN;
  const h = label.h / PX_PER_IN;
  const trans = transparency(opacity);
  return (
    `<Shape ID="${id}" NameU="Label.${id}" Name="Label" Type="Shape" LineStyle="0" FillStyle="0" TextStyle="0">` +
    [
      cell('PinX', c.x),
      cell('PinY', c.y),
      cell('Width', w),
      cell('Height', h),
      cell('LocPinX', w / 2, 'Width*0.5'),
      cell('LocPinY', h / 2, 'Height*0.5'),
      cell('LinePattern', 0),
      cell('FillForegnd', '#FFFFFF'),
      cell('FillPattern', 1),
      cell('FillForegndTrans', trans),
      cell('VerticalAlign', 1),
    ].join('') +
    textSections(textColor, END_LABEL_SIZE, opacity) +
    rectOutline(false, true) +
    `<Text>${esc(label.text)}</Text></Shape>`
  );
}

interface BuiltPage {
  xml: string;
  rels: string | null;
  frame: PageFrame;
}

/**
 * `mediaName` gives a picture's file name in the package (the same name for the same picture
 * object, so it's stored once); each page relates to each picture it uses once.
 */
function buildPage(page: Page, images: Map<string, VsdxImage>, mediaName: (image: VsdxImage) => string): BuiltPage {
  const frame = pageFrame(page);
  const order = renderOrder(page);
  // Sheet ids for every exported item first, so lines can refer to shapes drawn after them.
  const sheet = new Map<string, number>();
  let next = 1;
  for (const id of order) sheet.set(id, next++);
  const obstacles = routeObstacles(page);
  const shapes: string[] = [];
  const connects: string[] = [];
  const rels: string[] = [];
  const relOf = new Map<VsdxImage, string>();

  for (const id of order) {
    const it = page.items[id];
    const sid = sheet.get(id)!;
    if (isShape(it)) {
      let imageRel: string | undefined;
      const image = it.kind === 'image' ? images.get(it.id) : undefined;
      if (image) {
        let rId = relOf.get(image);
        if (!rId) {
          rId = `rId${rels.length + 1}`;
          rels.push(`<Relationship Id="${rId}" Type="${REL_OFFICE}/image" Target="../media/${mediaName(image)}"/>`);
          relOf.set(image, rId);
        }
        imageRel = `${rId}:${image.ext.toUpperCase()}`;
      }
      shapes.push(shapeXml(it, sid, frame, imageRel));
    } else if (isConnector(it)) {
      const pts = connectorPoints(page, it, obstacles);
      if (pts.length < 2) continue;
      const from = it.source.shapeId ? sheet.get(it.source.shapeId) : undefined;
      const to = it.target.shapeId ? sheet.get(it.target.shapeId) : undefined;
      shapes.push(connectorXml(it, sid, pts, frame, [from, to]));
      if (from) connects.push(`<Connect FromSheet="${sid}" FromCell="BeginX" FromPart="9" ToSheet="${from}" ToCell="PinX" ToPart="3"/>`);
      if (to) connects.push(`<Connect FromSheet="${sid}" FromCell="EndX" FromPart="12" ToSheet="${to}" ToCell="PinX" ToPart="3"/>`);
      // Visio connectors carry one text; start/end labels become small text boxes beside them.
      for (const label of endLabels(it, pts, endLabelStacks(page, it))) {
        shapes.push(labelXml(label, next++, frame, it.style.stroke, it.style.opacity));
      }
    }
  }

  const xml =
    XML_HEAD +
    `<PageContents xmlns="${NS}" xmlns:r="${NS_R}" xml:space="preserve">` +
    (shapes.length ? `<Shapes>${shapes.join('')}</Shapes>` : '') +
    (connects.length ? `<Connects>${connects.join('')}</Connects>` : '') +
    `</PageContents>`;
  const relsXml = rels.length
    ? `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`
    : null;
  return { xml, rels: relsXml, frame };
}

const STYLE_SHEET =
  '<StyleSheets><StyleSheet ID="0" NameU="No Style" Name="No Style">' +
  [
    cell('EnableLineProps', 1),
    cell('EnableFillProps', 1),
    cell('EnableTextProps', 1),
    cell('HideForApply', 0),
    cell('LineWeight', 1 / PX_PER_IN),
    cell('LineColor', '#000000'),
    cell('LinePattern', 1),
    cell('Rounding', 0),
    cell('LineCap', 0),
    cell('BeginArrow', 0),
    cell('EndArrow', 0),
    cell('BeginArrowSize', 2),
    cell('EndArrowSize', 2),
    cell('LineColorTrans', 0),
    cell('FillForegnd', '#FFFFFF'),
    cell('FillBkgnd', '#FFFFFF'),
    cell('FillPattern', 1),
    cell('FillForegndTrans', 0),
    cell('FillBkgndTrans', 0),
    cell('ShdwForegnd', '#000000'),
    cell('ShdwPattern', 0),
    cell('LeftMargin', 0),
    cell('RightMargin', 0),
    cell('TopMargin', 0),
    cell('BottomMargin', 0),
    cell('VerticalAlign', 1),
    cell('TextBkgnd', 0),
    cell('TextBkgndTrans', 0),
    cell('TextDirection', 0),
  ].join('') +
  `<Section N="Character"><Row IX="0">${cell('Color', '#000000')}${cell('Style', 0)}${cell('Size', 14 / PX_PER_IN, undefined, 'PT')}${cell('ColorTrans', 0)}</Row></Section>` +
  `<Section N="Paragraph"><Row IX="0">${cell('HorzAlign', 1)}${cell('SpLine', -1.2)}</Row></Section>` +
  '</StyleSheet></StyleSheets>';

/** Builds the .vsdx package (a ZIP of XML parts) for a document. */
export function buildVsdx(doc: Doc, images: Map<string, VsdxImage> = new Map()): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const text = (name: string, content: string): ZipEntry => ({ name, data: enc.encode(content) });

  // Every picture once, however many shapes (on however many pages) show it.
  const media = new Map<VsdxImage, string>();
  const mediaName = (image: VsdxImage) => {
    let name = media.get(image);
    if (!name) media.set(image, (name = `image${media.size + 1}.${image.ext}`));
    return name;
  };
  const built = doc.pages.map((page) => buildPage(page, images, mediaName));

  // Page names must be unique in Visio.
  const names = new Set<string>();
  const pageNames = doc.pages.map((p, i) => {
    let name = p.name.trim() || `Page-${i + 1}`;
    while (names.has(name)) name += ' (2)';
    names.add(name);
    return name;
  });

  const exts = [...new Set([...media.keys()].map((image) => image.ext))];
  const contentTypes =
    XML_HEAD +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    exts.map((e) => `<Default Extension="${e}" ContentType="${MIME[e]}"/>`).join('') +
    '<Override PartName="/visio/document.xml" ContentType="application/vnd.ms-visio.drawing.main+xml"/>' +
    '<Override PartName="/visio/pages/pages.xml" ContentType="application/vnd.ms-visio.pages+xml"/>' +
    built.map((_, i) => `<Override PartName="/visio/pages/page${i + 1}.xml" ContentType="application/vnd.ms-visio.page+xml"/>`).join('') +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
    '</Types>';

  const rootRels =
    XML_HEAD +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    `<Relationship Id="rId1" Type="${REL_VISIO}/document" Target="visio/document.xml"/>` +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    `<Relationship Id="rId3" Type="${REL_OFFICE}/extended-properties" Target="docProps/app.xml"/>` +
    '</Relationships>';

  const app =
    XML_HEAD +
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">' +
    '<Application>ClearChart</Application></Properties>';
  const core =
    XML_HEAD +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
    'xmlns:dc="http://purl.org/dc/elements/1.1/">' +
    `<dc:title>${esc(doc.title)}</dc:title><dc:creator>ClearChart</dc:creator></cp:coreProperties>`;

  const document =
    XML_HEAD +
    `<VisioDocument xmlns="${NS}" xmlns:r="${NS_R}" xml:space="preserve">` +
    '<DocumentSettings TopPage="0" DefaultTextStyle="0" DefaultLineStyle="0" DefaultFillStyle="0" DefaultGuideStyle="0">' +
    '<GlueSettings>9</GlueSettings><SnapSettings>65847</SnapSettings><SnapExtensions>34</SnapExtensions>' +
    '<DynamicGridEnabled>1</DynamicGridEnabled><ProtectStyles>0</ProtectStyles><ProtectShapes>0</ProtectShapes>' +
    '<ProtectMasters>0</ProtectMasters><ProtectBkgnds>0</ProtectBkgnds></DocumentSettings>' +
    STYLE_SHEET +
    '</VisioDocument>';
  const documentRels =
    XML_HEAD +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    `<Relationship Id="rId1" Type="${REL_VISIO}/pages" Target="pages/pages.xml"/></Relationships>`;

  const pages =
    XML_HEAD +
    `<Pages xmlns="${NS}" xmlns:r="${NS_R}" xml:space="preserve">` +
    built
      .map(
        (p, i) =>
          `<Page ID="${i}" NameU="${esc(pageNames[i])}" Name="${esc(pageNames[i])}" ViewScale="-1" ` +
          `ViewCenterX="${num(p.frame.width / 2)}" ViewCenterY="${num(p.frame.height / 2)}">` +
          '<PageSheet LineStyle="0" FillStyle="0" TextStyle="0">' +
          cell('PageWidth', p.frame.width) +
          cell('PageHeight', p.frame.height) +
          cell('PageScale', 1, undefined, 'IN') +
          cell('DrawingScale', 1, undefined, 'IN') +
          cell('DrawingSizeType', 3) +
          cell('DrawingScaleType', 0) +
          cell('PrintPageOrientation', p.frame.width > p.frame.height ? 2 : 1) +
          `</PageSheet><Rel r:id="rId${i + 1}"/></Page>`,
      )
      .join('') +
    '</Pages>';
  const pagesRels =
    XML_HEAD +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    built.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL_VISIO}/page" Target="page${i + 1}.xml"/>`).join('') +
    '</Relationships>';

  return zip([
    text('[Content_Types].xml', contentTypes),
    text('_rels/.rels', rootRels),
    text('docProps/app.xml', app),
    text('docProps/core.xml', core),
    text('visio/document.xml', document),
    text('visio/_rels/document.xml.rels', documentRels),
    text('visio/pages/pages.xml', pages),
    text('visio/pages/_rels/pages.xml.rels', pagesRels),
    ...built.map((p, i) => text(`visio/pages/page${i + 1}.xml`, p.xml)),
    ...built.flatMap((p, i) => (p.rels ? [text(`visio/pages/_rels/page${i + 1}.xml.rels`, p.rels)] : [])),
    ...[...media].map(([image, name]) => ({ name: `visio/media/${name}`, data: image.bytes })),
  ]);
}

/** Decodes a data: URL into its media type and bytes; null if it isn't one. */
export function decodeDataUrl(src: string): { mime: string; bytes: Uint8Array } | null {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(src);
  if (!m) return null;
  if (!m[2]) return { mime: m[1].toLowerCase(), bytes: new TextEncoder().encode(decodeURIComponent(m[3])) };
  const bin = atob(m[3]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { mime: m[1].toLowerCase(), bytes };
}

/** The picture formats Visio embeds as-is; others (SVG, WebP) must be converted to PNG first. */
export function visioImageExt(mime: string): VsdxImage['ext'] | null {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpeg';
  if (mime === 'image/gif') return 'gif';
  return null;
}
