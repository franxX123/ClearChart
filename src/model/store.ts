import { nanoid } from 'nanoid';
import { create } from 'zustand';
import { alignDeltas, distributeDeltas, type AlignMode } from '../canvas/arrange';
import { docBounds, itemBounds, snapToGrid, unionRects } from '../canvas/geometry';
import { normalizeAngle, shapeBox } from '../canvas/transform';
import { fitText, TEXT_PAD } from '../canvas/text';
import { connectorEnds, connectorPoints } from '../connectors/routing';
import { buildGraph, DEVICE_FIELDS } from '../import/links';
import { planImport, type ImportSummary } from '../import/plan';
import { parseCsv } from '../io/csv';
import { fitWithin } from '../io/image';
import { loadAutosave } from '../io/persist';
import type { LibraryEntry } from '../shapes/library';
import { builtInAssets } from '../shapes/deviceIcons';
import {
  addItems,
  DEFAULT_SHAPE_STYLE,
  DEVICE_FIELDS_TEXT,
  isConnector,
  isShape,
  makeConnector,
  makeShape,
  sampleDoc,
} from './doc';
import * as hist from './history';
import {
  clonePage,
  copyItems,
  groupUnits,
  isInteractive,
  layerById,
  layerOf,
  makeLayer,
  makePage,
  outerGroup,
  pageById,
  translateItems,
} from './page';
import {
  defaultTemplates,
  lineFromTemplate,
  nodeFromTemplate,
  renderLineText,
  renderNodeText,
  restyleLine,
  restyleNode,
  defaultNode,
  matchPlatform,
  rulesMatch,
  templateForPlatform,
  templateFromLine,
  templateFromShape,
} from './templates';
import type {
  Connector,
  ConnectorStyle,
  Doc,
  Endpoint,
  Item,
  Layer,
  LineTemplate,
  NodeTemplate,
  Page,
  Point,
  Rect,
  Shape,
  ShapeStyle,
  Templates,
} from './types';

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;
const PASTE_OFFSET = 20;
/** Largest side a newly added picture is shown at, in world px. */
const IMAGE_DISPLAY_MAX = 400;

/** What a press on the canvas does: select/move things, or draw an arrow. */
export type Tool = 'select' | 'arrow';
const HOME_VIEW: Viewport = { x: 40, y: 20, zoom: 1 };

interface State {
  doc: Doc;
  history: hist.History;
  /** Page shown on the canvas. Falls back to the first page if it no longer exists. */
  activePageId: string;
  /** Layer new items go on. Falls back to the page's top layer if it no longer exists. */
  activeLayerId: string;
  selection: string[];
  viewport: Viewport;
  /** Viewports of pages other than the active one, restored when switching back. */
  pageViews: Record<string, Viewport>;
  canvasSize: { w: number; h: number };
  editingId: string | null;
  /**
   * The text being edited belongs to a box just made by double-clicking the canvas. Its
   * creation sits in an open history batch until `commitText` keeps it (one undo step) or
   * drops it (left empty).
   */
  editingNew: boolean;
  showGrid: boolean;
  snapToGrid: boolean;
  tool: Tool;
  /** Keep the tool after drawing (otherwise it returns to select after one arrow). */
  toolLocked: boolean;
  /** The last autosave didn't fit in browser storage (e.g. large pictures). */
  autosaveFull: boolean;
  /** Line template the Arrow tool draws with (picked from the Custom panel); null = plain arrows. */
  arrowTemplateId: string | null;
  /** Copied items plus the page they came from (to resolve ends attached to uncopied shapes). */
  clipboard: { page: Page; items: Item[] } | null;

  update: (recipe: (d: Doc) => void, mergeKey?: string) => void;
  /** Like `update`, scoped to the active page. */
  updatePage: (recipe: (p: Page) => void, mergeKey?: string) => void;
  beginBatch: () => void;
  endBatch: () => void;
  abortBatch: () => void;
  undo: () => void;
  redo: () => void;

  setSelection: (ids: string[]) => void;
  selectAll: () => void;
  setViewport: (v: Viewport) => void;
  setCanvasSize: (w: number, h: number) => void;
  /** Starts editing an item's text (pictures have none, so they're ignored). */
  setEditing: (id: string | null, isNew?: boolean) => void;
  /** Finishes a text edit: saves `value` as the item's text (or label), or drops an empty new text box. */
  commitText: (id: string, value: string) => void;
  setAutosaveFull: (full: boolean) => void;
  toggleGrid: () => void;
  toggleSnap: () => void;
  setTool: (tool: Tool, locked?: boolean) => void;

  addShape: (entry: LibraryEntry, center: Point) => string;
  addConnector: (source: Endpoint, target: Endpoint) => string;
  /** Adds a picture (a data URL of the given pixel size) centered at `center`; returns its id. */
  addImage: (src: string, w: number, h: number, center: Point) => string;
  /** Adds an empty, auto-sized, left-aligned text box starting at `at` and starts editing it. */
  addTextBox: (at: Point) => string;
  deleteSelection: () => void;
  nudge: (dx: number, dy: number) => void;
  copy: () => void;
  /** Pastes 20 px from the copied items, or centered on `at` when given. */
  paste: (at?: Point) => void;
  duplicate: () => void;
  bringToFront: () => void;
  sendToBack: () => void;
  styleShapes: (style: Partial<ShapeStyle>, mergeKey?: string) => void;
  editConnectors: (
    patch: Partial<Pick<Connector, 'routing' | 'label' | 'startLabel' | 'endLabel'>> & { style?: Partial<ConnectorStyle> },
    mergeKey?: string,
  ) => void;

  rotateShapes: (degrees: number, mergeKey?: string) => void;
  group: () => void;
  ungroup: () => void;
  align: (mode: AlignMode) => void;
  distribute: (axis: 'x' | 'y') => void;

  setActivePage: (id: string) => void;
  addPage: () => void;
  duplicatePage: (id: string) => void;
  deletePage: (id: string) => void;
  renamePage: (id: string, name: string) => void;

  setActiveLayer: (id: string) => void;
  addLayer: () => void;
  deleteLayer: (id: string) => void;
  renameLayer: (id: string, name: string) => void;
  setLayerFlags: (id: string, flags: Partial<Pick<Layer, 'visible' | 'locked'>>) => void;
  /** Moves a layer up (+1, toward the front) or down (-1). */
  moveLayer: (id: string, delta: 1 | -1) => void;
  moveSelectionToLayer: (id: string) => void;

  /** What importing this links CSV onto the current page would do. Throws if the file can't be used. */
  previewImport: (csv: string, opts?: ImportOptions) => ImportSummary;
  /** Imports a links CSV onto the current page as one undo step. Throws if the file can't be used. */
  importLinks: (csv: string, opts?: ImportOptions) => ImportSummary;
  /** Saves a shape's or line's look and (placeholder) text as a new template; returns its id. */
  saveTemplate: (itemId: string, name: string) => string | null;
  /** Changes a template and re-applies it to every item made from it, on every page. */
  updateTemplate: (id: string, patch: Partial<NodeTemplate> | Partial<LineTemplate>) => void;
  /** Copies a templated item's look (not its text) into its template. */
  updateTemplateFromItem: (itemId: string) => void;
  /** Removes a template; items made from it keep their current look and data. */
  deleteTemplate: (id: string) => void;
  /** Adds a node from a template, with empty fields, centered at `center`. */
  addFromTemplate: (id: string, center: Point) => string | null;
  /** Picks a line template for the Arrow tool (and switches to it), or plain arrows with null. */
  setArrowTemplate: (id: string | null) => void;
  /** Sets one data field of an item and re-renders its text/labels from its template. */
  setItemData: (id: string, key: string, value: string, mergeKey?: string) => void;
  /** Detaches items from their templates; they keep their current look, text and data. */
  unlinkTemplate: (ids: string[]) => void;
  /** Adds a picture element from an uploaded picture (stored once), with the device fields beside it; returns its id. */
  addDeviceTemplate: (name: string, src: string, w: number, h: number) => string;
  /** Gives a node element a (new) picture; every node made from it updates. */
  setTemplatePicture: (id: string, src: string, w: number, h: number) => void;
  /** Turns a picture element back into a box with its text to its right. */
  removeTemplatePicture: (id: string) => void;
  /** Makes an element the one devices matching no platform rule use, and re-applies the rules. */
  setDefaultNodeTemplate: (id: string) => void;
  /** Adds the built-in device elements the document lacks, then re-applies the platform rules. */
  addBuiltInDevices: () => void;

  zoomBy: (factor: number, screenPoint?: Point) => void;
  zoomTo: (zoom: number) => void;
  fitToScreen: () => void;
  loadDoc: (doc: Doc) => void;
}

export interface ImportOptions {
  nodeTemplateId?: string;
  lineTemplateId?: string;
}

/** The page shown on the canvas. Use as a selector: `useStore(currentPage)`. */
export const currentPage = (s: Pick<State, 'doc' | 'activePageId'>): Page => pageById(s.doc, s.activePageId);

/** The layer new items go on. */
export const currentLayer = (s: Pick<State, 'doc' | 'activePageId' | 'activeLayerId'>): Layer =>
  layerById(currentPage(s), s.activeLayerId);

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Display size limit for an uploaded device picture, in px. */
const DEVICE_PICTURE_MAX = 96;

/**
 * Chooses each imported device's element by its platform (the best-matching rule), falling
 * back to `defaultId` (the import dialog's choice), the document's default, or the first.
 */
function devicePicker(t: Templates, defaultId?: string): (fields: Record<string, string>) => NodeTemplate {
  const fallback = defaultTemplates().nodes[0];
  return (fields) => templateForPlatform(t, fields[DEVICE_FIELDS.platform], defaultId) ?? fallback;
}

/** The line template an import uses: the requested one, else the first. */
function pickLine(t: Templates, opts: ImportOptions): LineTemplate {
  return t.lines.find((l) => l.id === opts.lineTemplateId) ?? t.lines[0] ?? defaultTemplates().lines[0];
}

/**
 * Platform rules applied live, in a doc draft. A linked device whose platform matches a rule
 * moves to the best-matching element (restyled in place). One whose platform matches no rule
 * keeps its element — it may have been placed by hand — unless `toDefault(device)` says the
 * reason it had that element is gone (it was on the old default, or a rule that matched it was
 * just removed); then it moves to the default element. Unlinked shapes and devices without a
 * platform are left alone.
 */
function reassignDevices(d: Doc, toDefault: (s: Shape) => boolean = () => false): void {
  const templates = d.templates;
  if (!templates?.nodes.length) return;
  const nodeIds = new Set(templates.nodes.map((t) => t.id));
  for (const page of d.pages) {
    for (const id of page.order) {
      const s = page.items[id];
      if (!isShape(s) || !s.templateId || !nodeIds.has(s.templateId)) continue;
      const platform = s.data?.[DEVICE_FIELDS.platform];
      if (!platform) continue;
      const best = matchPlatform(templates, platform) ?? (toDefault(s) ? defaultNode(templates) : undefined);
      if (!best || best.id === s.templateId) continue;
      s.templateId = best.id;
      restyleNode(s, best);
    }
  }
}

/** The element devices matching no rule get now (explicit, or the first element). */
const currentDefaultId = (d: Doc) => (d.templates ? defaultNode(d.templates)?.id : undefined);

/** In a doc draft: re-applies a node template to every item made from it, on every page. */
function restyleLinkedNodes(d: Doc, t: NodeTemplate): void {
  for (const page of d.pages) {
    for (const id of page.order) {
      const s = page.items[id];
      if (isShape(s) && s.templateId === t.id) restyleNode(s, t);
    }
  }
}

/** In a doc draft: drops stored pictures that no template or shape refers to any more. */
function pruneAssets(d: Doc): void {
  if (!d.assets) return;
  const used = new Set<string>();
  for (const t of d.templates?.nodes ?? []) if (t.image) used.add(t.image.asset);
  for (const page of d.pages) {
    for (const id of page.order) {
      const it = page.items[id];
      if (isShape(it) && it.image?.asset) used.add(it.image.asset);
    }
  }
  for (const key of Object.keys(d.assets)) if (!used.has(key)) delete d.assets[key];
}

/** In a doc draft: adds the built-in device elements (and pictures) the document doesn't have, by name. */
function addMissingBuiltIns(d: Doc): void {
  const def = defaultTemplates();
  const pictures = builtInAssets();
  d.templates ??= { nodes: [], lines: [] };
  d.assets ??= {};
  const have = new Set(d.templates.nodes.map((t) => t.name.trim().toLowerCase()));
  // A document with elements keeps its default (implicitly its first element until now).
  const first = d.templates.nodes[0];
  if (first && !d.templates.defaultNodeId) d.templates.defaultNodeId = first.id;
  for (const t of def.nodes) {
    if (have.has(t.name.toLowerCase())) continue;
    d.templates.nodes.push(t);
    if (t.image) d.assets[t.image.asset] = pictures[t.image.asset];
    if (t.id === def.defaultNodeId && !d.templates.defaultNodeId) d.templates.defaultNodeId = t.id;
  }
  if (!d.templates.lines.length) d.templates.lines.push(...def.lines);
}

/** Whether another line joins the same two shapes as `c` (so `c` is one of several parallel links). */
function hasParallel(page: Page, c: Connector): boolean {
  const pair = [c.source.shapeId, c.target.shapeId].sort().join();
  return page.order.some((id) => {
    const o = page.items[id];
    return id !== c.id && isConnector(o) && [o.source.shapeId, o.target.shapeId].sort().join() === pair;
  });
}

/**
 * Copies items with new ids, shifted by `offset`, for pasting onto `target`. Connector ends
 * whose shape wasn't copied become free; items whose layer isn't on `target` go on `layerId`.
 */
function cloneItems(src: Page, items: Item[], offset: Point, target: Page, layerId: string): Item[] {
  const { copies, ids } = copyItems(items);
  const copied = new Set(ids.values());
  return copies.map((copy, i) => {
    if (!target.layers.some((l) => l.id === copy.layerId)) copy.layerId = layerId;
    if (isShape(copy)) {
      copy.x += offset.x;
      copy.y += offset.y;
      return copy;
    }
    if (!isConnector(copy)) return copy;
    const pts = connectorPoints(src, items[i] as Connector);
    const free = (ep: Endpoint, fallback: Point): Endpoint =>
      ep.shapeId && copied.has(ep.shapeId) ? ep : { x: fallback.x + offset.x, y: fallback.y + offset.y };
    copy.source = free(copy.source, pts[0]);
    copy.target = free(copy.target, pts[pts.length - 1]);
    return copy;
  });
}

/**
 * Deletes items from a page draft. Lines attached to deleted shapes stay, with their ends left
 * where they were; `before` is the page as it was, used to compute those positions.
 */
function deleteItems(page: Page, before: Page, doomed: Set<string>): void {
  for (const id of page.order) {
    const c = before.items[id];
    if (!isConnector(c) || doomed.has(id)) continue;
    const pts = connectorPoints(before, c);
    const live = page.items[id] as Connector;
    if (c.source.shapeId && doomed.has(c.source.shapeId)) live.source = { x: pts[0].x, y: pts[0].y };
    const end = pts[pts.length - 1];
    if (c.target.shapeId && doomed.has(c.target.shapeId)) live.target = { x: end.x, y: end.y };
  }
  for (const id of doomed) delete page.items[id];
  page.order = page.order.filter((id) => !doomed.has(id));
}

const selectedItems = (s: Pick<State, 'doc' | 'activePageId' | 'selection'>) => {
  const page = currentPage(s);
  return page.order.filter((id) => s.selection.includes(id)).map((id) => page.items[id]);
};

/** The page an undo/redo entry changed, so the canvas can jump there and show it. */
function touchedPage(doc: Doc, patches: hist.Entry['patches']): string | null {
  for (const p of patches) {
    const i = p.path[0] === 'pages' ? p.path[1] : undefined;
    // Skip removals of a whole page (there's nothing left to show) and `pages.length` edits.
    if (typeof i === 'number' && (p.path.length > 2 || p.op !== 'remove') && doc.pages[i]) return doc.pages[i].id;
  }
  return null;
}

export const useStore = create<State>()((set, get) => {
  const commit = (recipe: (d: Doc) => void, mergeKey?: string) => {
    const { doc, history } = get();
    const [next, h] = hist.change(doc, history, recipe, mergeKey);
    set({ doc: next, history: h });
  };

  const commitPage = (recipe: (p: Page) => void, mergeKey?: string) => {
    const id = currentPage(get()).id;
    commit((d) => {
      const page = d.pages.find((p) => p.id === id);
      if (page) recipe(page);
    }, mergeKey);
  };

  /**
   * Stops editing without saving. A new text box still has no text in the doc, so its open
   * batch is aborted (removing it); call before anything that ends editing other than commitText.
   */
  const cancelEditing = () => {
    if (get().editingNew) get().abortBatch();
    set({ editingId: null, editingNew: false });
  };

  /** Drops selected ids that are gone or no longer selectable (deleted, hidden, locked). */
  const pruneSelection = () => {
    const s = get();
    const page = currentPage(s);
    const selection = s.selection.filter((id) => isInteractive(page, page.items[id]));
    if (selection.length !== s.selection.length) set({ selection });
    if (s.editingId && !selection.includes(s.editingId)) cancelEditing();
  };

  /**
   * Adds items to the active page on the active layer (in one undo step), making that layer
   * visible and unlocked first so the new items can be seen and selected.
   */
  const addToActiveLayer = (items: Item[]) => {
    const layerId = currentLayer(get()).id;
    commitPage((p) => {
      const layer = p.layers.find((l) => l.id === layerId);
      if (layer) Object.assign(layer, { visible: true, locked: false });
      for (const it of items) it.layerId ??= layerId;
      addItems(p, items);
    });
  };

  const showPage = (id: string) => {
    cancelEditing();
    const s = get();
    const from = currentPage(s).id;
    const to = pageById(s.doc, id);
    const saved = s.pageViews[to.id];
    set({
      activePageId: to.id,
      activeLayerId: to.layers[to.layers.length - 1].id,
      selection: [],
      editingId: null,
      pageViews: { ...s.pageViews, [from]: s.viewport },
    });
    if (saved) set({ viewport: saved });
    else if (from !== to.id) get().fitToScreen();
  };

  const afterHistory = (doc: Doc, history: hist.History, patches: hist.Entry['patches']) => {
    const s = get();
    // Undo/redo already closed any open batch (a new text box's included), so just stop editing.
    set({ doc, history, editingId: null, editingNew: false });
    const touched = touchedPage(doc, patches);
    if (touched && touched !== currentPage(s).id) showPage(touched);
    else if (!doc.pages.some((p) => p.id === s.activePageId)) showPage(doc.pages[0].id);
    pruneSelection();
  };

  const pasteItems = (src: Page, items: Item[], at?: Point) => {
    if (items.length === 0) return [];
    const s = get();
    let offset = { x: PASTE_OFFSET, y: PASTE_OFFSET };
    const box = at && unionRects(items.map((it) => itemBounds(src, it.id)).filter((r): r is Rect => r !== null));
    if (at && box) offset = { x: at.x - (box.x + box.w / 2), y: at.y - (box.y + box.h / 2) };
    const copies = cloneItems(src, items, offset, currentPage(s), currentLayer(s).id);
    addToActiveLayer(copies);
    set({ selection: copies.map((c) => c.id) });
    return copies;
  };

  /** Moves each arrangement unit (group or lone shape) of the selection by its offset. */
  const arrange = (deltas: (rects: Rect[]) => Point[]) => {
    const s = get();
    const page = currentPage(s);
    const units = groupUnits(page, s.selection)
      .map((ids) => ({ ids, box: unionRects(ids.map((id) => page.items[id]).filter(isShape).map(shapeBox)) }))
      .filter((u): u is { ids: string[]; box: Rect } => u.box !== null);
    const offsets = deltas(units.map((u) => u.box));
    commitPage((p) => units.forEach((u, i) => translateItems(p, u.ids, offsets[i].x, offsets[i].y)));
  };

  const initialDoc = loadAutosave() ?? sampleDoc();
  const firstPage = initialDoc.pages[0];

  return {
    doc: initialDoc,
    history: hist.emptyHistory(),
    activePageId: firstPage.id,
    activeLayerId: firstPage.layers[firstPage.layers.length - 1].id,
    selection: [],
    viewport: HOME_VIEW,
    pageViews: {},
    canvasSize: { w: 800, h: 600 },
    editingId: null,
    editingNew: false,
    showGrid: true,
    snapToGrid: true,
    tool: 'select',
    toolLocked: false,
    autosaveFull: false,
    arrowTemplateId: null,
    clipboard: null,

    update: commit,
    updatePage: commitPage,
    beginBatch: () => set({ history: hist.beginBatch(get().history) }),
    endBatch: () => set({ history: hist.endBatch(get().history) }),
    abortBatch: () => {
      const [doc, history] = hist.abortBatch(get().doc, get().history);
      set({ doc, history });
    },
    undo: () => {
      const s = get();
      const h0 = hist.endBatch(s.history);
      const entry = h0.past[h0.past.length - 1];
      const [doc, history] = hist.undo(s.doc, h0);
      afterHistory(doc, history, entry?.inverse ?? []);
    },
    redo: () => {
      const s = get();
      const h0 = hist.endBatch(s.history);
      const entry = h0.future[h0.future.length - 1];
      const [doc, history] = hist.redo(s.doc, h0);
      afterHistory(doc, history, entry?.patches ?? []);
    },

    setSelection: (ids) => set({ selection: ids }),
    selectAll: () => {
      const page = currentPage(get());
      set({ selection: page.order.filter((id) => isInteractive(page, page.items[id])) });
    },
    setViewport: (viewport) => set({ viewport }),
    setCanvasSize: (w, h) => set({ canvasSize: { w, h } }),
    setEditing: (editingId, isNew = false) => {
      const it = editingId ? currentPage(get()).items[editingId] : undefined;
      // Pictures have no text, unless it's drawn beside them.
      if (isShape(it) && it.kind === 'image' && it.textPosition !== 'right') return;
      // Templated items get their text from template + fields (edited in Properties), not by hand.
      if (it?.templateId) return;
      set({ editingId, editingNew: !!editingId && isNew });
    },
    commitText: (id, value) => {
      const s = get();
      if (s.editingNew && value.trim() === '') {
        // An untouched new text box disappears without an undo step.
        s.abortBatch();
        set({ editingId: null, editingNew: false, selection: s.selection.filter((x) => x !== id) });
        return;
      }
      commitPage((p) => {
        const it = p.items[id];
        if (isShape(it)) {
          it.text = value;
          if (it.autoSize) Object.assign(it, fitText(value, it.style));
        } else if (isConnector(it)) {
          it.label = value.replace(/\n/g, ' ');
        }
      });
      if (s.editingNew) get().endBatch();
      set({ editingId: null, editingNew: false });
    },
    setAutosaveFull: (autosaveFull) => {
      if (autosaveFull !== get().autosaveFull) set({ autosaveFull });
    },
    toggleGrid: () => set({ showGrid: !get().showGrid }),
    toggleSnap: () => set({ snapToGrid: !get().snapToGrid }),
    // Back to Select also forgets a picked line template, so the next plain Arrow is plain.
    setTool: (tool, locked = false) =>
      set({ tool, toolLocked: tool !== 'select' && locked, ...(tool === 'select' ? { arrowTemplateId: null } : {}) }),

    addShape: (entry, center) => {
      let x = center.x - entry.w / 2;
      let y = center.y - entry.h / 2;
      if (get().snapToGrid) {
        x = snapToGrid(x);
        y = snapToGrid(y);
      }
      const shape = makeShape(entry.kind, { x, y, w: entry.w, h: entry.h }, entry.text ?? '', entry.style);
      addToActiveLayer([shape]);
      set({ selection: [shape.id] });
      return shape.id;
    },

    addConnector: (source, target) => {
      const s = get();
      const t = s.doc.templates?.lines.find((l) => l.id === s.arrowTemplateId);
      let c: Connector;
      if (t) {
        c = lineFromTemplate(t, {}, source, target);
      } else {
        c = makeConnector(source, target);
        // Arrows start straight, like Excalidraw; elbow and curved are a Properties choice.
        c.routing = 'straight';
      }
      addToActiveLayer([c]);
      return c.id;
    },

    addImage: (src, w, h, center) => {
      const size = fitWithin(w, h, IMAGE_DISPLAY_MAX);
      const shape = makeShape(
        'image',
        { x: Math.round(center.x - size.w / 2), y: Math.round(center.y - size.h / 2), ...size },
        '',
        { fill: 'none', stroke: 'none' },
      );
      shape.image = { src };
      addToActiveLayer([shape]);
      set({ selection: [shape.id] });
      return shape.id;
    },

    addTextBox: (at) => {
      cancelEditing();
      const style = { fill: 'none', stroke: 'none', textAlign: 'left' as const };
      const size = fitText('', { ...DEFAULT_SHAPE_STYLE, ...style });
      // The text starts at the click, with its first line vertically centered on it.
      const shape = makeShape('text', { x: at.x - TEXT_PAD, y: at.y - size.h / 2, ...size }, '', style);
      shape.autoSize = true;
      get().beginBatch();
      addToActiveLayer([shape]);
      set({ selection: [shape.id] });
      get().setEditing(shape.id, true);
      return shape.id;
    },

    deleteSelection: () => {
      const s = get();
      if (s.selection.length === 0) return;
      cancelEditing();
      const before = currentPage(s);
      const doomed = new Set(s.selection);
      commitPage((p) => deleteItems(p, before, doomed));
      set({ selection: [] });
    },

    nudge: (dx, dy) => {
      const ids = get().selection;
      if (ids.length === 0) return;
      commitPage((p) => translateItems(p, ids, dx, dy), 'nudge');
    },

    copy: () => {
      const items = selectedItems(get());
      if (items.length) set({ clipboard: { page: currentPage(get()), items } });
    },
    paste: (at) => {
      const clip = get().clipboard;
      if (!clip) return;
      const pasted = pasteItems(clip.page, clip.items, at);
      // Re-copy the pasted items so the next paste lands offset from this one.
      set({ clipboard: { page: currentPage(get()), items: pasted } });
    },
    duplicate: () => {
      pasteItems(currentPage(get()), selectedItems(get()));
    },

    bringToFront: () => {
      const sel = new Set(get().selection);
      commitPage((p) => {
        p.order = [...p.order.filter((id) => !sel.has(id)), ...p.order.filter((id) => sel.has(id))];
      });
    },
    sendToBack: () => {
      const sel = new Set(get().selection);
      commitPage((p) => {
        p.order = [...p.order.filter((id) => sel.has(id)), ...p.order.filter((id) => !sel.has(id))];
      });
    },

    styleShapes: (style, mergeKey) => {
      const sel = get().selection;
      commitPage((p) => {
        for (const id of sel) {
          const it = p.items[id];
          if (!isShape(it)) continue;
          Object.assign(it.style, style);
          // Font changes resize auto-sized text boxes to keep fitting their text.
          if (it.autoSize) Object.assign(it, fitText(it.text, it.style));
        }
      }, mergeKey);
    },
    editConnectors: ({ style, ...rest }, mergeKey) => {
      const sel = get().selection;
      const before = currentPage(get());
      commitPage((p) => {
        for (const id of sel) {
          const it = p.items[id];
          if (!isConnector(it)) continue;
          Object.assign(it, rest);
          if (style) Object.assign(it.style, style);
          // A line switched to curved starts with a visible bend: 20 % of its length.
          if (it.routing === 'curved' && it.bend == null) {
            const [a, b] = connectorEnds(before, before.items[id] as Connector);
            it.bend = Math.round(Math.hypot(b.p.x - a.p.x, b.p.y - a.p.y) * 0.2);
          }
        }
      }, mergeKey);
    },

    rotateShapes: (degrees, mergeKey) => {
      const sel = get().selection;
      const angle = normalizeAngle(degrees);
      commitPage((p) => {
        for (const id of sel) {
          const it = p.items[id];
          if (!isShape(it)) continue;
          // Unrotated shapes keep no field, so files stay as they were before rotation existed.
          if (angle) it.rotation = angle;
          else delete it.rotation;
        }
      }, mergeKey);
    },

    group: () => {
      const sel = get().selection;
      if (sel.length < 2) return;
      const gid = nanoid(10);
      commitPage((p) => {
        for (const id of sel) {
          const it = p.items[id];
          if (it) it.groupIds = [gid, ...(it.groupIds ?? [])];
        }
      });
    },
    ungroup: () => {
      const s = get();
      const page = currentPage(s);
      const outer = new Set(s.selection.map((id) => outerGroup(page.items[id])).filter(Boolean));
      if (outer.size === 0) return;
      commitPage((p) => {
        for (const id of s.selection) {
          const it = p.items[id];
          if (!it?.groupIds || !outer.has(it.groupIds[0])) continue;
          if (it.groupIds.length > 1) it.groupIds = it.groupIds.slice(1);
          else delete it.groupIds;
        }
      });
    },
    align: (mode) => arrange((rects) => alignDeltas(rects, mode)),
    distribute: (axis) => arrange((rects) => distributeDeltas(rects, axis)),

    setActivePage: (id) => {
      if (id !== currentPage(get()).id) showPage(id);
    },
    addPage: () => {
      const page = makePage(`Page ${get().doc.pages.length + 1}`);
      commit((d) => void d.pages.push(page));
      showPage(page.id);
    },
    duplicatePage: (id) => {
      const src = pageById(get().doc, id);
      const copy = clonePage(src, `${src.name} copy`);
      commit((d) => {
        const i = d.pages.findIndex((p) => p.id === src.id);
        d.pages.splice(i + 1, 0, copy);
      });
      showPage(copy.id);
    },
    deletePage: (id) => {
      const { doc } = get();
      const i = doc.pages.findIndex((p) => p.id === id);
      if (i < 0 || doc.pages.length <= 1) return;
      const wasActive = currentPage(get()).id === id;
      commit((d) => void d.pages.splice(i, 1));
      if (wasActive) showPage(get().doc.pages[Math.max(0, i - 1)].id);
    },
    renamePage: (id, name) => {
      commit((d) => {
        const p = d.pages.find((pg) => pg.id === id);
        if (p) p.name = name;
      }, `page-name:${id}`);
    },

    setActiveLayer: (id) => set({ activeLayerId: id }),
    addLayer: () => {
      const layer = makeLayer(`Layer ${currentPage(get()).layers.length + 1}`);
      commitPage((p) => void p.layers.push(layer));
      set({ activeLayerId: layer.id });
    },
    deleteLayer: (id) => {
      const before = currentPage(get());
      if (before.layers.length <= 1) return;
      const doomed = new Set(before.order.filter((iid) => layerOf(before, before.items[iid]).id === id));
      commitPage((p) => {
        deleteItems(p, before, doomed);
        p.layers = p.layers.filter((l) => l.id !== id);
      });
      pruneSelection();
    },
    renameLayer: (id, name) => {
      commitPage((p) => {
        const l = p.layers.find((ly) => ly.id === id);
        if (l) l.name = name;
      }, `layer-name:${id}`);
    },
    setLayerFlags: (id, flags) => {
      commitPage((p) => {
        const l = p.layers.find((ly) => ly.id === id);
        if (l) Object.assign(l, flags);
      });
      pruneSelection();
    },
    moveLayer: (id, delta) => {
      commitPage((p) => {
        const i = p.layers.findIndex((l) => l.id === id);
        const j = i + delta;
        if (i < 0 || j < 0 || j >= p.layers.length) return;
        [p.layers[i], p.layers[j]] = [p.layers[j], p.layers[i]];
      });
    },
    moveSelectionToLayer: (id) => {
      const sel = get().selection;
      commitPage((p) => {
        for (const iid of sel) {
          const it = p.items[iid];
          if (it) it.layerId = id;
        }
      });
      pruneSelection();
    },

    previewImport: (csv, opts = {}) => {
      const graph = buildGraph(parseCsv(csv));
      // Sizes depend on the templates; without any yet, preview with the defaults the import would create.
      const own = get().doc.templates;
      const templates = own?.nodes.length && own.lines.length ? own : defaultTemplates();
      return planImport(currentPage(get()), graph, devicePicker(templates, opts.nodeTemplateId), pickLine(templates, opts)).summary;
    },

    importLinks: (csv, opts = {}) => {
      // Parse first: a bad file throws before anything changes.
      const graph = buildGraph(parseCsv(csv));
      cancelEditing();
      get().beginBatch();
      // A document without elements gets the built-in ones (inside the same undo step). The
      // element chosen for unmatched devices becomes the default, so the live rules agree later.
      const oldDefault = currentDefaultId(get().doc);
      commit((d) => {
        if (!d.templates?.nodes.length || !d.templates.lines.length) addMissingBuiltIns(d);
        if (opts.nodeTemplateId && d.templates!.nodes.some((t) => t.id === opts.nodeTemplateId)) {
          d.templates!.defaultNodeId = opts.nodeTemplateId;
        }
      });
      const templates = get().doc.templates!;
      const plan = planImport(currentPage(get()), graph, devicePicker(templates, opts.nodeTemplateId), pickLine(templates, opts));
      // Devices whose platform the file changed are placed like new ones (their old element may no longer apply).
      const replatformed = new Set<string>();
      if (plan.updates.length) {
        commitPage((p) => {
          for (const u of plan.updates) {
            const s = p.items[u.id];
            if (!isShape(s)) continue;
            if ((s.data?.[DEVICE_FIELDS.platform] ?? '') !== (u.data[DEVICE_FIELDS.platform] ?? '')) replatformed.add(s.id);
            s.data = u.data;
            // Re-render with the device's own template; a changed platform may move it below.
            const t = templates.nodes.find((n) => n.id === s.templateId);
            if (t) renderNodeText(s, t);
          }
        });
      }
      // Changed platforms (and a changed default) move existing devices.
      const newDefault = currentDefaultId(get().doc);
      commit((d) => reassignDevices(d, (s) => replatformed.has(s.id) || (oldDefault !== newDefault && s.templateId === oldDefault)));
      const added = [...plan.newNodes, ...plan.newLines];
      if (added.length) addToActiveLayer(added);
      get().endBatch();
      if (added.length) {
        set({ selection: added.map((it) => it.id) });
        get().fitToScreen();
      }
      return plan.summary;
    },

    saveTemplate: (itemId, name) => {
      const it = currentPage(get()).items[itemId];
      if (!it) return null;
      // A picture becomes a picture element; its picture is stored once as an asset.
      const existingAsset = isShape(it) ? it.image?.asset : undefined;
      const newAsset = isShape(it) && it.kind === 'image' && !existingAsset && it.image?.src ? nanoid(10) : undefined;
      const t = isShape(it) ? templateFromShape(it, name, undefined, existingAsset ?? newAsset) : templateFromLine(it, name);
      commit((d) => {
        d.templates ??= { nodes: [], lines: [] };
        if (newAsset && isShape(it)) {
          d.assets ??= {};
          d.assets[newAsset] = it.image!.src!;
        }
        if (isShape(it)) d.templates.nodes.push(t as NodeTemplate);
        else d.templates.lines.push(t as LineTemplate);
      });
      return t.id;
    },

    updateTemplate: (id, patch) => {
      commit((d) => {
        const nt = d.templates?.nodes.find((t) => t.id === id);
        const lt = d.templates?.lines.find((t) => t.id === id);
        const oldRules = [...(nt?.platforms ?? [])];
        if (nt) Object.assign(nt, patch);
        else if (lt) Object.assign(lt, patch);
        else return;
        for (const p of d.pages) {
          for (const iid of p.order) {
            const it = p.items[iid];
            if (it.templateId !== id) continue;
            if (nt && isShape(it)) restyleNode(it, nt);
            if (lt && isConnector(it)) {
              // A line fanned out among parallel links stays curved whatever the template says.
              const fanned = it.routing === 'curved' && !!it.bend && hasParallel(p, it);
              restyleLine(it, lt);
              if (fanned) it.routing = 'curved';
            }
          }
        }
        // New platform rules apply at once to every device they now match. A device this element
        // got through a rule that no longer matches it goes to its best match or the default; one
        // placed on it by hand stays.
        if (nt && 'platforms' in patch) {
          reassignDevices(d, (s) => s.templateId === id && rulesMatch(oldRules, s.data?.[DEVICE_FIELDS.platform]));
        }
      });
    },

    addDeviceTemplate: (name, src, w, h) => {
      const asset = nanoid(10);
      const size = fitWithin(w, h, DEVICE_PICTURE_MAX);
      const t: NodeTemplate = {
        id: nanoid(10),
        name,
        kind: 'image',
        ...size,
        style: { ...DEFAULT_SHAPE_STYLE, fill: 'none', stroke: 'none', fontSize: 12 },
        text: DEVICE_FIELDS_TEXT,
        image: { asset },
        textPosition: 'right',
        platforms: [],
      };
      commit((d) => {
        d.assets ??= {};
        d.assets[asset] = src;
        d.templates ??= { nodes: [], lines: [] };
        d.templates.nodes.push(t);
      });
      return t.id;
    },

    setTemplatePicture: (id, src, w, h) => {
      const asset = nanoid(10);
      const size = fitWithin(w, h, DEVICE_PICTURE_MAX);
      commit((d) => {
        const t = d.templates?.nodes.find((n) => n.id === id);
        if (!t) return;
        d.assets ??= {};
        d.assets[asset] = src;
        Object.assign(t, { kind: 'image', image: { asset }, textPosition: 'right', ...size });
        // A picture has no fill or border of its own.
        t.style = { ...t.style, fill: 'none', stroke: 'none' };
        restyleLinkedNodes(d, t);
        pruneAssets(d);
      });
    },

    removeTemplatePicture: (id) => {
      commit((d) => {
        const t = d.templates?.nodes.find((n) => n.id === id);
        if (!t?.image) return;
        delete t.image;
        Object.assign(t, { kind: 'roundRect', w: 72, h: 48, textPosition: 'right' });
        // Without a picture the element is a box, so give it a visible outline and fill.
        t.style = {
          ...t.style,
          fill: t.style.fill === 'none' ? '#eef4ff' : t.style.fill,
          stroke: t.style.stroke === 'none' ? '#3b5b9a' : t.style.stroke,
        };
        restyleLinkedNodes(d, t);
        pruneAssets(d);
      });
    },

    setDefaultNodeTemplate: (id) => {
      commit((d) => {
        if (!d.templates?.nodes.some((t) => t.id === id)) return;
        const oldDefault = currentDefaultId(d);
        d.templates.defaultNodeId = id;
        // Devices that had the old default (matching no rule) follow the new one.
        reassignDevices(d, (s) => s.templateId === oldDefault);
      });
    },

    addBuiltInDevices: () => {
      commit((d) => {
        addMissingBuiltIns(d);
        reassignDevices(d);
      });
    },

    updateTemplateFromItem: (itemId) => {
      const it = currentPage(get()).items[itemId];
      if (!it?.templateId) return;
      if (isShape(it)) {
        get().updateTemplate(it.templateId, { kind: it.kind, w: Math.round(it.w), h: Math.round(it.h), style: { ...it.style } });
      } else {
        get().updateTemplate(it.templateId, { routing: it.routing, style: { ...it.style } });
      }
    },

    deleteTemplate: (id) => {
      commit((d) => {
        if (!d.templates) return;
        d.templates.nodes = d.templates.nodes.filter((t) => t.id !== id);
        d.templates.lines = d.templates.lines.filter((t) => t.id !== id);
        if (d.templates.defaultNodeId === id) delete d.templates.defaultNodeId;
        for (const p of d.pages) {
          for (const iid of p.order) if (p.items[iid].templateId === id) delete p.items[iid].templateId;
        }
        // Items made from it keep their picture (they refer to its asset), so only unused ones go.
        pruneAssets(d);
      });
      if (get().arrowTemplateId === id) set({ arrowTemplateId: null });
    },

    addFromTemplate: (id, center) => {
      const t = get().doc.templates?.nodes.find((n) => n.id === id);
      if (!t) return null;
      const s = nodeFromTemplate(t, {}, center);
      if (get().snapToGrid) {
        s.x = snapToGrid(s.x);
        s.y = snapToGrid(s.y);
      }
      addToActiveLayer([s]);
      set({ selection: [s.id] });
      return s.id;
    },

    setArrowTemplate: (id) => {
      if (id) set({ arrowTemplateId: id, tool: 'arrow', toolLocked: false });
      else set({ arrowTemplateId: null });
    },

    setItemData: (id, key, value, mergeKey) => {
      const templates = get().doc.templates;
      commitPage((p) => {
        const it = p.items[id];
        if (!it) return;
        it.data = { ...it.data, [key]: value };
        if (isShape(it)) {
          const t = templates?.nodes.find((n) => n.id === it.templateId);
          // A platform that matches a rule switches the device to that element (live platform
          // rules). One that matches nothing — e.g. while it's still being typed — keeps the element.
          const best =
            t && templates && key.toLowerCase() === DEVICE_FIELDS.platform.toLowerCase() ? matchPlatform(templates, value) : undefined;
          if (best && best.id !== t!.id) {
            it.templateId = best.id;
            restyleNode(it, best);
          } else if (t) {
            renderNodeText(it, t);
          }
        } else {
          const t = templates?.lines.find((l) => l.id === it.templateId);
          if (t) renderLineText(it, t);
        }
      }, mergeKey);
    },

    unlinkTemplate: (ids) => {
      commitPage((p) => {
        for (const id of ids) if (p.items[id]) delete p.items[id].templateId;
      });
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
      const s = get();
      const b = docBounds(currentPage(s));
      if (!b) {
        set({ viewport: HOME_VIEW });
        return;
      }
      const { canvasSize } = s;
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
      const first = doc.pages[0];
      set({
        doc,
        history: hist.emptyHistory(),
        activePageId: first.id,
        activeLayerId: first.layers[first.layers.length - 1].id,
        selection: [],
        editingId: null,
        editingNew: false,
        pageViews: {},
      });
      get().fitToScreen();
    },
  };
});
