import { docBounds } from '../canvas/geometry';
import { isConnector, isShape, makeConnector, makeShape } from '../model/doc';
import type { Connector, Doc, NodeComponent, Shape } from '../model/types';
import { forceLayout, type LayoutNode } from './layout';
import { FALLBACK_LINK, fallbackNode, fillPlaceholders, pickLink, pickNode } from './rules';
import type { DataRecord, GraphTemplate } from './types';

export interface GraphEdge {
  a: DataRecord;
  b: DataRecord;
}

export interface ParsedGraph {
  edges: GraphEdge[];
  /** Every key seen on any node, in order of first appearance. */
  fields: string[];
}

function toRecord(v: unknown, where: string): DataRecord {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error(`${where}: expected an object`);
  const out: DataRecord = {};
  for (const [key, val] of Object.entries(v)) {
    if (val == null) continue;
    out[key] = typeof val === 'object' ? JSON.stringify(val) : String(val);
  }
  return out;
}

/** Parses `[[nodeA, nodeB], …]`, throwing with the position of the first bad edge. */
export function parseGraph(json: string): ParsedGraph {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    throw new Error(`Not valid JSON: ${(err as Error).message}`);
  }
  if (!Array.isArray(raw)) throw new Error('Expected an array of edges: [[nodeA, nodeB], …]');
  if (raw.length === 0) throw new Error('The file has no edges');
  const fields = new Set<string>();
  const edges = raw.map((e, i): GraphEdge => {
    if (!Array.isArray(e) || e.length !== 2) throw new Error(`Edge ${i + 1}: expected a pair [nodeA, nodeB]`);
    const a = toRecord(e[0], `Edge ${i + 1}, first node`);
    const b = toRecord(e[1], `Edge ${i + 1}, second node`);
    for (const k of [...Object.keys(a), ...Object.keys(b)]) fields.add(k);
    return { a, b };
  });
  return { edges, fields: [...fields] };
}

export interface ImportOptions {
  /** Field that identifies a node; nodes with the same value are one node. */
  keyField: string;
  /** Field shown as a label at each node's end of a link (e.g. `interface`), or null. */
  endLabelField: string | null;
  /** Fields that describe the link rather than the node; kept out of node data. */
  linkFields: string[];
}

export interface ImportReport {
  newNodes: number;
  reusedNodes: number;
  newLinks: number;
  duplicateLinks: number;
  /** Edges dropped because a node had no value for the key field. */
  missingKey: number;
  selfLoops: number;
  /** New nodes per component name. */
  nodeCounts: Record<string, number>;
  /** New links per line component name. */
  linkCounts: Record<string, number>;
}

export interface ImportPlan {
  /** New shapes, positioned at 0,0 until `layoutPlan` runs. */
  shapes: Shape[];
  connectors: Connector[];
  /** Definitions the new shapes use, to merge into `doc.components`. */
  components: Record<string, NodeComponent>;
  report: ImportReport;
}

const keyOf = (v: string | undefined) => (v ?? '').trim().toLowerCase();

const omit = (r: DataRecord, fields: Set<string>): DataRecord =>
  Object.fromEntries(Object.entries(r).filter(([k]) => !fields.has(k)));

/** One value per link field: equal or one-sided values once, differing ones as "a / b". */
function linkRecord(a: DataRecord, b: DataRecord, fields: string[]): DataRecord {
  const out: DataRecord = {};
  for (const f of fields) {
    const va = a[f]?.trim() ?? '';
    const vb = b[f]?.trim() ?? '';
    const v = !va || !vb || va === vb ? va || vb : `${va} / ${vb}`;
    if (v) out[f] = v;
  }
  return out;
}

/** Undirected identity of a link: both node keys plus the interface label on each side. */
function linkId(ka: string, la: string, kb: string, lb: string): string {
  const sa = `${ka}\u0000${la.trim().toLowerCase()}`;
  const sb = `${kb}\u0000${lb.trim().toLowerCase()}`;
  return sa < sb ? `${sa}\u0001${sb}` : `${sb}\u0001${sa}`;
}

/**
 * Works out which nodes and links an import adds to `doc`. Nodes are deduped by key field,
 * both within the file and against shapes already in the doc (which are reused, not moved).
 * Links already present, in either direction, are skipped.
 */
export function planImport(doc: Doc, edges: GraphEdge[], template: GraphTemplate | null, opts: ImportOptions): ImportPlan {
  const linkFields = new Set(opts.linkFields.filter((f) => f !== opts.keyField));
  const report: ImportReport = {
    newNodes: 0,
    reusedNodes: 0,
    newLinks: 0,
    duplicateLinks: 0,
    missingKey: 0,
    selfLoops: 0,
    nodeCounts: {},
    linkCounts: {},
  };

  // Existing nodes and links in the doc, by key.
  const existing = new Map<string, Shape>();
  for (const id of doc.order) {
    const s = doc.items[id];
    const k = isShape(s) ? keyOf(s.data?.[opts.keyField]) : '';
    if (k && !existing.has(k)) existing.set(k, s as Shape);
  }
  const shapeKey = new Map([...existing].map(([k, s]) => [s.id, k]));
  const seenLinks = new Set<string>();
  for (const id of doc.order) {
    const c = doc.items[id];
    if (!isConnector(c)) continue;
    const ka = c.source.shapeId && shapeKey.get(c.source.shapeId);
    const kb = c.target.shapeId && shapeKey.get(c.target.shapeId);
    if (ka && kb) seenLinks.add(linkId(ka, c.sourceLabel ?? '', kb, c.targetLabel ?? ''));
  }

  // Unique nodes in the file, data merged across repeats (first non-empty value wins).
  const nodes = new Map<string, DataRecord>();
  const reused = new Set<string>();
  const addNode = (r: DataRecord, k: string) => {
    if (existing.has(k)) {
      reused.add(k);
      return;
    }
    const data = omit(r, linkFields);
    const prev = nodes.get(k);
    if (!prev) nodes.set(k, data);
    else for (const [f, v] of Object.entries(data)) if (!prev[f] && v) prev[f] = v;
  };
  const links: { ka: string; kb: string; a: DataRecord; b: DataRecord }[] = [];
  for (const { a, b } of edges) {
    const ka = keyOf(a[opts.keyField]);
    const kb = keyOf(b[opts.keyField]);
    if (!ka || !kb) {
      report.missingKey++;
      continue;
    }
    addNode(a, ka);
    addNode(b, kb);
    if (ka === kb) {
      report.selfLoops++;
      continue;
    }
    const lf = opts.endLabelField;
    const id = linkId(ka, lf ? (a[lf] ?? '') : '', kb, lf ? (b[lf] ?? '') : '');
    if (seenLinks.has(id)) {
      report.duplicateLinks++;
      continue;
    }
    seenLinks.add(id);
    links.push({ ka, kb, a, b });
  }

  const components: Record<string, NodeComponent> = {};
  const shapes: Shape[] = [];
  const shapeFor = new Map<string, string>([...existing].map(([k, s]) => [k, s.id]));
  for (const [k, data] of nodes) {
    const comp = pickNode(template, data) ?? fallbackNode(opts.keyField);
    components[comp.id] = comp;
    const s = makeShape('component', { x: 0, y: 0, w: comp.w, h: comp.h }, '', { fill: 'none', stroke: 'none' });
    s.componentId = comp.id;
    s.data = data;
    shapes.push(s);
    shapeFor.set(k, s.id);
    report.nodeCounts[comp.name] = (report.nodeCounts[comp.name] ?? 0) + 1;
  }

  const fields = [...linkFields];
  const connectors = links.map(({ ka, kb, a, b }) => {
    const comp = pickLink(template, a, b) ?? FALLBACK_LINK;
    const data = linkRecord(a, b, fields);
    const c = makeConnector(
      { shapeId: shapeFor.get(ka), perimeter: true, x: 0, y: 0 },
      { shapeId: shapeFor.get(kb), perimeter: true, x: 0, y: 0 },
      fillPlaceholders(comp.label, data).trim(),
    );
    c.routing = comp.routing;
    c.style = { ...comp.style };
    const lf = opts.endLabelField;
    if (lf && a[lf]?.trim()) c.sourceLabel = a[lf].trim();
    if (lf && b[lf]?.trim()) c.targetLabel = b[lf].trim();
    if (Object.keys(data).length) c.data = data;
    report.linkCounts[comp.name] = (report.linkCounts[comp.name] ?? 0) + 1;
    return c;
  });

  report.newNodes = shapes.length;
  report.reusedNodes = reused.size;
  report.newLinks = connectors.length;
  return { shapes, connectors, components, report };
}

/** Positions the plan's new shapes with a force-directed layout around the nodes already placed. */
export function layoutPlan(doc: Doc, plan: ImportPlan): void {
  const byId = new Map<string, LayoutNode>();
  for (const s of plan.shapes) byId.set(s.id, { id: s.id, w: s.w, h: s.h });
  for (const c of plan.connectors) {
    for (const ep of [c.source, c.target]) {
      const s = ep.shapeId ? doc.items[ep.shapeId] : undefined;
      if (isShape(s) && !byId.has(s.id)) byId.set(s.id, { id: s.id, w: s.w, h: s.h, fixed: { x: s.x, y: s.y } });
    }
  }
  const b = docBounds(doc);
  const origin = b ? { x: b.x + b.w + 120, y: b.y } : { x: 40, y: 40 };
  const edges = plan.connectors.map((c): [string, string] => [c.source.shapeId!, c.target.shapeId!]);
  const pos = forceLayout([...byId.values()], edges, { origin });
  for (const s of plan.shapes) Object.assign(s, pos[s.id]);
}
