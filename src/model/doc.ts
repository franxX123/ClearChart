import { nanoid } from 'nanoid';
import type {
  Connector,
  ConnectorStyle,
  Doc,
  Endpoint,
  Item,
  Page,
  Rect,
  Shape,
  ShapeKind,
  NodeTemplate,
  ShapeStyle,
  Templates,
} from './types';
import { makePage } from './page';
import { BUILT_IN_DEVICES, builtInAssetId, builtInAssets, DEFAULT_DEVICE_KEY } from '../shapes/deviceIcons';

export const DEFAULT_SHAPE_STYLE: ShapeStyle = {
  fill: '#ffffff',
  stroke: '#3b4452',
  strokeWidth: 1.5,
  textColor: '#1f2328',
  fontSize: 14,
  bold: false,
  italic: false,
};

export const DEFAULT_CONNECTOR_STYLE: ConnectorStyle = {
  stroke: '#3b4452',
  strokeWidth: 1.5,
  dash: 'solid',
  startArrow: 'none',
  endArrow: 'arrow',
};

export const isShape = (i: Item | undefined): i is Shape => i?.type === 'shape';
export const isConnector = (i: Item | undefined): i is Connector => i?.type === 'connector';

/** The picture an image shape shows: its own `src`, or the stored picture (`Doc.assets`) it refers to. */
export const shapeImageSrc = (s: Shape, assets: Doc['assets']): string | undefined =>
  s.image?.src ?? (s.image?.asset ? assets?.[s.image.asset] : undefined);

/** The text beside a device picture: the CSV's device fields. */
export const DEVICE_FIELDS_TEXT = '{hostName}\n{hostIP}\n{hostPlatform}';

/** Display size of a built-in device picture's longer side, in px. */
const DEVICE_ICON_SIZE = 56;

/**
 * The elements every new document starts with (shown under Graphs in the shape panel): one
 * picture element per built-in device icon, with starting platform rules and the device fields
 * to the right of the picture, plus a "Link" line. Generic device is the default element. Their pictures
 * come from `builtInAssets()`, which `emptyDoc` stores alongside.
 */
export function defaultTemplates(): Templates {
  const nodes = BUILT_IN_DEVICES.map(
    (d): NodeTemplate => ({
      id: nanoid(10),
      name: d.name,
      kind: 'image',
      // Each picture keeps its own shape (a switch is flat, a server tall).
      w: Math.round((DEVICE_ICON_SIZE * d.w) / Math.max(d.w, d.h)),
      h: Math.round((DEVICE_ICON_SIZE * d.h) / Math.max(d.w, d.h)),
      style: { ...DEFAULT_SHAPE_STYLE, fill: 'none', stroke: 'none', fontSize: 12 },
      text: DEVICE_FIELDS_TEXT,
      image: { asset: builtInAssetId(d.key) },
      textPosition: 'right',
      platforms: [...d.rules],
      builtIn: true,
    }),
  );
  return {
    nodes,
    lines: [
      {
        id: nanoid(10),
        name: 'Link',
        routing: 'straight',
        style: { ...DEFAULT_CONNECTOR_STYLE, endArrow: 'none' },
        label: '',
        startLabel: '{hostInterface}',
        endLabel: '{neighborInterface}',
      },
    ],
    defaultNodeId: nodes[BUILT_IN_DEVICES.findIndex((d) => d.key === DEFAULT_DEVICE_KEY)].id,
  };
}

export const emptyDoc = (): Doc => ({
  version: 2,
  title: 'Untitled diagram',
  pages: [makePage()],
  templates: defaultTemplates(),
  assets: builtInAssets(),
});

export function makeShape(
  kind: ShapeKind,
  rect: Rect,
  text = '',
  style: Partial<ShapeStyle> = {},
): Shape {
  return {
    id: nanoid(10),
    type: 'shape',
    kind,
    ...rect,
    text,
    style: { ...DEFAULT_SHAPE_STYLE, ...style },
  };
}

export function makeConnector(source: Endpoint, target: Endpoint, label = ''): Connector {
  return {
    id: nanoid(10),
    type: 'connector',
    source,
    target,
    routing: 'elbow',
    label,
    style: { ...DEFAULT_CONNECTOR_STYLE },
  };
}

export function addItems(page: Page, items: Item[]): void {
  for (const it of items) {
    page.items[it.id] = it;
    page.order.push(it.id);
  }
}

/** A small flowchart shown on first launch. */
export function sampleDoc(): Doc {
  const doc = emptyDoc();
  doc.title = 'Sample flowchart';
  const start = makeShape('terminator', { x: 160, y: 40, w: 140, h: 50 }, 'Start', { fill: '#dff3e4' });
  const step = makeShape('rect', { x: 150, y: 140, w: 160, h: 70 }, 'Collect requirements');
  const check = makeShape('diamond', { x: 155, y: 260, w: 150, h: 100 }, 'Approved?', { fill: '#fff4d6' });
  const done = makeShape('terminator', { x: 160, y: 420, w: 140, h: 50 }, 'Ship it', { fill: '#dff3e4' });
  const rework = makeShape('rect', { x: 400, y: 275, w: 140, h: 70 }, 'Revise plan');
  const at = (s: Shape, port: number): Endpoint => ({ shapeId: s.id, port, x: 0, y: 0 });
  addItems(doc.pages[0], [
    start,
    step,
    check,
    done,
    rework,
    makeConnector(at(start, 2), at(step, 0)),
    makeConnector(at(step, 2), at(check, 0)),
    makeConnector(at(check, 2), at(done, 0), 'Yes'),
    makeConnector(at(check, 1), at(rework, 3), 'No'),
    makeConnector(at(rework, 0), at(step, 1)),
  ]);
  return doc;
}
