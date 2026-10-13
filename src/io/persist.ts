import { nanoid } from 'nanoid';
import { defaultTemplates } from '../model/doc';
import { builtInAssets } from '../shapes/deviceIcons';
import { makeLayer } from '../model/page';
import type { Doc, Item, Layer, LineTemplate, NodeTemplate, Page, Templates } from '../model/types';

const STORAGE_KEY = 'clearchart:doc';

export const serializeDoc = (doc: Doc) => JSON.stringify(doc, null, 2);

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback);

/** Validates a page's items/order (shared by v1 docs, which are a single page's worth). */
function parseItems(raw: Json): Pick<Page, 'items' | 'order'> {
  if (!isObj(raw.items) || !Array.isArray(raw.order)) throw new Error('Not a ClearChart document');
  const items = raw.items as Record<string, Item>;
  const order = raw.order as string[];
  for (const id of order) {
    const it = items[id];
    if (!isObj(it) || (it.type !== 'shape' && it.type !== 'connector')) {
      throw new Error(`Invalid item "${id}"`);
    }
  }
  return { items, order: order.filter((id) => items[id]) };
}

function parseLayers(raw: unknown): Layer[] {
  const layers = Array.isArray(raw)
    ? raw.filter(isObj).map((l, i) => ({
        id: str(l.id, nanoid(10)),
        name: str(l.name, `Layer ${i + 1}`),
        visible: l.visible !== false,
        locked: l.locked === true,
      }))
    : [];
  return layers.length ? layers : [makeLayer()];
}

function parsePage(raw: unknown, index: number): Page {
  if (!isObj(raw)) throw new Error('Not a ClearChart document');
  return {
    id: str(raw.id, nanoid(10)),
    name: str(raw.name, `Page ${index + 1}`),
    ...parseItems(raw),
    layers: parseLayers(raw.layers),
  };
}

/**
 * Parses a saved document, throwing if it isn't a ClearChart file. Version 1 files (a single
 * page's items/order at the top level) are migrated to version 2.
 */
export function parseDoc(json: string): Doc {
  const raw = JSON.parse(json) as unknown;
  if (!isObj(raw)) throw new Error('Not a ClearChart document');
  const title = str(raw.title, 'Untitled diagram');
  if (raw.version === 1) {
    const page: Page = { id: nanoid(10), name: 'Page 1', ...parseItems(raw), layers: [makeLayer()] };
    return { version: 2, title, pages: [page], templates: defaultTemplates(), assets: builtInAssets() };
  }
  if (raw.version !== 2 || !Array.isArray(raw.pages) || raw.pages.length === 0) {
    throw new Error('Not a ClearChart document');
  }
  const doc: Doc = { version: 2, title, pages: raw.pages.map(parsePage) };
  const assets = parseAssets(raw.assets);
  if (assets) doc.assets = assets;
  const templates = parseTemplates(raw.templates);
  if (templates) {
    doc.templates = templates;
  } else {
    // A document saved before templates existed starts with the built-in elements and their
    // pictures. (One whose templates were all deleted keeps an empty list, so they don't come back.)
    doc.templates = defaultTemplates();
    doc.assets = { ...builtInAssets(), ...doc.assets };
  }
  migrateDeviceFields(doc);
  migrateTextPosition(doc);
  return doc;
}

/**
 * Device text was first drawn below pictures (`textPosition: 'below'`); it now goes to their
 * right. Moves elements and shapes saved that way over.
 */
function migrateTextPosition(doc: Doc): void {
  const items: { textPosition?: string }[] = [
    ...(doc.templates?.nodes ?? []),
    ...doc.pages.flatMap((p) => p.order.map((id) => p.items[id] as { textPosition?: string })),
  ];
  for (const it of items) if (it.textPosition === 'below') it.textPosition = 'right';
}

/** Stored pictures: an object of data-URL strings (anything else is dropped). */
function parseAssets(raw: unknown): Record<string, string> | undefined {
  if (!isObj(raw)) return undefined;
  return Object.fromEntries(Object.entries(raw).filter((e): e is [string, string] => typeof e[1] === 'string'));
}

/** Device field names used by the first CSV import, and the column names that replaced them. */
const OLD_DEVICE_FIELDS: Record<string, string> = { name: 'hostName', ip: 'hostIP', platform: 'hostPlatform' };

/**
 * Early imports stored device fields as name / ip / platform; they're now named after the CSV
 * columns (hostName / hostIP / hostPlatform). Renames them on devices and in node-template
 * placeholders. The rendered text doesn't change, so nothing needs re-rendering.
 */
function migrateDeviceFields(doc: Doc): void {
  for (const t of doc.templates?.nodes ?? []) {
    if (typeof t.text !== 'string') continue;
    t.text = t.text.replace(/\{\s*(name|ip|platform)\s*\}/gi, (_, k: string) => `{${OLD_DEVICE_FIELDS[k.toLowerCase()]}}`);
  }
  for (const page of doc.pages) {
    for (const id of page.order) {
      const it = page.items[id];
      const data = it.type === 'shape' ? it.data : undefined;
      if (!data || 'hostName' in data || !('name' in data)) continue;
      for (const [from, to] of Object.entries(OLD_DEVICE_FIELDS)) {
        if (from in data) {
          data[to] = data[from];
          delete data[from];
        }
      }
    }
  }
}

/** Custom components, kept only if well-formed (a bad entry is dropped, not fatal). */
function parseTemplates(raw: unknown): Templates | undefined {
  if (!isObj(raw)) return undefined;
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((t) => isObj(t) && typeof t.id === 'string') : []);
  const out: Templates = {
    nodes: list(raw.nodes).filter((t) => isObj(t.style) && typeof t.kind === 'string') as unknown as NodeTemplate[],
    lines: list(raw.lines).filter((t) => isObj(t.style)) as unknown as LineTemplate[],
  };
  if (typeof raw.defaultNodeId === 'string') out.defaultNodeId = raw.defaultNodeId;
  return out;
}

export function loadAutosave(): Doc | null {
  try {
    const json = localStorage.getItem(STORAGE_KEY);
    return json ? parseDoc(json) : null;
  } catch {
    return null;
  }
}

/** Saves to browser storage. Returns false if it didn't fit (or storage is blocked). */
export function saveAutosave(doc: Doc): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
    return true;
  } catch {
    // Storage may be full (embedded pictures) or blocked; autosave is best-effort.
    return false;
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

/** Asks for a text file (e.g. a CSV) and reads it. Resolves null if the user cancels. */
export function openTextFile(accept: string): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try {
        resolve({ name: file.name, text: await file.text() });
      } catch (err) {
        reject(err);
      }
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
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
