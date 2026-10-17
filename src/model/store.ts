import { nanoid } from 'nanoid';
import { create } from 'zustand';
import { boundsOfPoints, docBounds, GRID, snapToGrid, unionRects } from '../canvas/geometry';
import { connectorPoints } from '../connectors/routing';
import { loadWorkspace } from '../io/persist';
import type { ShapeEntry } from '../shapes/library';
import type { ImportPlan } from '../templates/graph';
import { fillPlaceholders, placePart } from '../templates/rules';
import { addItems, emptyDoc, isConnector, isShape, makeConnector, makeShape, sampleDoc } from './doc';
import { applyGroup, applyUngroup, expandToGroups, groupUnits, hasGroup, remapGroups } from './groups';
import * as hist from './history';
import type { Connector, ConnectorStyle, Doc, Endpoint, Item, NodeComponent, Point, Rect, Shape, ShapeStyle } from './types';

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;
const PASTE_OFFSET = 20;
const DEFAULT_VIEWPORT: Viewport = { x: 40, y: 20, zoom: 1 };

/** A tab that isn't showing. `viewport: null` means fit to screen when it's next shown. */
export interface TabState {
  doc: Doc;
  history: hist.History;
  selection: string[];
  viewport: Viewport | null;
}

/** Copied items, with the definitions of any components among them so they paste into any tab. */
export interface Clipboard {
  items: Item[];
  components: Record<string, NodeComponent>;
}

interface State {
  // The active tab. Every editing action works on these; other tabs wait in `parked`.
  doc: Doc;
  history: hist.History;
  selection: string[];
  viewport: Viewport;
  editingId: string | null;

  /** Tab ids, in display order. */
  tabs: string[];
  activeTab: string;
  parked: Record<string, TabState>;

  canvasSize: { w: number; h: number };
  showGrid: boolean;
  snapToGrid: boolean;
  /** Shared by all tabs. */
  clipboard: Clipboard | null;

  /** Opens a new tab (empty, or showing `doc`) next to the active one and switches to it. */
  newTab: (doc?: Doc) => string;
  switchTab: (id: string) => void;
  /** Closes a tab; closing the last one leaves a fresh empty tab. */
  closeTab: (id: string) => void;

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

  addShape: (entry: ShapeEntry, center: Point) => string;
  /** Adds a free, straight line with an end arrow, `length` long, centered on `center`, and selects it. */
  addLine: (center: Point, length?: number) => string;
  addImage: (src: string, size: { w: number; h: number }, center: Point) => string;
  /** Places a component instance; its definition is copied into (or refreshed in) `doc.components`. */
  addComponent: (comp: NodeComponent, center: Point) => string;
  /** Adds an import's shapes, lines and component definitions as one undo step. */
  importGraph: (plan: ImportPlan) => void;
  /** Replaces a component instance with its parts as ordinary shapes. */
  breakApart: (id: string) => void;
  addConnector: (source: Endpoint, target: Endpoint) => string;
  deleteSelection: () => void;
  nudge: (dx: number, dy: number) => void;
  copy: () => void;
  /** Pastes 20 px from the last paste, or centered on `at` (e.g. where the context menu opened). */
  paste: (at?: Point) => void;
  duplicate: () => void;
  /** Groups the selection (whole groups included) into a new group. Needs two or more units. */
  group: () => void;
  /** Removes the outermost group of the selected items. */
  ungroup: () => void;
  bringToFront: () => void;
  sendToBack: () => void;
  styleShapes: (style: Partial<ShapeStyle>, mergeKey?: string) => void;
  /** Like `styleShapes`, for selected component instances (whose look otherwise comes from the template). */
  styleComponents: (style: Partial<ShapeStyle>, mergeKey?: string) => void;
  editConnectors: (
    patch: Partial<Pick<Connector, 'routing' | 'label' | 'sourceLabel' | 'targetLabel'>> & { style?: Partial<ConnectorStyle> },
    mergeKey?: string,
  ) => void;
  setShapeData: (id: string, field: string, value: string) => void;

  zoomBy: (factor: number, screenPoint?: Point) => void;
  zoomTo: (zoom: number) => void;
  fitToScreen: () => void;
  loadDoc: (doc: Doc) => void;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Copies `items` for the clipboard. Line ends attached to shapes outside the set become free
 * points where they're drawn, so the copy doesn't depend on the source doc (or tab).
 */
function snapshot(doc: Doc, items: Item[]): Clipboard {
  const ids = new Set(items.map((it) => it.id));
  const components: Record<string, NodeComponent> = {};
  const copies = items.map((it): Item => {
    const copy = structuredClone(it) as Item;
    if (isShape(copy)) {
      const def = copy.componentId ? doc.components?.[copy.componentId] : undefined;
      if (def) components[def.id] = structuredClone(def);
      return copy;
    }
    const pts = connectorPoints(doc, it as Connector);
    const end = pts[pts.length - 1];
    if (copy.source.shapeId && !ids.has(copy.source.shapeId)) copy.source = { x: pts[0].x, y: pts[0].y };
    if (copy.target.shapeId && !ids.has(copy.target.shapeId)) copy.target = { x: end.x, y: end.y };
    return copy;
  });
  return { items: copies, components };
}

/** Copies clipboard items with new ids (and new group ids), shifted by (dx, dy). */
function cloneItems(items: Item[], dx: number, dy: number): Item[] {
  const ids = new Map(items.map((it) => [it.id, nanoid(10)]));
  const copies = items.map((it): Item => {
    const copy = structuredClone(it) as Item;
    copy.id = ids.get(it.id)!;
    if (isShape(copy)) {
      copy.x += dx;
      copy.y += dy;
      return copy;
    }
    for (const ep of [copy.source, copy.target]) {
      const newId = ep.shapeId && ids.get(ep.shapeId);
      if (newId) {
        ep.shapeId = newId;
      } else {
        delete ep.shapeId;
        ep.x += dx;
        ep.y += dy;
      }
    }
    return copy;
  });
  remapGroups(copies);
  return copies;
}

/** Bounds of clipboard items: shapes plus free line ends (attached ends follow their shapes). */
function clipBounds(items: Item[]) {
  const rects = items.filter(isShape) as Rect[];
  const free = items.filter(isConnector).flatMap((c) => [c.source, c.target].filter((ep) => !ep.shapeId));
  const pts = boundsOfPoints(free);
  return unionRects(pts ? [...rects, pts] : rects);
}

/** Frees connector ends attached to shapes in `doomed`, leaving them where they were drawn. */
function detachFrom(doc: Doc, draft: Doc, doomed: Set<string>): void {
  for (const id of draft.order) {
    const c = doc.items[id];
    if (!isConnector(c) || doomed.has(id)) continue;
    const pts = connectorPoints(doc, c);
    const live = draft.items[id] as Connector;
    if (c.source.shapeId && doomed.has(c.source.shapeId)) live.source = { x: pts[0].x, y: pts[0].y };
    const end = pts[pts.length - 1];
    if (c.target.shapeId && doomed.has(c.target.shapeId)) live.target = { x: end.x, y: end.y };
  }
}

/** Shapes that are drawn from data rather than edited as text in place. */
const NOT_TEXT_EDITABLE = new Set(['image', 'component']);

const selectedItems = (s: Pick<State, 'doc' | 'selection'>) =>
  s.doc.order.filter((id) => s.selection.includes(id)).map((id) => s.doc.items[id]);

export const useStore = create<State>()((set, get) => {
  const commit = (recipe: (d: Doc) => void, mergeKey?: string) => {
    const { doc, history } = get();
    const [next, h] = hist.change(doc, history, recipe, mergeKey);
    set({ doc: next, history: h });
  };

  /** Centers `shape` on `center` (snapped to the grid if enabled), adds it and selects it. */
  const placeShape = (shape: Shape, center: Point, recipe?: (d: Doc) => void) => {
    shape.x = center.x - shape.w / 2;
    shape.y = center.y - shape.h / 2;
    if (get().snapToGrid) {
      shape.x = snapToGrid(shape.x);
      shape.y = snapToGrid(shape.y);
    }
    commit((d) => {
      recipe?.(d);
      addItems(d, [shape]);
    });
    set({ selection: [shape.id] });
    return shape.id;
  };

  const pasteItems = (clip: Clipboard, dx: number, dy: number): Clipboard | null => {
    if (clip.items.length === 0) return null;
    const copies = cloneItems(clip.items, dx, dy);
    const defs = structuredClone(clip.components);
    commit((d) => {
      // Pasting into another tab brings the definitions of any components along.
      for (const def of Object.values(defs)) if (!d.components?.[def.id]) (d.components ??= {})[def.id] = def;
      addItems(d, copies);
    });
    set({ selection: copies.map((c) => c.id) });
    return { items: copies, components: clip.components };
  };

  /** The active tab's state, to put in `parked` when another tab is shown. */
  const park = (): TabState => {
    const s = get();
    return { doc: s.doc, history: hist.endBatch(s.history), selection: s.selection, viewport: s.viewport };
  };

  /** Makes `id` the active tab with `tab`'s state; the caller has dealt with the previous one. */
  const show = (id: string, tab: TabState, parked: Record<string, TabState>, tabs = get().tabs) => {
    set({
      tabs,
      activeTab: id,
      parked,
      doc: tab.doc,
      history: tab.history,
      selection: tab.selection,
      viewport: tab.viewport ?? get().viewport,
      editingId: null,
    });
    if (!tab.viewport) get().fitToScreen();
  };

  const fresh = (doc: Doc = emptyDoc()): TabState => ({ doc, history: hist.emptyHistory(), selection: [], viewport: null });

  const firstTab = nanoid(8);
  const saved = loadWorkspace(firstTab) ?? { tabs: [{ id: firstTab, doc: sampleDoc() }], active: firstTab };
  const activeDoc = saved.tabs.find((t) => t.id === saved.active)!.doc;

  return {
    doc: activeDoc,
    history: hist.emptyHistory(),
    selection: [],
    viewport: DEFAULT_VIEWPORT,
    editingId: null,
    tabs: saved.tabs.map((t) => t.id),
    activeTab: saved.active,
    parked: Object.fromEntries(saved.tabs.filter((t) => t.id !== saved.active).map((t) => [t.id, fresh(t.doc)])),
    canvasSize: { w: 800, h: 600 },
    showGrid: true,
    snapToGrid: true,
    clipboard: null,

    newTab: (doc) => {
      const { tabs, activeTab, parked } = get();
      const id = nanoid(8);
      const at = tabs.indexOf(activeTab) + 1;
      show(id, fresh(doc), { ...parked, [activeTab]: park() }, [...tabs.slice(0, at), id, ...tabs.slice(at)]);
      return id;
    },
    switchTab: (id) => {
      const { activeTab, parked } = get();
      const target = parked[id];
      if (id === activeTab || !target) return;
      const { [id]: _shown, ...rest } = parked;
      show(id, target, { ...rest, [activeTab]: park() });
    },
    closeTab: (id) => {
      const { tabs, activeTab, parked } = get();
      if (!tabs.includes(id)) return;
      const remaining = tabs.filter((t) => t !== id);
      const { [id]: _closed, ...rest } = parked;
      if (id !== activeTab) {
        set({ tabs: remaining, parked: rest });
        return;
      }
      if (remaining.length === 0) {
        const blankId = nanoid(8);
        show(blankId, fresh(), {}, [blankId]);
        return;
      }
      const i = tabs.indexOf(id);
      const next = tabs[i + 1] ?? tabs[i - 1];
      const { [next]: target, ...others } = rest;
      show(next, target, others, remaining);
    },

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
    setEditing: (editingId) => {
      const it = editingId ? get().doc.items[editingId] : undefined;
      if (isShape(it) && NOT_TEXT_EDITABLE.has(it.kind)) return;
      set({ editingId });
    },
    toggleGrid: () => set({ showGrid: !get().showGrid }),
    toggleSnap: () => set({ snapToGrid: !get().snapToGrid }),

    addShape: (entry, center) =>
      placeShape(makeShape(entry.kind, { x: 0, y: 0, w: entry.w, h: entry.h }, entry.text ?? '', entry.style), center),

    addLine: (center, length = 120) => {
      const g = (v: number) => (get().snapToGrid ? snapToGrid(v) : v);
      const y = g(center.y);
      const x0 = g(center.x - length / 2);
      const c = makeConnector({ x: x0, y }, { x: x0 + length, y });
      c.routing = 'straight';
      commit((d) => addItems(d, [c]));
      set({ selection: [c.id] });
      return c.id;
    },

    addImage: (src, size, center) => {
      const shape = makeShape('image', { x: 0, y: 0, ...size }, '', { fill: 'none', stroke: 'none' });
      shape.src = src;
      return placeShape(shape, center);
    },

    addComponent: (comp, center) => {
      const shape = makeShape('component', { x: 0, y: 0, w: comp.w, h: comp.h }, '', { fill: 'none', stroke: 'none' });
      shape.componentId = comp.id;
      const def = structuredClone(comp);
      return placeShape(shape, center, (d) => {
        (d.components ??= {})[def.id] = def;
      });
    },

    importGraph: (plan) => {
      const items = [...plan.shapes, ...plan.connectors];
      if (items.length === 0) return;
      const defs = structuredClone(plan.components);
      commit((d) => {
        Object.assign((d.components ??= {}), defs);
        // New lines go to the back so their ends tuck under the shapes.
        for (const c of plan.connectors) d.items[c.id] = c;
        d.order.unshift(...plan.connectors.map((c) => c.id));
        addItems(d, plan.shapes);
      });
      set({ selection: items.map((it) => it.id), editingId: null });
      get().fitToScreen();
    },

    breakApart: (id) => {
      const { doc } = get();
      const s = doc.items[id];
      const def = isShape(s) && s.componentId ? doc.components?.[s.componentId] : undefined;
      if (!isShape(s) || !def) return;
      const sx = s.w / def.w;
      const sy = s.h / def.h;
      const parts = def.parts.map((p) => {
        const placed = placePart(p, s.x, s.y, sx, sy);
        const shape = makeShape(placed.kind, placed, fillPlaceholders(placed.text, s.data), placed.style);
        if (placed.src) shape.src = placed.src;
        // The parts stay in whatever groups the component was in.
        if (s.groups) shape.groups = [...s.groups];
        return shape;
      });
      commit((d) => {
        detachFrom(doc, d, new Set([id]));
        const at = d.order.indexOf(id);
        delete d.items[id];
        for (const p of parts) d.items[p.id] = p;
        d.order.splice(at, 1, ...parts.map((p) => p.id));
      });
      set({ selection: parts.map((p) => p.id), editingId: null });
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
        detachFrom(doc, d, doomed);
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
      if (items.length) set({ clipboard: snapshot(get().doc, items) });
    },
    paste: (at) => {
      const clip = get().clipboard;
      if (!clip) return;
      let dx = PASTE_OFFSET;
      let dy = PASTE_OFFSET;
      const b = at && clipBounds(clip.items);
      if (at && b) {
        dx = at.x - (b.x + b.w / 2);
        dy = at.y - (b.y + b.h / 2);
        // Keep shapes on the grid they were drawn on.
        if (get().snapToGrid) {
          dx = Math.round(dx / GRID) * GRID;
          dy = Math.round(dy / GRID) * GRID;
        }
      }
      // Keep the pasted copies so the next paste lands offset from this one.
      const pasted = pasteItems(clip, dx, dy);
      if (pasted) set({ clipboard: pasted });
    },
    duplicate: () => {
      pasteItems(snapshot(get().doc, selectedItems(get())), PASTE_OFFSET, PASTE_OFFSET);
    },
    group: () => {
      const { doc, selection } = get();
      if (groupUnits(doc, selection) < 2) return;
      const ids = expandToGroups(doc, selection);
      const gid = nanoid(10);
      commit((d) => applyGroup(d, ids, gid));
      set({ selection: ids });
    },
    ungroup: () => {
      const { doc, selection } = get();
      if (!hasGroup(doc, selection)) return;
      const ids = expandToGroups(doc, selection);
      commit((d) => applyUngroup(d, selection));
      set({ selection: ids });
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
    styleComponents: (style, mergeKey) => {
      const sel = get().selection;
      commit((d) => {
        for (const id of sel) {
          const it = d.items[id];
          if (isShape(it) && it.kind === 'component') Object.assign(it.style, style);
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
    setShapeData: (id, field, value) => {
      commit((d) => {
        const it = d.items[id];
        if (isShape(it)) it.data = { ...it.data, [field]: value };
      }, `data:${id}:${field}`);
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
        set({ viewport: DEFAULT_VIEWPORT });
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

/** World point at the center of the visible canvas, where click-to-add places things. */
export function viewCenter(): Point {
  const { viewport: vp, canvasSize } = useStore.getState();
  return { x: (canvasSize.w / 2 - vp.x) / vp.zoom, y: (canvasSize.h / 2 - vp.y) / vp.zoom };
}
