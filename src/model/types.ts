export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type ShapeKind =
  | 'rect'
  | 'roundRect'
  | 'ellipse'
  | 'diamond'
  | 'triangle'
  | 'hexagon'
  | 'parallelogram'
  | 'cylinder'
  | 'document'
  | 'terminator'
  | 'subprocess'
  | 'note'
  | 'text';

export interface ShapeStyle {
  fill: string;
  stroke: string;
  strokeWidth: number;
  textColor: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
}

export interface Shape extends Rect {
  id: string;
  type: 'shape';
  kind: ShapeKind;
  text: string;
  style: ShapeStyle;
}

/**
 * A connector end. When `shapeId` is set the end is attached to that shape:
 * to a fixed port if `port` is set, otherwise to whichever port faces the other end.
 * `x`/`y` is the position used when the end is free.
 */
export interface Endpoint {
  shapeId?: string;
  port?: number;
  x: number;
  y: number;
}

export type ArrowHead = 'none' | 'arrow' | 'open';
export type LineDash = 'solid' | 'dashed' | 'dotted';
export type Routing = 'straight' | 'elbow';

export interface ConnectorStyle {
  stroke: string;
  strokeWidth: number;
  dash: LineDash;
  startArrow: ArrowHead;
  endArrow: ArrowHead;
}

export interface Connector {
  id: string;
  type: 'connector';
  source: Endpoint;
  target: Endpoint;
  routing: Routing;
  label: string;
  style: ConnectorStyle;
}

export type Item = Shape | Connector;

export interface Doc {
  version: 1;
  title: string;
  items: Record<string, Item>;
  /** Z-order, back to front. */
  order: string[];
}
