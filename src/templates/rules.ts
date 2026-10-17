import { unionRects } from '../canvas/geometry';
import { DEFAULT_CONNECTOR_STYLE, DEFAULT_SHAPE_STYLE } from '../model/doc';
import type { NodeComponent, Part, Rule, Shape } from '../model/types';
import type { DataRecord, GraphTemplate, LinkComponent } from './types';

const norm = (v: string | undefined) => (v ?? '').trim().toLowerCase();

/** Splits "cisco 9200, cisco 9300" into trimmed, non-empty values. */
export const parseValues = (text: string) =>
  text
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

export function matchRule(rule: Rule, record: DataRecord): boolean {
  const field = rule.field.trim();
  const value = norm(record[field]);
  return field !== '' && value !== '' && rule.values.some((v) => norm(v) === value);
}

/** First component whose rule passes `test`, else the first default (`rule: null`), else undefined. */
function pick<T extends { rule: Rule | null }>(list: T[], test: (r: Rule) => boolean): T | undefined {
  return list.find((c) => c.rule && test(c.rule)) ?? list.find((c) => !c.rule);
}

export const pickNode = (t: GraphTemplate | null, record: DataRecord): NodeComponent | undefined =>
  t ? pick(t.nodes, (r) => matchRule(r, record)) : undefined;

/** A link rule matches when either end's record matches it. */
export const pickLink = (t: GraphTemplate | null, a: DataRecord, b: DataRecord): LinkComponent | undefined =>
  t ? pick(t.links, (r) => matchRule(r, a) || matchRule(r, b)) : undefined;

const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/g;

/**
 * Replaces `{{field}}` with values from `record`. Without a record (a component placed by hand,
 * no data yet) placeholders are left visible; with one, missing fields become empty.
 */
export function fillPlaceholders(text: string, record: DataRecord | undefined): string {
  if (!record) return text;
  return text.replace(PLACEHOLDER, (_, field: string) => record[field] ?? '');
}

/** Field names referenced by `{{field}}` placeholders, in order of first use. */
export function placeholderFields(texts: string[]): string[] {
  const out = new Set<string>();
  for (const t of texts) for (const m of t.matchAll(PLACEHOLDER)) out.add(m[1]);
  return [...out];
}

/** Removes the instance-only fields of a shape, leaving what a component part keeps. */
function toPart(s: Shape): Part {
  const { id: _id, type: _type, componentId: _cid, data: _data, groups: _groups, ...part } = structuredClone(s);
  return part;
}

/** Scales a part's box by (sx, sy) and offsets it; stroke and font sizes are kept. */
export const placePart = (p: Part, dx: number, dy: number, sx: number, sy: number): Part => ({
  ...p,
  x: dx + p.x * sx,
  y: dy + p.y * sy,
  w: p.w * sx,
  h: p.h * sy,
});

/**
 * Turns selected shapes into component parts relative to their joint bounding box.
 * Component instances in the selection are flattened into their own parts.
 */
export function partsFromSelection(
  shapes: Shape[],
  components: Record<string, NodeComponent> = {},
): { w: number; h: number; parts: Part[] } | null {
  const b = unionRects(shapes);
  if (!b) return null;
  const parts: Part[] = [];
  for (const s of shapes) {
    if (s.kind !== 'component') {
      parts.push({ ...toPart(s), x: s.x - b.x, y: s.y - b.y });
      continue;
    }
    const def = s.componentId ? components[s.componentId] : undefined;
    if (!def) continue;
    const sx = s.w / def.w;
    const sy = s.h / def.h;
    for (const p of def.parts) parts.push(structuredClone(placePart(p, s.x - b.x, s.y - b.y, sx, sy)));
  }
  return { w: Math.max(1, b.w), h: Math.max(1, b.h), parts };
}

/** Plain box labeled with the key field, used for nodes no component matches. */
export function fallbackNode(keyField: string): NodeComponent {
  return {
    id: `fallback:${keyField}`,
    name: 'Plain box',
    rule: null,
    w: 140,
    h: 60,
    parts: [
      {
        kind: 'roundRect',
        x: 0,
        y: 0,
        w: 140,
        h: 60,
        text: `{{${keyField}}}`,
        style: { ...DEFAULT_SHAPE_STYLE, fontSize: 13 },
      },
    ],
  };
}

export const FALLBACK_LINK: LinkComponent = {
  id: 'fallback:link',
  name: 'Plain line',
  rule: null,
  style: { ...DEFAULT_CONNECTOR_STYLE, endArrow: 'none' },
  routing: 'straight',
  label: '',
};

export const describeRule = (rule: Rule | null) => (rule ? `${rule.field} = ${rule.values.join(', ')}` : 'default');
