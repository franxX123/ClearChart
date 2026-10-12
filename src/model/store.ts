import { nanoid } from 'nanoid';
import { create } from 'zustand';
import { docBounds, snapToGrid } from '../canvas/geometry';
import { connectorPoints } from '../connectors/routing';
import { loadAutosave } from '../io/persist';
import type { LibraryEntry } from '../shapes/library';
import { addItems, isConnector, isShape, makeConnector, makeShape, sampleDoc } from './doc';
import * as hist from './history';
import type { Connector, ConnectorStyle, Doc, Endpoint, Item, Point, ShapeStyle } from './types';

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;
const PASTE_OFFSET = 20;

interface State {
  doc: Doc;
  history: hist.History;
  selection: string[];
  viewport: Viewport;
  canvasSize: { w: number; h: number };
  editingId: string | null;
  showGrid: boolean;
  snapToGrid: boolean;
  clipboard: Item[] | null;

  update: (recipe: (d: Doc) => void, mergeKey?: string) => void;
  beginBatch: () => void;
  endBatch: () => void;
  abortBatch: () => void;
  undo: () => void;
  redo: () => void;

  setSelection: (ids: string[]) => void;
  selectAll: () => void;
  setViewport: (v: Viewport) => void;
  setCanvasSize: (w: number, h: number) => void;
  setEditing: (id: string | null) => void;
  toggleGrid: () => void;
  toggleSnap: () => void;

  addShape: (entry: LibraryEntry, center: Point) => string;
  addConnector: (source: Endpoint, target: Endpoint) => string;
  deleteSelection: () => void;
  nudge: (dx: number, dy: number) => void;
  copy: () => void;
  paste: () => void;
  duplicate: () => void;
  bringToFront: () => void;
  sendToBack: () => void;
  styleShapes: (style: Partial<ShapeStyle>, mergeKey?: string) => void;
  editConnectors: (patch: Partial<Pick<Connector, 'routing' | 'label'>> & { style?: Partial<ConnectorStyle> }, mergeKey?: string) => void;

  zoomBy: (factor: number, screenPoint?: Point) => void;
  zoomTo: (zoom: number) => void;
  fitToScreen: () => void;
  loadDoc: (doc: Doc) => void;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Copies items with new ids, shifted by `offset`. Connector ends whose shape wasn't copied become free. */
function cloneItems(doc: Doc, items: Item[], offset: number): Item[] {
  const ids = new Map(items.map((it) => [it.id, nanoid(10)]));
  return items.map((it): Item => {
    const copy = structuredClone(it) as Item;
    copy.id = ids.get(it.id)!;
    if (isShape(copy)) {
      copy.x += offset;
      copy.y += offset;
      return copy;
    }
    const pts = connectorPoints(doc, it as Connector);
    const remap = (ep: Endpoint, fallback: Point): Endpoint => {
      const newId = ep.shapeId && ids.get(ep.shapeId);
      if (newId) return { ...ep, shapeId: newId };
      return { x: fallback.x + offset, y: fallback.y + offset };
    };
    copy.source = remap(copy.source, pts[0]);
    copy.target = remap(copy.target, pts[pts.length - 1]);
    return copy;
  });
}

const selectedItems = (s: Pick<State, 'doc' | 'selection'>) =>
  s.doc.order.filter((id) => s.selection.includes(id)).map((id) => s.doc.items[id]);

export const useStore = create<State>()((set, get) => {
  const commit = (recipe: (d: Doc) => void, mergeKey?: string) => {
    const { doc, history } = get();
    const [next, h] = hist.change(doc, history, recipe, mergeKey);
    set({ doc: next, history: h });
  };

  const pasteItems = (items: Item[]) => {
    if (items.length === 0) return [];
    const copies = cloneItems(get().doc, items, PASTE_OFFSET);
    commit((d) => addItems(d, copies));
    set({ selection: copies.map((c) => c.id) });
    return copies;
  };

  return {
    doc: loadAutosave() ?? sampleDoc(),
    history: hist.emptyHistory(),
    selection: [],
    viewport: { x: 40, y: 20, zoom: 1 },
    canvasSize: { w: 800, h: 600 },
    editingId: null,
    showGrid: true,
    snapToGrid: true,
    clipboard: null,

    update: commit,
    beginBatch: () => set({ history: hist.beginBatch(get().history) }),
    endBatch: () => set({ history: hist.endBatch(get().history) }),
    abortBatch: () => {
      const [doc, history] = hist.abortBatch(get().doc, get().history);
      set({ doc, history });
    },
    undo: () => {
      const s = get();
      const [doc, history] = hist.undo(s.doc, hist.endBatch(s.history));
      set({ doc, history, editingId: null, selection: s.selection.filter((id) => doc.items[id]) });
    },
    redo: () => {
      const s = get();
      const [doc, history] = hist.redo(s.doc, hist.endBatch(s.history));
      set({ doc, history, editingId: null, selection: s.selection.filter((id) => doc.items[id]) });
    },

    setSelection: (ids) => set({ selection: ids }),
    selectAll: () => set({ selection: [...get().doc.order] }),
    setViewport: (viewport) => set({ viewport }),
    setCanvasSize: (w, h) => set({ canvasSize: { w, h } }),
    setEditing: (editingId) => set({ editingId }),
    toggleGrid: () => set({ showGrid: !get().showGrid }),
    toggleSnap: () => set({ snapToGrid: !get().snapToGrid }),

    addShape: (entry, center) => {
      let x = center.x - entry.w / 2;
      let y = center.y - entry.h / 2;
      if (get().snapToGrid) {
        x = snapToGrid(x);
        y = snapToGrid(y);
      }
      const shape = makeShape(entry.kind, { x, y, w: entry.w, h: entry.h }, entry.text ?? '', entry.style);
      commit((d) => addItems(d, [shape]));
      set({ selection: [shape.id] });
      return shape.id;
    },

    addConnector: (source, target) => {
      const c = makeConnector(source, target);
      commit((d) => addItems(d, [c]));
      return c.id;
    },

    deleteSelection: () => {
      const { doc, selection } = get();
      if (selection.length === 0) return;
      const doomed = new Set(selection);
      commit((d) => {
        // Lines attached to deleted shapes stay, with their ends left where they were.
        for (const id of d.order) {
          const c = doc.items[id];
          if (!isConnector(c) || doomed.has(id)) continue;
          const pts = connectorPoints(doc, c);
          const live = d.items[id] as Connector;
          if (c.source.shapeId && doomed.has(c.source.shapeId)) live.source = { x: pts[0].x, y: pts[0].y };
          const end = pts[pts.length - 1];
          if (c.target.shapeId && doomed.has(c.target.shapeId)) live.target = { x: end.x, y: end.y };
        }
        for (const id of doomed) delete d.items[id];
        d.order = d.order.filter((id) => !doomed.has(id));
      });
      set({ selection: [], editingId: null });
    },

    nudge: (dx, dy) => {
      const ids = new Set(get().selection);
      if (ids.size === 0) return;
      commit((d) => {
        for (const id of ids) {
          const it = d.items[id];
          if (isShape(it)) {
            it.x += dx;
            it.y += dy;
          } else if (isConnector(it)) {
            for (const ep of [it.source, it.target]) {
              if (!ep.shapeId) {
                ep.x += dx;
                ep.y += dy;
              }
            }
          }
        }
      }, 'nudge');
    },

    copy: () => {
      const items = selectedItems(get());
      if (items.length) set({ clipboard: items });
    },
    paste: () => {
      const clip = get().clipboard;
      if (!clip) return;
      // Re-copy the pasted items so the next paste lands offset from this one.
      set({ clipboard: pasteItems(clip) });
    },
    duplicate: () => {
      pasteItems(selectedItems(get()));
    },

    bringToFront: () => {
      const sel = new Set(get().selection);
      commit((d) => {
        d.order = [...d.order.filter((id) => !sel.has(id)), ...d.order.filter((id) => sel.has(id))];
      });
    },
    sendToBack: () => {
      const sel = new Set(get().selection);
      commit((d) => {
        d.order = [...d.order.filter((id) => sel.has(id)), ...d.order.filter((id) => !sel.has(id))];
      });
    },

    styleShapes: (style, mergeKey) => {
      const sel = get().selection;
      commit((d) => {
        for (const id of sel) {
          const it = d.items[id];
          if (isShape(it)) Object.assign(it.style, style);
        }
      }, mergeKey);
    },
    editConnectors: ({ style, ...rest }, mergeKey) => {
      const sel = get().selection;
      commit((d) => {
        for (const id of sel) {
          const it = d.items[id];
          if (!isConnector(it)) continue;
          Object.assign(it, rest);
          if (style) Object.assign(it.style, style);
        }
      }, mergeKey);
    },

    zoomBy: (factor, screenPoint) => {
      const { viewport: vp, canvasSize } = get();
      const sp = screenPoint ?? { x: canvasSize.w / 2, y: canvasSize.h / 2 };
      const zoom = clamp(vp.zoom * factor, MIN_ZOOM, MAX_ZOOM);
      const wx = (sp.x - vp.x) / vp.zoom;
      const wy = (sp.y - vp.y) / vp.zoom;
      set({ viewport: { zoom, x: sp.x - wx * zoom, y: sp.y - wy * zoom } });
    },
    zoomTo: (zoom) => get().zoomBy(zoom / get().viewport.zoom),
    fitToScreen: () => {
      const { doc, canvasSize } = get();
      const b = docBounds(doc);
      if (!b) {
        set({ viewport: { x: 40, y: 20, zoom: 1 } });
        return;
      }
      const pad = 40;
      const zoom = clamp(
        Math.min((canvasSize.w - pad * 2) / Math.max(b.w, 1), (canvasSize.h - pad * 2) / Math.max(b.h, 1), 2),
        MIN_ZOOM,
        MAX_ZOOM,
      );
      set({
        viewport: {
          zoom,
          x: (canvasSize.w - b.w * zoom) / 2 - b.x * zoom,
          y: (canvasSize.h - b.h * zoom) / 2 - b.y * zoom,
        },
      });
    },
    loadDoc: (doc) => {
      set({ doc, history: hist.emptyHistory(), selection: [], editingId: null });
      get().fitToScreen();
    },
  };
});

