import { nanoid } from 'nanoid';
import type { Doc, Item, Layer, Page } from './types';

// Pure helpers over pages, layers and groups. No React, no store.

export const makeLayer = (name = 'Layer 1'): Layer => ({ id: nanoid(10), name, visible: true, locked: false });

export const makePage = (name = 'Page 1'): Page => ({
  id: nanoid(10),
  name,
  items: {},
  order: [],
  layers: [makeLayer()],
});

/** The page with `id`, or the first page if it no longer exists. */
export const pageById = (doc: Doc, id: string): Page => doc.pages.find((p) => p.id === id) ?? doc.pages[0];

/** The layer with `id`, or the top layer if it no longer exists. */
export const layerById = (page: Page, id: string): Layer =>
  page.layers.find((l) => l.id === id) ?? page.layers[page.layers.length - 1];

/** The layer an item lives on; items with a missing or unknown layer belong to the bottom one. */
export const layerOf = (page: Page, it: Item): Layer => page.layers.find((l) => l.id === it.layerId) ?? page.layers[0];

export const isVisible = (page: Page, it: Item | undefined) => !!it && layerOf(page, it).visible;

/** Visible and on an unlocked layer: can be hovered, selected and attached to. */
export function isInteractive(page: Page, it: Item | undefined): boolean {
  if (!it) return false;
  const l = layerOf(page, it);
  return l.visible && !l.locked;
}

/** Item ids grouped by layer id, each in z-order. */
export function layerBuckets(page: Page): Map<string, string[]> {
  const out = new Map(page.layers.map((l) => [l.id, [] as string[]]));
  for (const id of page.order) {
    const it = page.items[id];
    if (it) out.get(layerOf(page, it).id)!.push(id);
  }
  return out;
}

/** Visible items in paint order (layer by layer, bottom to top). The last one is on top. */
export function renderOrder(page: Page): string[] {
  const buckets = layerBuckets(page);
  return page.layers.filter((l) => l.visible).flatMap((l) => buckets.get(l.id)!);
}

export const outerGroup = (it: Item | undefined): string | undefined => it?.groupIds?.[0];

/** Grows a set of ids to whole outermost groups (interactive members only), in z-order. */
export function expandGroups(page: Page, ids: string[]): string[] {
  const out = new Set(ids.filter((id) => page.items[id]));
  const groups = new Set(ids.map((id) => outerGroup(page.items[id])).filter((g): g is string => !!g));
  if (groups.size) {
    for (const id of page.order) {
      const it = page.items[id];
      const g = outerGroup(it);
      if (g && groups.has(g) && isInteractive(page, it)) out.add(id);
    }
  }
  return page.order.filter((id) => out.has(id));
}

/**
 * Splits ids into units that arrange as one: each outermost group is a unit, every
 * ungrouped item is its own.
 */
export function groupUnits(page: Page, ids: string[]): string[][] {
  const units = new Map<string, string[]>();
  for (const id of ids) {
    const key = outerGroup(page.items[id]) ?? id;
    if (!units.has(key)) units.set(key, []);
    units.get(key)!.push(id);
  }
  return [...units.values()];
}

/** Moves shapes, and the free ends of connectors, by (dx, dy). Mutates `page` (an immer draft). */
export function translateItems(page: Page, ids: Iterable<string>, dx: number, dy: number): void {
  for (const id of ids) {
    const it = page.items[id];
    if (it?.type === 'shape') {
      it.x += dx;
      it.y += dy;
    } else if (it?.type === 'connector') {
      for (const ep of [it.source, it.target]) {
        if (!ep.shapeId) {
          ep.x += dx;
          ep.y += dy;
        }
      }
    }
  }
}

/**
 * Deep-copies items with fresh ids. Connector ends attached to a copied shape, and group
 * memberships, are remapped to the copies; ends attached to anything else keep the old id.
 */
export function copyItems(items: Item[]): { copies: Item[]; ids: Map<string, string> } {
  const ids = new Map(items.map((it) => [it.id, nanoid(10)]));
  const groups = new Map<string, string>();
  const group = (g: string) => {
    if (!groups.has(g)) groups.set(g, nanoid(10));
    return groups.get(g)!;
  };
  const copies = items.map((it) => {
    const copy = structuredClone(it) as Item;
    copy.id = ids.get(it.id)!;
    if (copy.groupIds) copy.groupIds = copy.groupIds.map(group);
    if (copy.type === 'connector') {
      for (const ep of [copy.source, copy.target]) {
        const mapped = ep.shapeId && ids.get(ep.shapeId);
        if (mapped) ep.shapeId = mapped;
      }
    }
    return copy;
  });
  return { copies, ids };
}

/** A full copy of a page with fresh page, layer, item and group ids. */
export function clonePage(page: Page, name: string): Page {
  const layerIds = new Map(page.layers.map((l) => [l.id, nanoid(10)]));
  const originals = page.order.map((id) => page.items[id]).filter(Boolean);
  const { copies } = copyItems(originals);
  const items: Record<string, Item> = {};
  copies.forEach((c, i) => {
    c.layerId = layerIds.get(layerOf(page, originals[i]).id);
    items[c.id] = c;
  });
  return {
    id: nanoid(10),
    name,
    items,
    order: copies.map((c) => c.id),
    layers: page.layers.map((l) => ({ ...l, id: layerIds.get(l.id)! })),
  };
}
