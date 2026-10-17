import { nanoid } from 'nanoid';
import type { Doc, Item } from './types';

/*
 * Groups are stored on the items themselves: `item.groups` lists the ids of the groups the
 * item is in, innermost first. Grouping appends a new id to every member; ungrouping pops the
 * outermost one. Members of a group therefore share the same tail of their lists, nesting
 * needs no extra table, and deleting items can't leave an empty group behind.
 */

/** The outermost group of an item: what clicking it selects. */
export const topGroup = (it: Item | undefined): string | undefined => it?.groups?.[it.groups.length - 1];

/** `ids` plus every item sharing an outermost group with one of them, in z-order. */
export function expandToGroups(doc: Doc, ids: Iterable<string>): string[] {
  const want = new Set(ids);
  const tops = new Set<string>();
  for (const id of want) {
    const g = topGroup(doc.items[id]);
    if (g) tops.add(g);
  }
  return doc.order.filter((id) => {
    if (want.has(id)) return true;
    const g = topGroup(doc.items[id]);
    return g !== undefined && tops.has(g);
  });
}

/** Keeps loose items, and grouped ones only when their whole outermost group is in `ids`. */
export function wholeGroupsOnly(doc: Doc, ids: string[]): string[] {
  const inside = new Set(ids);
  const complete = new Map<string, boolean>();
  for (const id of doc.order) {
    const g = topGroup(doc.items[id]);
    if (g) complete.set(g, (complete.get(g) ?? true) && inside.has(id));
  }
  return ids.filter((id) => {
    const g = topGroup(doc.items[id]);
    return !g || complete.get(g) === true;
  });
}

/** How many separately selectable things `ids` covers: outermost groups plus loose items. */
export function groupUnits(doc: Doc, ids: string[]): number {
  return new Set(ids.filter((id) => doc.items[id]).map((id) => topGroup(doc.items[id]) ?? id)).size;
}

export const hasGroup = (doc: Doc, ids: string[]) => ids.some((id) => topGroup(doc.items[id]));

/** Puts `ids` (already expanded to whole groups) into a new group `gid`, around any they're in. */
export function applyGroup(draft: Doc, ids: string[], gid: string): void {
  for (const id of ids) {
    const it = draft.items[id];
    if (it) it.groups = [...(it.groups ?? []), gid];
  }
}

/** Removes the outermost group of each item in `ids`, from every member of those groups. */
export function applyUngroup(draft: Doc, ids: string[]): void {
  const tops = new Set(ids.map((id) => topGroup(draft.items[id])).filter((g) => g !== undefined));
  for (const id of draft.order) {
    const it = draft.items[id];
    const g = topGroup(it);
    if (!g || !tops.has(g)) continue;
    it.groups!.pop();
    if (it.groups!.length === 0) delete it.groups;
  }
}

/**
 * Gives copied items fresh group ids, the same new id for the same old one, so a pasted group
 * is a separate group. Groups with fewer than two copied members are dropped.
 */
export function remapGroups(items: Item[]): void {
  const count = new Map<string, number>();
  for (const it of items) for (const g of it.groups ?? []) count.set(g, (count.get(g) ?? 0) + 1);
  const fresh = new Map<string, string>();
  for (const [g, n] of count) if (n >= 2) fresh.set(g, nanoid(10));
  for (const it of items) {
    if (!it.groups) continue;
    const next = it.groups.flatMap((g) => (fresh.has(g) ? [fresh.get(g)!] : []));
    if (next.length) it.groups = next;
    else delete it.groups;
  }
}
