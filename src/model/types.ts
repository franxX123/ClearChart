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
  | 'image';

export interface ShapeStyle {
  fill: string;
  stroke: string;
  strokeWidth: number;
  textColor: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  /** Horizontal text alignment. Absent means centered. */
  textAlign?: 'left' | 'center';
  /** 0–1, fading the whole shape (fill, border, text, picture). Absent means 1 (opaque). */
  opacity?: number;
}

/** Fields every item on a page has. */
export interface ItemBase {
  id: string;
  /** Layer the item lives on. Missing or unknown ids resolve to the page's bottom layer. */
  layerId?: string;
  /** Groups the item belongs to, outermost first. Absent when ungrouped. */
  groupIds?: string[];
  /** Named fields (e.g. a device's name, ip, platform), filled into its template's text. */
  data?: Record<string, string>;
  /**
   * Template the item was made from (`Doc.templates`). Its look and text are derived from the
   * template + `data`, and re-rendered whenever either changes.
   */
  templateId?: string;
}

export interface Shape extends Rect, ItemBase {
  type: 'shape';
  kind: ShapeKind;
  text: string;
  style: ShapeStyle;
  /** Clockwise rotation in degrees around the shape's center. Absent means 0. */
  rotation?: number;
  /**
   * Picture shown by `kind: 'image'` shapes: a data URL embedded in the shape (`src`), or a
   * reference to one stored once in `Doc.assets` (`asset`, used by device pictures).
   */
  image?: { src?: string; asset?: string };
  /**
   * Where the text goes: inside the shape (absent) or to its right, outside its box (arrows can
   * attach to it there too). Files saved with the earlier 'below' are migrated to 'right'.
   */
  textPosition?: 'right';
  /**
   * Text boxes made by double-clicking the canvas: `w`/`h` are fitted to the text (no
   * wrapping) whenever the text or font changes. Cleared when the box is resized by hand.
   */
  autoSize?: boolean;
}

/**
 * A connector end. When `shapeId` is set the end is attached to that shape:
 * - `at`: pinned to that point, given as fractions (0–1) of the shape's unrotated box;
 * - `port` (legacy, pre-arrow-tool files): to that port of the shape;
 * - neither (legacy): to whichever port faces the other end.
 * `x`/`y` is the position used when the end is free.
 */
export interface Endpoint {
  shapeId?: string;
  at?: Point;
  port?: number;
  x: number;
  y: number;
}

export type ArrowHead = 'none' | 'arrow' | 'open';
export type LineDash = 'solid' | 'dashed' | 'dotted';
export type Routing = 'straight' | 'elbow' | 'curved';

export interface ConnectorStyle {
  stroke: string;
  strokeWidth: number;
  dash: LineDash;
  startArrow: ArrowHead;
  endArrow: ArrowHead;
  /** 0–1, fading the whole line (stroke, arrowheads, labels). Absent means 1 (opaque). */
  opacity?: number;
}

export interface Connector extends ItemBase {
  type: 'connector';
  source: Endpoint;
  target: Endpoint;
  routing: Routing;
  /** Curved lines: how far the curve's midpoint sits from the straight chord (signed, px). */
  bend?: number;
  label: string;
  /** Small labels drawn near the source / target end (e.g. interface names). */
  startLabel?: string;
  endLabel?: string;
  style: ConnectorStyle;
}

export type Item = Shape | Connector;

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
}

export interface Page {
  id: string;
  name: string;
  items: Record<string, Item>;
  /** Z-order within each layer, back to front. */
  order: string[];
  /** Bottom to top; always at least one. */
  layers: Layer[];
}

/**
 * A reusable look for nodes (custom components). `text` may contain `{field}` placeholders
 * filled from each node's `data`.
 */
export interface NodeTemplate {
  id: string;
  name: string;
  kind: ShapeKind;
  w: number;
  h: number;
  style: ShapeStyle;
  text: string;
  /** A picture element: its nodes are pictures (`kind: 'image'`) showing this asset. */
  image?: { asset: string };
  /** Text inside the shape (absent) or to its right. Picture elements always use 'right'. */
  textPosition?: 'right';
  /**
   * Platform rules: a device whose platform contains one of these (ignoring case) uses this
   * element; the longest matching rule wins (your own elements before built-in ones).
   */
  platforms?: string[];
  /**
   * One of the built-in device elements. Their (generic) rules apply only when no other
   * element's rules match, so e.g. your "9300" picture beats the built-in Switch's "nexus".
   */
  builtIn?: true;
}

/** A reusable look for lines; its labels may contain `{field}` placeholders. */
export interface LineTemplate {
  id: string;
  name: string;
  routing: Routing;
  style: ConnectorStyle;
  label: string;
  startLabel: string;
  endLabel: string;
}

export interface Templates {
  nodes: NodeTemplate[];
  lines: LineTemplate[];
  /** Node element for devices whose platform matches no rule. Absent: the first node element. */
  defaultNodeId?: string;
}

export interface Doc {
  version: 2;
  title: string;
  /** Always at least one. */
  pages: Page[];
  /** Custom components, shared by all pages. Absent until the first one is made. */
  templates?: Templates;
  /** Pictures stored once and referenced by id (from templates and `Shape.image.asset`). */
  assets?: Record<string, string>;
}
