import { nanoid } from 'nanoid';
import { fitText } from '../canvas/text';
import { SHAPES } from '../shapes/library';
import { makeConnector, makeShape } from './doc';
import type { Connector, Endpoint, LineTemplate, NodeTemplate, Point, Shape, ShapeKind, ShapeStyle } from './types';

// Custom components: node and line templates with {field} placeholders, and the items made
// from them. Items store the rendered result (text, labels, look); these helpers re-render it
// whenever the template or the item's data changes. Pure, apart from fresh ids.

const PLACEHOLDER = /\{([^{}\n]+)\}/g;

/** The placeholder names in a template text, in order of first use. */
export function templateFields(...texts: string[]): string[] {
  const out: string[] = [];
  for (const t of texts) {
    for (const m of t.matchAll(PLACEHOLDER)) {
      const k = m[1].trim();
      if (!out.some((o) => o.toLowerCase() === k.toLowerCase())) out.push(k);
    }
  }
  return out;
}

/** Value of a field, matching the name case-insensitively; '' when missing. */
function field(data: Record<string, string> | undefined, name: string): string {
  if (!data) return '';
  const want = name.trim().toLowerCase();
  const key = Object.keys(data).find((k) => k.toLowerCase() === want);
  return key ? data[key] : '';
}

/**
 * Fills `{field}` placeholders from `data`. A line whose placeholders are all empty is dropped,
 * so e.g. "IP: {ip}" disappears for a device without an IP.
 */
export function applyTemplate(text: string, data: Record<string, string> | undefined): string {
  return text
    .split('\n')
    .flatMap((line) => {
      const keys = [...line.matchAll(PLACEHOLDER)];
      if (keys.length && keys.every((m) => !field(data, m[1]))) return [];
      return [line.replace(PLACEHOLDER, (_, k: string) => field(data, k))];
    })
    .join('\n');
}

/** Smallest size at least (minW, minH) whose text box fits `text` unwrapped. */
export function fitNodeSize(kind: ShapeKind, minW: number, minH: number, text: string, style: ShapeStyle) {
  const need = fitText(text, style, 0);
  let w = minW;
  let h = minH;
  // Text boxes are insets or fractions of the shape, so scaling by the shortfall converges fast.
  for (let i = 0; i < 4; i++) {
    const box = SHAPES[kind].textBox(w, h);
    if (box.w < need.w) w *= need.w / Math.max(box.w, 1);
    if (box.h < need.h) h *= need.h / Math.max(box.h, 1);
  }
  return { w: Math.ceil(w), h: Math.ceil(h) };
}

/** A new node from a template, centered at `center`. */
export function nodeFromTemplate(t: NodeTemplate, data: Record<string, string>, center: Point): Shape {
  const text = applyTemplate(t.text, data);
  const size = fitNodeSize(t.kind, t.w, t.h, text, t.style);
  const s = makeShape(t.kind, { x: Math.round(center.x - size.w / 2), y: Math.round(center.y - size.h / 2), ...size }, text, t.style);
  s.templateId = t.id;
  s.data = { ...data };
  return s;
}

/** Re-renders a node's text from its data, growing it (around its center) if the text no longer fits. */
export function renderNodeText(s: Shape, t: NodeTemplate): void {
  s.text = applyTemplate(t.text, s.data);
  const size = fitNodeSize(s.kind, s.w, s.h, s.text, s.style);
  resizeAroundCenter(s, size.w, size.h);
}

/** Gives a node its template's current look (kind, style, size, text), keeping its center and data. */
export function restyleNode(s: Shape, t: NodeTemplate): void {
  s.kind = t.kind;
  s.style = { ...t.style };
  s.text = applyTemplate(t.text, s.data);
  const size = fitNodeSize(t.kind, t.w, t.h, s.text, t.style);
  resizeAroundCenter(s, size.w, size.h);
}

function resizeAroundCenter(s: Shape, w: number, h: number) {
  s.x += (s.w - w) / 2;
  s.y += (s.h - h) / 2;
  s.w = w;
  s.h = h;
}

/** A new line from a template between two ends. */
export function lineFromTemplate(t: LineTemplate, data: Record<string, string>, source: Endpoint, target: Endpoint): Connector {
  const c = makeConnector(source, target);
  c.templateId = t.id;
  c.data = { ...data };
  restyleLine(c, t);
  return c;
}

/** Re-renders a line's labels from its data. */
export function renderLineText(c: Connector, t: LineTemplate): void {
  c.label = applyTemplate(t.label, c.data).replace(/\n/g, ' ');
  c.startLabel = applyTemplate(t.startLabel, c.data).replace(/\n/g, ' ');
  c.endLabel = applyTemplate(t.endLabel, c.data).replace(/\n/g, ' ');
}

/** Gives a line its template's current look and labels. */
export function restyleLine(c: Connector, t: LineTemplate): void {
  c.routing = t.routing;
  c.style = { ...t.style };
  renderLineText(c, t);
}

/** A node template capturing a shape's look and (placeholder) text. */
export function templateFromShape(s: Shape, name: string, id = nanoid(10)): NodeTemplate {
  return { id, name, kind: s.kind, w: Math.round(s.w), h: Math.round(s.h), style: { ...s.style }, text: s.text };
}

/** A line template capturing a line's look and (placeholder) labels. */
export function templateFromLine(c: Connector, name: string, id = nanoid(10)): LineTemplate {
  return {
    id,
    name,
    routing: c.routing,
    style: { ...c.style },
    label: c.label,
    startLabel: c.startLabel ?? '',
    endLabel: c.endLabel ?? '',
  };
}

/** The starting templates (defined with the document defaults in `doc.ts`). */
export { defaultTemplates } from './doc';
