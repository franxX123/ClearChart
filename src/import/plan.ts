import { docBounds, snapToGrid } from '../canvas/geometry';
import { rectCenter, shapeExtent } from '../canvas/transform';
import { forceLayout, type LayoutNode } from '../layout/force';
import { isConnector, isShape } from '../model/doc';
import { lineFromTemplate, nodeFromTemplate } from '../model/templates';
import type { Connector, LineTemplate, NodeTemplate, Page, Point, Shape } from '../model/types';
import { DEVICE_FIELDS, deviceKey, linkKey, type LinkGraph, type SkippedRow } from './links';

// Decides what importing a link graph onto a page does, without changing the page: which
// devices already exist (matched by name), where new ones go, which links are new. The store
// previews this in the import dialog and then commits it. Pure (apart from fresh ids).

export interface ImportSummary {
  devicesNew: number;
  devicesExisting: number;
  /** Existing devices whose fields changed. */
  devicesUpdated: number;
  linksNew: number;
  /** Links in the file that are already drawn on the page. */
  linksExisting: number;
  /** Rows folded into an earlier row describing the same link. */
  merged: number;
  skipped: SkippedRow[];
  /** New devices per element they'll be drawn with, most first. */
  byTemplate: { name: string; count: number }[];
}

export interface ImportPlan {
  summary: ImportSummary;
  newNodes: Shape[];
  /** New field values for existing devices (only those that changed). */
  updates: { id: string; data: Record<string, string> }[];
  newLines: Connector[];
}

/** Bend used for the n-th line between the same two devices: 0, +30, −30, +60, −60, … */
export const parallelBend = (n: number) => (n === 0 ? 0 : 30 * Math.ceil(n / 2) * (n % 2 ? 1 : -1));

/** Devices already on the page: shapes with a `data.hostName`, by device key (first wins). */
function existingDevices(page: Page): Map<string, Shape> {
  const out = new Map<string, Shape>();
  for (const id of page.order) {
    const it = page.items[id];
    const name = isShape(it) ? it.data?.[DEVICE_FIELDS.name] : undefined;
    if (name && !out.has(deviceKey(name))) out.set(deviceKey(name), it as Shape);
  }
  return out;
}

const pairKey = (a: string, b: string) => (a < b ? `${a}↔${b}` : `${b}↔${a}`);

/**
 * Plans an import. `pickNode` chooses the element (template) for a new device from its fields —
 * e.g. by its platform; `lineT` draws the links.
 */
export function planImport(
  page: Page,
  graph: LinkGraph,
  pickNode: (fields: Record<string, string>) => NodeTemplate,
  lineT: LineTemplate,
): ImportPlan {
  const existing = existingDevices(page);
  const updates: ImportPlan['updates'] = [];
  const perTemplate = new Map<string, number>();

  // Devices: reuse by name (merging in non-empty new fields), or plan a new node.
  const shapeOf = new Map<string, string>(); // device key → shape id (existing or new)
  const fresh: { key: string; node: Shape }[] = [];
  for (const [key, fields] of graph.nodes) {
    const old = existing.get(key);
    if (old) {
      shapeOf.set(key, old.id);
      const data = { ...old.data };
      // Keep the existing spelling of the device's name; take any other non-empty new value.
      for (const [f, v] of Object.entries(fields)) if (v && f !== DEVICE_FIELDS.name) data[f] = v;
      if (Object.entries(data).some(([f, v]) => old.data?.[f] !== v)) updates.push({ id: old.id, data });
    } else {
      // Placed at the origin for now; the layout below moves it.
      const t = pickNode(fields);
      perTemplate.set(t.name, (perTemplate.get(t.name) ?? 0) + 1);
      const node = nodeFromTemplate(t, fields, { x: 0, y: 0 });
      shapeOf.set(key, node.id);
      fresh.push({ key, node });
    }
  }

  // Links: skip ones already drawn between the same devices on the same interfaces.
  const deviceOfShape = new Map([...existing].map(([key, s]) => [s.id, key]));
  const drawn = new Set<string>();
  const perPair = new Map<string, number>(); // lines already between two shapes, any kind
  for (const id of page.order) {
    const c = page.items[id];
    if (!isConnector(c) || !c.source.shapeId || !c.target.shapeId) continue;
    const pk = pairKey(c.source.shapeId, c.target.shapeId);
    perPair.set(pk, (perPair.get(pk) ?? 0) + 1);
    const a = deviceOfShape.get(c.source.shapeId);
    const b = deviceOfShape.get(c.target.shapeId);
    if (a && b) drawn.add(linkKey(a, c.data?.hostInterface ?? '', b, c.data?.neighborInterface ?? ''));
  }
  const newLinks = graph.links.filter((l) => !drawn.has(l.key));
  // Total lines per shape pair after the import, to know which pairs need parallel curves.
  const total = new Map(perPair);
  for (const l of newLinks) {
    const pk = pairKey(shapeOf.get(l.host)!, shapeOf.get(l.neighbor)!);
    total.set(pk, (total.get(pk) ?? 0) + 1);
  }

  // Layout: new devices are free; everything already on the page stays put and pushes them away.
  // Boxes include any text drawn beside a shape, so labels get room too.
  if (fresh.length) {
    const nodes: LayoutNode[] = [];
    for (const id of page.order) {
      const it = page.items[id];
      if (isShape(it)) {
        const b = shapeExtent(it);
        nodes.push({ id: it.id, w: b.w, h: b.h, fixed: rectCenter(b) });
      }
    }
    // How far each new node's drawn extent is centered from its box (text beside it shifts it right).
    const offset = new Map<string, Point>();
    for (const { node } of fresh) {
      const e = shapeExtent(node);
      const ec = rectCenter(e);
      const bc = rectCenter(node);
      offset.set(node.id, { x: ec.x - bc.x, y: ec.y - bc.y });
      nodes.push({ id: node.id, w: e.w, h: e.h });
    }
    const edges = newLinks.map((l) => [shapeOf.get(l.host)!, shapeOf.get(l.neighbor)!] as [string, string]);
    const freshIds = new Set(fresh.map((f) => f.node.id));
    const anchors = edges.flatMap(([a, b]) => (freshIds.has(a) && !freshIds.has(b) ? [b] : freshIds.has(b) && !freshIds.has(a) ? [a] : []));
    const bounds = docBounds(page);
    let center: Point = { x: 0, y: 0 };
    if (!anchors.length && bounds) {
      // Nothing to attach to: lay the new devices out to the right of what's on the page.
      center = { x: bounds.x + bounds.w + 160 + 120 * Math.sqrt(fresh.length), y: bounds.y + bounds.h / 2 };
    }
    const pos = forceLayout(nodes, edges, { center });
    for (const { node } of fresh) {
      const c = pos.get(node.id)!;
      const o = offset.get(node.id)!;
      node.x = snapToGrid(c.x - o.x - node.w / 2);
      node.y = snapToGrid(c.y - o.y - node.h / 2);
    }
  }

  // New lines; several between the same two devices fan out as curves.
  const used = new Map(perPair);
  const newLines = newLinks.map((l) => {
    const a = shapeOf.get(l.host)!;
    const b = shapeOf.get(l.neighbor)!;
    const pk = pairKey(a, b);
    const n = used.get(pk) ?? 0;
    used.set(pk, n + 1);
    // Floating ends: each end picks the side of its device facing the other.
    const c = lineFromTemplate(lineT, l.data, { shapeId: a, x: 0, y: 0 }, { shapeId: b, x: 0, y: 0 });
    if ((total.get(pk) ?? 0) > 1 && parallelBend(n) !== 0) {
      c.routing = 'curved';
      // Bends are relative to each line's direction; keep them on one side of the pair's axis.
      c.bend = a < b ? parallelBend(n) : -parallelBend(n);
    }
    return c;
  });

  return {
    summary: {
      devicesNew: fresh.length,
      devicesExisting: graph.nodes.size - fresh.length,
      devicesUpdated: updates.length,
      linksNew: newLines.length,
      linksExisting: graph.links.length - newLines.length,
      merged: graph.merged,
      skipped: graph.skipped,
      byTemplate: [...perTemplate].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    },
    newNodes: fresh.map((f) => f.node),
    updates,
    newLines,
  };
}
