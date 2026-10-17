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
  | 'text'
  | 'image'
  | 'component';

export interface ShapeStyle {
  fill: string;
  stroke: string;
  strokeWidth: number;
  textColor: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  /** 0–1, fades only the fill; missing means 1. */
  fillOpacity?: number;
  /** 0–1, fades the whole shape (fill, border, text, image); missing means 1. */
  opacity?: number;
}

export interface Shape extends Rect {
  id: string;
  type: 'shape';
  kind: ShapeKind;
  text: string;
  style: ShapeStyle;
  /** Image data URL, for kind `image`. */
  src?: string;
  /** For kind `component`: key into `Doc.components`. */
  componentId?: string;
  /** Data record (e.g. an imported network node); fills `{{field}}` placeholders in component text. */
  data?: Record<string, string>;
  /** Groups this item belongs to, innermost first (see `model/groups.ts`). */
  groups?: string[];
}

/**
 * A connector end. When `shapeId` is set the end is attached to that shape:
 * to a fixed port if `port` is set; with `perimeter`, where the line from the shape's center
 * toward the other end crosses its edge (used by graph import, so links fan out around a
 * node); otherwise to whichever port faces the other end.
 * `x`/`y` is the position used when the end is free.
 */
export interface Endpoint {
  shapeId?: string;
  port?: number;
  perimeter?: boolean;
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
  /** 0–1, fades the whole line with its arrowheads and labels; missing means 1. */
  opacity?: number;
}

export interface Connector {
  id: string;
  type: 'connector';
  source: Endpoint;
  target: Endpoint;
  routing: Routing;
  label: string;
  style: ConnectorStyle;
  /** Small labels drawn next to each end (e.g. the interface on that side of a link). */
  sourceLabel?: string;
  targetLabel?: string;
  data?: Record<string, string>;
  /** Groups this item belongs to, innermost first (see `model/groups.ts`). */
  groups?: string[];
}

export type Item = Shape | Connector;

/** Matches a record when `record[field]` equals one of `values` (trimmed, case-insensitive). */
export interface Rule {
  field: string;
  values: string[];
}

/** One element of a component, in the component's local coordinates. Text may hold `{{field}}`. */
export type Part = Omit<Shape, 'id' | 'type' | 'componentId' | 'data' | 'groups'>;

/** A reusable node made of parts. `rule: null` marks the catch-all default of its template. */
export interface NodeComponent {
  id: string;
  name: string;
  rule: Rule | null;
  w: number;
  h: number;
  parts: Part[];
}

export interface Doc {
  version: 1;
  title: string;
  items: Record<string, Item>;
  /** Z-order, back to front. */
  order: string[];
  /** Definitions used by `component` shapes in this doc, copied in when placed. */
  components?: Record<string, NodeComponent>;
}
