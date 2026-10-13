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
const sidePorts = (w: number, h: number, inset = { l: 0, r: 0 }): PortDef[] => [
  { x: w / 2, y: 0, dir: UP },
  { x: w - inset.r, y: h / 2, dir: RIGHT },
  { x: w / 2, y: h, dir: DOWN },
  { x: inset.l, y: h / 2, dir: LEFT },
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
  diamond: {
    path: (w, h) => `M${w / 2} 0L${w} ${h / 2}L${w / 2} ${h}L0 ${h / 2}Z`,
    ports: sidePorts,
    textBox: (w, h) => ({ x: w * 0.2, y: h * 0.2, w: w * 0.6, h: h * 0.6 }),
    outline: (w, h) => [
      { x: w / 2, y: 0 },
      { x: w, y: h / 2 },
      { x: w / 2, y: h },
      { x: 0, y: h / 2 },
    ],
  },
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
  parallelogram: {
    path: (w, h) => {
      const o = Math.min(w * 0.2, h * 0.5);
      return `M${o} 0H${w}L${w - o} ${h}H0Z`;
    },
    ports: (w, h) => {
      const o = Math.min(w * 0.2, h * 0.5);
      return sidePorts(w, h, { l: o / 2, r: o / 2 });
    },
    textBox: (w, h) => {
      const o = Math.min(w * 0.2, h * 0.5);
      return { x: o, y: 6, w: Math.max(1, w - o * 2), h: Math.max(1, h - 12) };
    },
    outline: (w, h) => {
      const o = Math.min(w * 0.2, h * 0.5);
      return [
        { x: o, y: 0 },
        { x: w, y: 0 },
        { x: w - o, y: h },
        { x: 0, y: h },
      ];
    },
  },
  cylinder: {
    path: (w, h) => {
      const ry = Math.min(h * 0.15, 12);
      return (
        `M0 ${ry}A${w / 2} ${ry} 0 0 1 ${w} ${ry}V${h - ry}A${w / 2} ${ry} 0 0 1 0 ${h - ry}Z` +
        // Lip drawn clockwise like the body, so the nonzero fill doesn't cancel out under it.
        `M${w} ${ry}A${w / 2} ${ry} 0 0 1 0 ${ry}`
      );
    },
    ports: sidePorts,
    textBox: (w, h) => {
      const ry = Math.min(h * 0.15, 12);
      return { x: 6, y: ry * 2, w: Math.max(1, w - 12), h: Math.max(1, h - ry * 3) };
    },
    outline: (w, h) => {
      const ry = Math.min(h * 0.15, 12);
      return [...arc(w / 2, ry, w / 2, ry, PI, 2 * PI, 16), ...arc(w / 2, h - ry, w / 2, ry, 0, PI, 16)];
    },
  },
  document: {
    path: (w, h) => {
      const a = h * 0.1;
      return `M0 0H${w}V${h - a}C${w * 0.75} ${h - a * 3} ${w * 0.25} ${h + a} 0 ${h - a}Z`;
    },
    ports: (w, h) => sidePorts(w, h).map((p, i) => (i === 2 ? { ...p, y: h - h * 0.1 } : p)),
    textBox: (w, h) => ({ x: 8, y: 6, w: Math.max(1, w - 16), h: Math.max(1, h * 0.8 - 6) }),
    outline: (w, h) => {
      // The wavy bottom edge: the path's cubic from (w, h-a) back to (0, h-a), sampled.
      const a = h * 0.1;
      const wave = Array.from({ length: 17 }, (_, i) => {
        const t = i / 16;
        const u = 1 - t;
        return {
          x: u ** 3 * w + 3 * u * u * t * w * 0.75 + 3 * u * t * t * w * 0.25,
          y: u ** 3 * (h - a) + 3 * u * u * t * (h - a * 3) + 3 * u * t * t * (h + a) + t ** 3 * (h - a),
        };
      });
      return [{ x: 0, y: 0 }, { x: w, y: 0 }, ...wave];
    },
  },
  terminator: {
    path: (w, h) => {
      const r = Math.min(h / 2, w / 2);
      return `M${r} 0H${w - r}A${r} ${r} 0 0 1 ${w - r} ${h}H${r}A${r} ${r} 0 0 1 ${r} 0Z`;
    },
    ports: sidePorts,
    textBox: (w, h) => {
      const r = Math.min(h / 2, w / 2);
      return { x: r * 0.6, y: 4, w: Math.max(1, w - r * 1.2), h: Math.max(1, h - 8) };
    },
    outline: (w, h) => {
      const r = Math.min(h / 2, w / 2);
      return [...arc(w - r, h / 2, r, h / 2, -PI / 2, PI / 2, 12), ...arc(r, h / 2, r, h / 2, PI / 2, (3 * PI) / 2, 12)];
    },
  },
  subprocess: {
    path: (w, h) => {
      const i = Math.min(10, w * 0.1);
      return `${rectPath(w, h)}M${i} 0V${h}M${w - i} 0V${h}`;
    },
    ports: sidePorts,
    textBox: (w, h) => {
      const i = Math.min(10, w * 0.1);
      return { x: i + 4, y: 6, w: Math.max(1, w - i * 2 - 8), h: Math.max(1, h - 12) };
    },
    outline: rectOutline,
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
  category: 'Basic' | 'Flowchart';
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
  { label: 'Process', category: 'Flowchart', kind: 'rect', w: 140, h: 70 },
  { label: 'Decision', category: 'Flowchart', kind: 'diamond', w: 140, h: 100 },
  { label: 'Terminator', category: 'Flowchart', kind: 'terminator', w: 140, h: 50 },
  { label: 'Data (I/O)', category: 'Flowchart', kind: 'parallelogram', w: 150, h: 70 },
  { label: 'Document', category: 'Flowchart', kind: 'document', w: 140, h: 80 },
  { label: 'Database', category: 'Flowchart', kind: 'cylinder', w: 100, h: 90 },
  { label: 'Predefined process', category: 'Flowchart', kind: 'subprocess', w: 150, h: 70 },
  { label: 'Connector', category: 'Flowchart', kind: 'ellipse', w: 40, h: 40 },
];
