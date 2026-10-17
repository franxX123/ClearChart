import type { Doc, NodeComponent } from '../model/types';
import { isNodeComponent } from '../templates/persist';

/** Autosave layout: an index of open tabs, plus one key per tab's document. */
const TABS_KEY = 'clearchart:tabs';
const tabDocKey = (id: string) => `clearchart:doc:${id}`;
/** Where the single-diagram version autosaved; moved into the first tab on load. */
const LEGACY_KEY = 'clearchart:doc';

export const serializeDoc = (doc: Doc) => JSON.stringify(doc, null, 2);

/** Parses a saved document, throwing if it isn't a ClearChart file. */
export function parseDoc(json: string): Doc {
  const raw = JSON.parse(json) as Partial<Doc>;
  if (raw?.version !== 1 || typeof raw.items !== 'object' || raw.items === null || !Array.isArray(raw.order)) {
    throw new Error('Not a ClearChart document');
  }
  const items = raw.items;
  for (const id of raw.order) {
    const it = items[id];
    if (!it || (it.type !== 'shape' && it.type !== 'connector')) {
      throw new Error(`Invalid item "${id}"`);
    }
  }
  const doc: Doc = {
    version: 1,
    title: typeof raw.title === 'string' ? raw.title : 'Untitled diagram',
    items,
    order: raw.order.filter((id) => items[id]),
  };
  if (raw.components && typeof raw.components === 'object') {
    doc.components = Object.fromEntries(
      Object.entries(raw.components).filter(([, c]) => isNodeComponent(c)),
    ) as Record<string, NodeComponent>;
  }
  for (const id of doc.order) {
    const it = items[id];
    if ('groups' in it && !(Array.isArray(it.groups) && it.groups.length && it.groups.every((g) => typeof g === 'string'))) {
      delete it.groups;
    }
    // A component whose definition is missing becomes a plain box rather than a broken item.
    if (it.type === 'shape' && it.kind === 'component' && !(it.componentId && doc.components?.[it.componentId])) {
      it.kind = 'rect';
      delete it.componentId;
    }
  }
  return doc;
}

export interface TabIndex {
  tabs: string[];
  active: string;
}

/** Parses the saved tab index, or returns null if it's missing or malformed. */
export function parseTabIndex(json: string | null): TabIndex | null {
  try {
    const raw = JSON.parse(json ?? '') as { version?: unknown; tabs?: unknown; active?: unknown };
    if (raw?.version !== 1 || !Array.isArray(raw.tabs)) return null;
    const tabs = [...new Set(raw.tabs.filter((t): t is string => typeof t === 'string' && t.length > 0))];
    if (tabs.length === 0) return null;
    return { tabs, active: typeof raw.active === 'string' && tabs.includes(raw.active) ? raw.active : tabs[0] };
  } catch {
    return null;
  }
}

export const serializeTabIndex = (ix: TabIndex) => JSON.stringify({ version: 1, ...ix });

export interface SavedWorkspace {
  tabs: { id: string; doc: Doc }[];
  active: string;
}

const readDoc = (key: string): Doc | null => {
  try {
    const json = localStorage.getItem(key);
    return json ? parseDoc(json) : null;
  } catch {
    return null;
  }
};

/**
 * The tabs autosaved in this browser; unreadable ones are skipped. A diagram autosaved by the
 * single-diagram version comes back as one tab with id `newId`. Null when nothing is saved.
 */
export function loadWorkspace(newId: string): SavedWorkspace | null {
  try {
    const ix = parseTabIndex(localStorage.getItem(TABS_KEY));
    const tabs = (ix?.tabs ?? []).flatMap((id) => {
      const doc = readDoc(tabDocKey(id));
      return doc ? [{ id, doc }] : [];
    });
    if (tabs.length) return { tabs, active: tabs.some((t) => t.id === ix!.active) ? ix!.active : tabs[0].id };
    const legacy = readDoc(LEGACY_KEY);
    return legacy ? { tabs: [{ id: newId, doc: legacy }], active: newId } : null;
  } catch {
    return null;
  }
}

/** Saves one tab's document; returns false if storage is full or blocked (autosave is best-effort). */
export function saveTabDoc(id: string, doc: Doc): boolean {
  try {
    localStorage.setItem(tabDocKey(id), JSON.stringify(doc));
    return true;
  } catch {
    return false;
  }
}

export const hasTabDoc = (id: string) => {
  try {
    return localStorage.getItem(tabDocKey(id)) !== null;
  } catch {
    return false;
  }
};

export function removeTabDoc(id: string): void {
  try {
    localStorage.removeItem(tabDocKey(id));
  } catch {
    // Best-effort.
  }
}

/** Saves the tab index. Once it is saved, the single-diagram autosave has been migrated. */
export function saveTabIndex(ix: TabIndex): void {
  try {
    localStorage.setItem(TABS_KEY, serializeTabIndex(ix));
    if (ix.tabs.every(hasTabDoc)) localStorage.removeItem(LEGACY_KEY);
  } catch {
    // Best-effort.
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const fileSafe = (title: string) => title.trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-') || 'diagram';

export function saveDocFile(doc: Doc): void {
  downloadBlob(new Blob([serializeDoc(doc)], { type: 'application/json' }), `${fileSafe(doc.title)}.clearchart.json`);
}

/** Opens the browser's file picker; resolves with the chosen file, or null if none was picked. */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

export const JSON_FILES = '.json,application/json';

export async function openDocFile(): Promise<Doc | null> {
  const file = await pickFile(JSON_FILES);
  return file ? parseDoc(await file.text()) : null;
}
