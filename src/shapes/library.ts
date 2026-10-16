import type { Point, Rect, ShapeKind, ShapeStyle } from '../model/types';

/** A connection point in shape-local coordinates, with the direction a line leaves it. */
export interface PortDef {
  x: number;
  y: number;
  dir: Point;
}

export interface ShapeDef {
  path: (w: number, h: number) => string;
  ports: (w: number, h: number) => PortDef[];
  /** Area text wraps inside, in shape-local coordinates. */
  textBox: (w: number, h: number) => Rect;
  /**
   * The shape's edge as a closed polygon in local coordinates (curves sampled), used to
   * snap arrow ends onto the outline.
   */
  outline: (w: number, h: number) => Point[];
  /** Resizing keeps the shape's proportions (Shift stretches it instead). */
  keepAspect?: true;
}

const UP = { x: 0, y: -1 };
const RIGHT = { x: 1, y: 0 };
const DOWN = { x: 0, y: 1 };
const LEFT = { x: -1, y: 0 };

/** Top, right, bottom, left edge midpoints, in that order. */
const sidePorts = (w: number, h: number): PortDef[] => [
  { x: w / 2, y: 0, dir: UP },
  { x: w, y: h / 2, dir: RIGHT },
  { x: w / 2, y: h, dir: DOWN },
  { x: 0, y: h / 2, dir: LEFT },
];

const inset = (pad: number) => (w: number, h: number): Rect => ({
  x: pad,
  y: pad,
  w: Math.max(1, w - pad * 2),
  h: Math.max(1, h - pad * 2),
});

const rectPath = (w: number, h: number) => `M0 0H${w}V${h}H0Z`;

const rectOutline = (w: number, h: number): Point[] => [
  { x: 0, y: 0 },
  { x: w, y: 0 },
  { x: w, y: h },
  { x: 0, y: h },
];

/** Points along an elliptical arc from angle `from` to `to` (radians, y down), inclusive. */
function arc(cx: number, cy: number, rx: number, ry: number, from: number, to: number, n: number): Point[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = from + ((to - from) * i) / n;
    return { x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) };
  });
}

const PI = Math.PI;

function roundRectPath(w: number, h: number, r: number) {
  return (
    `M${r} 0H${w - r}A${r} ${r} 0 0 1 ${w} ${r}V${h - r}A${r} ${r} 0 0 1 ${w - r} ${h}` +
    `H${r}A${r} ${r} 0 0 1 0 ${h - r}V${r}A${r} ${r} 0 0 1 ${r} 0Z`
  );
}

const ELLIPSE: ShapeDef = {
  path: (w, h) => `M0 ${h / 2}A${w / 2} ${h / 2} 0 1 0 ${w} ${h / 2}A${w / 2} ${h / 2} 0 1 0 0 ${h / 2}Z`,
  ports: sidePorts,
  textBox: (w, h) => ({ x: w * 0.15, y: h * 0.15, w: w * 0.7, h: h * 0.7 }),
  outline: (w, h) => arc(w / 2, h / 2, w / 2, h / 2, 0, 2 * PI, 48).slice(0, -1),
};

export const SHAPES: Record<ShapeKind, ShapeDef> = {
  rect: { path: rectPath, ports: sidePorts, textBox: inset(8), outline: rectOutline },
  roundRect: {
    path: (w, h) => roundRectPath(w, h, Math.min(10, w / 4, h / 4)),
    ports: sidePorts,
    textBox: inset(8),
    outline: (w, h) => {
      const r = Math.min(10, w / 4, h / 4);
      return [
        ...arc(w - r, r, r, r, -PI / 2, 0, 4),
        ...arc(w - r, h - r, r, r, 0, PI / 2, 4),
        ...arc(r, h - r, r, r, PI / 2, PI, 4),
        ...arc(r, r, r, r, PI, (3 * PI) / 2, 4),
      ];
    },
  },
  ellipse: ELLIPSE,
  // An ellipse that stays round: resizing keeps width = height.
  circle: { ...ELLIPSE, keepAspect: true },
  triangle: {
    path: (w, h) => `M${w / 2} 0L${w} ${h}H0Z`,
    ports: (w, h) => [
      { x: w / 2, y: 0, dir: UP },
      { x: w * 0.75, y: h / 2, dir: RIGHT },
      { x: w / 2, y: h, dir: DOWN },
      { x: w * 0.25, y: h / 2, dir: LEFT },
    ],
    textBox: (w, h) => ({ x: w * 0.25, y: h * 0.45, w: w * 0.5, h: h * 0.5 }),
    outline: (w, h) => [
      { x: w / 2, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ],
  },
  hexagon: {
    path: (w, h) => {
      const o = Math.min(w * 0.25, h * 0.5);
      return `M${o} 0H${w - o}L${w} ${h / 2}L${w - o} ${h}H${o}L0 ${h / 2}Z`;
    },
    ports: sidePorts,
    textBox: (w, h) => {
      const o = Math.min(w * 0.25, h * 0.5);
      return { x: o, y: 6, w: Math.max(1, w - o * 2), h: Math.max(1, h - 12) };
    },
    outline: (w, h) => {
      const o = Math.min(w * 0.25, h * 0.5);
      return [
        { x: o, y: 0 },
        { x: w - o, y: 0 },
        { x: w, y: h / 2 },
        { x: w - o, y: h },
        { x: o, y: h },
        { x: 0, y: h / 2 },
      ];
    },
  },
  note: {
    path: (w, h) => {
      const f = Math.min(15, w / 4, h / 4);
      return `M0 0H${w - f}L${w} ${f}V${h}H0ZM${w - f} 0V${f}H${w}`;
    },
    ports: sidePorts,
    textBox: inset(10),
    outline: rectOutline,
  },
  text: { path: rectPath, ports: sidePorts, textBox: inset(2), outline: rectOutline },
  image: { path: rectPath, ports: sidePorts, textBox: inset(2), outline: rectOutline, keepAspect: true },
};

export interface LibraryEntry {
  label: string;
  category: 'Basic';
  kind: ShapeKind;
  w: number;
  h: number;
  text?: string;
  style?: Partial<ShapeStyle>;
  /** Number key that arms this entry's draw tool (Basic entries). */
  shortcut?: string;
}

/** Number key for the Arrow tool, the last tile of the Basic section (A works too). */
export const ARROW_SHORTCUT = '6';

export const LIBRARY: LibraryEntry[] = [
  { label: 'Rectangle', category: 'Basic', kind: 'rect', w: 140, h: 70, shortcut: '1' },
  { label: 'Circle', category: 'Basic', kind: 'circle', w: 80, h: 80, shortcut: '2' },
  { label: 'Triangle', category: 'Basic', kind: 'triangle', w: 100, h: 90, shortcut: '3' },
  // Places an auto-sized text box and starts editing it (see the canvas's draw tool).
  {
    label: 'Text',
    category: 'Basic',
    kind: 'text',
    w: 120,
    h: 40,
    text: 'Text',
    style: { fill: 'none', stroke: 'none' },
    shortcut: '4',
  },
  // Opens a file picker instead of adding a shape (see ui/ShapeLibrary.tsx).
  { label: 'Image', category: 'Basic', kind: 'image', w: 160, h: 120, shortcut: '5' },
];
