import { applyPatches, enablePatches, produceWithPatches, type Patch } from 'immer';
import type { Doc } from './types';

enablePatches();

const MAX_ENTRIES = 200;
/** Edits sharing a merge key within this window collapse into one undo step. */
const MERGE_WINDOW_MS = 1000;

export interface Entry {
  patches: Patch[];
  inverse: Patch[];
  key?: string;
  time: number;
}

export interface History {
  past: Entry[];
  future: Entry[];
  /** Open transaction (e.g. a drag in progress); its edits become one undo step. */
  batch: Entry | null;
}

export const emptyHistory = (): History => ({ past: [], future: [], batch: null });

const push = (h: History, e: Entry): History => ({
  past: [...h.past, e].slice(-MAX_ENTRIES),
  future: [],
  batch: null,
});

export function change(
  doc: Doc,
  h: History,
  recipe: (d: Doc) => void,
  key?: string,
  now = Date.now(),
): [Doc, History] {
  const [next, patches, inverse] = produceWithPatches(doc, recipe);
  if (patches.length === 0) return [doc, h];
  if (h.batch) {
    const batch = {
      ...h.batch,
      patches: [...h.batch.patches, ...patches],
      inverse: [...inverse, ...h.batch.inverse],
    };
    return [next, { ...h, batch }];
  }
  const last = h.past[h.past.length - 1];
  if (key && last?.key === key && now - last.time < MERGE_WINDOW_MS) {
    const merged: Entry = {
      key,
      time: now,
      patches: [...last.patches, ...patches],
      inverse: [...inverse, ...last.inverse],
    };
    return [next, { past: [...h.past.slice(0, -1), merged], future: [], batch: null }];
  }
  return [next, push(h, { patches, inverse, key, time: now })];
}

export const beginBatch = (h: History): History =>
  h.batch ? h : { ...h, batch: { patches: [], inverse: [], time: Date.now() } };

export function endBatch(h: History): History {
  if (!h.batch) return h;
  if (h.batch.patches.length === 0) return { ...h, batch: null };
  return push(h, h.batch);
}

/** Reverts everything done in the open batch and discards it. */
export function abortBatch(doc: Doc, h: History): [Doc, History] {
  if (!h.batch) return [doc, h];
  return [applyPatches(doc, h.batch.inverse), { ...h, batch: null }];
}

export function undo(doc: Doc, h: History): [Doc, History] {
  const e = h.past[h.past.length - 1];
  if (!e) return [doc, h];
  return [applyPatches(doc, e.inverse), { past: h.past.slice(0, -1), future: [...h.future, e], batch: null }];
}

export function redo(doc: Doc, h: History): [Doc, History] {
  const e = h.future[h.future.length - 1];
  if (!e) return [doc, h];
  return [applyPatches(doc, e.patches), { past: [...h.past, e], future: h.future.slice(0, -1), batch: null }];
}
