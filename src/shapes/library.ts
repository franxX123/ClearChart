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

function roundRectPath(w: number, h: number, r: number) {
  return (
    `M${r} 0H${w - r}A${r} ${r} 0 0 1 ${w} ${r}V${h - r}A${r} ${r} 0 0 1 ${w - r} ${h}` +
    `H${r}A${r} ${r} 0 0 1 0 ${h - r}V${r}A${r} ${r} 0 0 1 ${r} 0Z`
  );
}

export const SHAPES: Record<ShapeKind, ShapeDef> = {
  rect: { path: rectPath, ports: sidePorts, textBox: inset(8) },
  roundRect: {
    path: (w, h) => roundRectPath(w, h, Math.min(10, w / 4, h / 4)),
    ports: sidePorts,
    textBox: inset(8),
  },
  ellipse: {
    path: (w, h) => `M0 ${h / 2}A${w / 2} ${h / 2} 0 1 0 ${w} ${h / 2}A${w / 2} ${h / 2} 0 1 0 0 ${h / 2}Z`,
    ports: sidePorts,
    textBox: (w, h) => ({ x: w * 0.15, y: h * 0.15, w: w * 0.7, h: h * 0.7 }),
  },
  diamond: {
    path: (w, h) => `M${w / 2} 0L${w} ${h / 2}L${w / 2} ${h}L0 ${h / 2}Z`,
    ports: sidePorts,
    textBox: (w, h) => ({ x: w * 0.2, y: h * 0.2, w: w * 0.6, h: h * 0.6 }),
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
  },
  document: {
    path: (w, h) => {
      const a = h * 0.1;
      return `M0 0H${w}V${h - a}C${w * 0.75} ${h - a * 3} ${w * 0.25} ${h + a} 0 ${h - a}Z`;
    },
    ports: (w, h) => sidePorts(w, h).map((p, i) => (i === 2 ? { ...p, y: h - h * 0.1 } : p)),
    textBox: (w, h) => ({ x: 8, y: 6, w: Math.max(1, w - 16), h: Math.max(1, h * 0.8 - 6) }),
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
  },
  note: {
    path: (w, h) => {
      const f = Math.min(15, w / 4, h / 4);
      return `M0 0H${w - f}L${w} ${f}V${h}H0ZM${w - f} 0V${f}H${w}`;
    },
    ports: sidePorts,
    textBox: inset(10),
  },
  text: { path: rectPath, ports: sidePorts, textBox: inset(2) },
};

export interface LibraryEntry {
  label: string;
  category: 'Basic' | 'Flowchart';
  kind: ShapeKind;
  w: number;
  h: number;
  text?: string;
  style?: Partial<ShapeStyle>;
}

export const LIBRARY: LibraryEntry[] = [
  { label: 'Rectangle', category: 'Basic', kind: 'rect', w: 140, h: 70 },
  { label: 'Rounded rectangle', category: 'Basic', kind: 'roundRect', w: 140, h: 70 },
  { label: 'Ellipse', category: 'Basic', kind: 'ellipse', w: 120, h: 80 },
  { label: 'Triangle', category: 'Basic', kind: 'triangle', w: 100, h: 90 },
  { label: 'Hexagon', category: 'Basic', kind: 'hexagon', w: 130, h: 80 },
  { label: 'Note', category: 'Basic', kind: 'note', w: 120, h: 100, style: { fill: '#fff7c2' } },
  {
    label: 'Text',
    category: 'Basic',
    kind: 'text',
    w: 120,
    h: 40,
    text: 'Text',
    style: { fill: 'none', stroke: 'none' },
  },
  { label: 'Process', category: 'Flowchart', kind: 'rect', w: 140, h: 70 },
  { label: 'Decision', category: 'Flowchart', kind: 'diamond', w: 140, h: 100 },
  { label: 'Terminator', category: 'Flowchart', kind: 'terminator', w: 140, h: 50 },
  { label: 'Data (I/O)', category: 'Flowchart', kind: 'parallelogram', w: 150, h: 70 },
  { label: 'Document', category: 'Flowchart', kind: 'document', w: 140, h: 80 },
  { label: 'Database', category: 'Flowchart', kind: 'cylinder', w: 100, h: 90 },
  { label: 'Predefined process', category: 'Flowchart', kind: 'subprocess', w: 150, h: 70 },
  { label: 'Connector', category: 'Flowchart', kind: 'ellipse', w: 40, h: 40 },
];
