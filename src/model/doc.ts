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
  ShapeStyle,
  Templates,
} from './types';
import { makePage } from './page';

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

/**
 * The node and line templates every new document starts with (shown under Graphs in the
 * shape panel). Their placeholders are the links CSV's column names.
 */
export function defaultTemplates(): Templates {
  return {
    nodes: [
      {
        id: nanoid(10),
        name: 'Device',
        kind: 'roundRect',
        w: 160,
        h: 64,
        style: { ...DEFAULT_SHAPE_STYLE, fill: '#eef4ff', stroke: '#3b5b9a', fontSize: 13 },
        text: '{hostName}\n{hostIP}\n{hostPlatform}',
      },
    ],
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
  };
}

export const emptyDoc = (): Doc => ({
  version: 2,
  title: 'Untitled diagram',
  pages: [makePage()],
  templates: defaultTemplates(),
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
