import type { Doc } from '../model/types';

const STORAGE_KEY = 'clearchart:doc';

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
  return {
    version: 1,
    title: typeof raw.title === 'string' ? raw.title : 'Untitled diagram',
    items,
    order: raw.order.filter((id) => items[id]),
  };
}

export function loadAutosave(): Doc | null {
  try {
    const json = localStorage.getItem(STORAGE_KEY);
    return json ? parseDoc(json) : null;
  } catch {
    return null;
  }
}

export function saveAutosave(doc: Doc): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
  } catch {
    // Storage may be full or blocked; autosave is best-effort.
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

export function openDocFile(): Promise<Doc | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try {
        resolve(parseDoc(await file.text()));
      } catch (err) {
        reject(err);
      }
    };
    input.click();
  });
}
