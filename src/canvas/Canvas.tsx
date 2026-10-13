import { useEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { localFrame, pinnedPoint } from '../connectors/binding';
import { ConnectorView } from '../connectors/ConnectorView';
import {
  bendThrough,
  connectorEnds,
  connectorPoints,
  curveMidpoint,
  endLabelStacks,
  findAttachment,
  routeObstacles,
} from '../connectors/routing';
import { isConnector, isShape, shapeImageSrc } from '../model/doc';
import { expandGroups, isVisible, layerBuckets, outerGroup } from '../model/page';
import { currentPage, useStore, type Viewport } from '../model/store';
import type { Endpoint, Point, Rect } from '../model/types';
import { LIBRARY, SHAPES } from '../shapes/library';
import { ContextMenu } from '../ui/ContextMenu';
import { drawRect, GRID, itemBounds, itemsInRect, normRect, snapToGrid, unionRects } from './geometry';
import { ShapeView, shapeTransform } from './ShapeView';
import { snapMove, type Guide } from './snap';
import { TextEditor } from './TextEditor';
import { rectCenter, resizeRect, rotationOf, shapeBox, snapAngle, type Handle } from './transform';

export const SHAPE_DRAG_MIME = 'application/x-clearchart-shape';
/** A drag payload starting with this names a node template (`template:<id>`), not a LIBRARY index. */
export const TEMPLATE_DRAG_PREFIX = 'template:';

/** The content layer, read by SVG/PNG export. */
export const canvasRefs: { content: SVGGElement | null } = { content: null };

const HANDLES: Handle[] = ['nw', 'ne', 'se', 'sw'];
const MIN_SIZE = 10;
const SELECT_COLOR = '#2f6feb';
/** Screen px between a shape's top edge and its rotation handle. */
const ROTATE_HANDLE_OFFSET = 24;
/** Screen px within which an arrow end snaps onto a shape's outline. */
const ATTACH_SNAP = 8;
/** Screen px a right-button drag must travel before it pans instead of opening the menu. */
const PAN_THRESHOLD = 4;
/** Screen px a Place-tool drag must travel before it draws a shape instead of placing one. */
const DRAW_THRESHOLD = 4;

type Drag =
  | {
      kind: 'pan';
      sx: number;
      sy: number;
      vp0: Viewport;
      /** Right button: a press that never moves opens the context menu instead. */
      menu: boolean;
      moved: boolean;
    }
  | {
      kind: 'move';
      start: Point;
      clicked: string;
      started: boolean;
      /** Original top-left of each moving shape. */
      shapes: Record<string, Point>;
      /** Original combined (rotated) bounds of the moving shapes, for snapping. */
      box: Rect | null;
      freeEnds: { id: string; end: 'source' | 'target'; origin: Point }[];
    }
  | { kind: 'resize'; id: string; handle: Handle; start: Point; orig: Rect; rotation: number; aspect: boolean }
  | { kind: 'rotate'; id: string; center: Point }
  | { kind: 'bend'; id: string }
  | { kind: 'marquee'; start: Point; base: string[] }
  | { kind: 'connect'; id: string; end: 'source' | 'target'; isNew: boolean; start: Point }
  /** The Place tool: a click puts `placing` down; a drag draws a shape (`id` once it exists). */
  | { kind: 'draw'; start: Point; id: string | null };

export function Canvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const contentRef = useRef<SVGGElement>(null);
  const drag = useRef<Drag | null>(null);
  const spaceDown = useRef(false);

  const page = useStore(currentPage);
  const selection = useStore((s) => s.selection);
  const vp = useStore((s) => s.viewport);
  const editingId = useStore((s) => s.editingId);
  const showGrid = useStore((s) => s.showGrid);
  const assets = useStore((s) => s.doc.assets);
  const tool = useStore((s) => s.tool);

  const [guides, setGuides] = useState<Guide[]>([]);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  /** Where an arrow end would attach (while drawing or dragging one, or hovering with the arrow tool). */
  const [attachHint, setAttachHint] = useState<Endpoint | null>(null);
  const [panning, setPanning] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; world: Point } | null>(null);

  // Shared by every elbow line on the page this render.
  const obstacles = useMemo(() => routeObstacles(page), [page]);

  useEffect(() => {
    canvasRefs.content = contentRef.current;
    return () => {
      canvasRefs.content = null;
    };
  }, []);

  // Track canvas size for zoom-to-fit and zooming around the center.
  useEffect(() => {
    const el = containerRef.current!;
    const ro = new ResizeObserver(() => useStore.getState().setCanvasSize(el.clientWidth, el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Wheel always zooms around the cursor (pinch arrives as ctrl+wheel with small deltas).
  // Registered natively because React's wheel listener is passive.
  useEffect(() => {
    const svg = svgRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? r.height : 1;
      const speed = e.ctrlKey ? 0.01 : 0.0015;
      useStore.getState().zoomBy(Math.exp(-e.deltaY * unit * speed), { x: e.clientX - r.left, y: e.clientY - r.top });
      setMenu(null);
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  // Hold space to pan with the left button.
  useEffect(() => {
    const typing = (e: KeyboardEvent) => (e.target as HTMLElement).closest('input, textarea, select');
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !typing(e)) {
        spaceDown.current = true;
        setPanning(true);
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceDown.current = false;
        if (drag.current?.kind !== 'pan') setPanning(false);
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // Hints and the menu belong to the page/tool they were made for.
  useEffect(() => {
    setAttachHint(null);
    setMenu(null);
  }, [page.id, tool]);

  const toWorld = (clientX: number, clientY: number): Point => {
    const r = svgRef.current!.getBoundingClientRect();
    const v = useStore.getState().viewport;
    return { x: (clientX - r.left - v.x) / v.zoom, y: (clientY - r.top - v.y) / v.zoom };
  };

  /** Opens the context menu, selecting what's under the cursor first (or nothing, on empty canvas). */
  const openMenu = (clientX: number, clientY: number) => {
    const st = useStore.getState();
    // Pointer capture retargets events to the <svg>, so look up what's actually under the cursor.
    const el = document.elementFromPoint(clientX, clientY)?.closest('[data-hit="shape"], [data-hit="connector"]');
    const id = el?.getAttribute('data-id');
    if (id) {
      if (!st.selection.includes(id)) st.setSelection(expandGroups(currentPage(st), [id]));
    } else {
      st.setSelection([]);
    }
    const r = containerRef.current!.getBoundingClientRect();
    setMenu({ x: clientX - r.left, y: clientY - r.top, world: toWorld(clientX, clientY) });
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    const st = useStore.getState();
    setMenu(null);
    if (st.editingId) return;
    // Take the keyboard back from any panel field or tile, so Delete and other shortcuts act on
    // the canvas right away (they're ignored while you're typing in a field).
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && focused !== document.body) focused.blur();
    svgRef.current!.setPointerCapture(e.pointerId);
    const w = toWorld(e.clientX, e.clientY);
    const pg = currentPage(st);
    const zoom = st.viewport.zoom;

    if (e.button === 2 || e.button === 1 || spaceDown.current) {
      drag.current = {
        kind: 'pan',
        sx: e.clientX,
        sy: e.clientY,
        vp0: st.viewport,
        menu: e.button === 2,
        moved: e.button !== 2,
      };
      return;
    }

    if (st.tool === 'place' && st.placing) {
      // Wherever you press, even over other shapes: place or draw what the tool holds.
      drag.current = { kind: 'draw', start: w, id: null };
      return;
    }

    const el = (e.target as Element).closest('[data-hit]');
    const hit = el?.getAttribute('data-hit');
    const id = el?.getAttribute('data-id') ?? '';

    if (st.tool === 'arrow') {
      // Draw a new arrow from here, pinned to the shape under the cursor if there is one.
      const source = findAttachment(pg, w, ATTACH_SNAP / zoom) ?? { x: w.x, y: w.y };
      st.beginBatch();
      const cid = st.addConnector(source, { x: w.x, y: w.y });
      st.setSelection([cid]);
      drag.current = { kind: 'connect', id: cid, end: 'target', isNew: true, start: w };
      return;
    }
    if (hit === 'cend') {
      st.beginBatch();
      const end = el!.getAttribute('data-end') as 'source' | 'target';
      drag.current = { kind: 'connect', id, end, isNew: false, start: w };
      return;
    }
    if (hit === 'bend') {
      st.beginBatch();
      drag.current = { kind: 'bend', id };
      return;
    }
    if (hit === 'handle') {
      const s = pg.items[id];
      if (!isShape(s)) return;
      st.beginBatch();
      const handle = el!.getAttribute('data-handle') as Handle;
      drag.current = {
        kind: 'resize',
        id,
        handle,
        start: w,
        orig: { x: s.x, y: s.y, w: s.w, h: s.h },
        rotation: rotationOf(s),
        aspect: !!SHAPES[s.kind].keepAspect,
      };
      return;
    }
    if (hit === 'rotate') {
      const s = pg.items[id];
      if (!isShape(s)) return;
      st.beginBatch();
      drag.current = { kind: 'rotate', id, center: rectCenter(s) };
      return;
    }
    if (hit === 'shape' || hit === 'connector') {
      // Pressing any member of a group acts on the whole group.
      const unit = expandGroups(pg, [id]);
      let sel = st.selection;
      if (e.shiftKey) {
        if (sel.includes(id)) {
          st.setSelection(sel.filter((x) => !unit.includes(x)));
          return;
        }
        sel = [...new Set([...sel, ...unit])];
      } else if (!sel.includes(id)) {
        sel = unit;
      }
      st.setSelection(sel);
      const shapes: Record<string, Point> = {};
      const boxes: Rect[] = [];
      const freeEnds: { id: string; end: 'source' | 'target'; origin: Point }[] = [];
      for (const sid of sel) {
        const it = pg.items[sid];
        if (isShape(it)) {
          shapes[sid] = { x: it.x, y: it.y };
          boxes.push(shapeBox(it));
        }
        if (isConnector(it)) {
          for (const end of ['source', 'target'] as const) {
            if (!it[end].shapeId) freeEnds.push({ id: sid, end, origin: { x: it[end].x, y: it[end].y } });
          }
        }
      }
      drag.current = { kind: 'move', start: w, clicked: id, started: false, shapes, box: unionRects(boxes), freeEnds };
      return;
    }

    // Empty canvas: rubber-band selection.
    drag.current = { kind: 'marquee', start: w, base: e.shiftKey ? st.selection : [] };
    if (!e.shiftKey) st.setSelection([]);
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const st = useStore.getState();
    const d = drag.current;
    const w = toWorld(e.clientX, e.clientY);
    const zoom = st.viewport.zoom;
    const pg = currentPage(st);

    if (!d) {
      // With the arrow tool, preview where a new arrow would start.
      if (st.tool === 'arrow') setAttachHint(findAttachment(pg, w, ATTACH_SNAP / zoom));
      return;
    }

    switch (d.kind) {
      case 'pan': {
        if (!d.moved) {
          if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < PAN_THRESHOLD) return;
          d.moved = true;
        }
        setPanning(true);
        st.setViewport({ ...d.vp0, x: d.vp0.x + e.clientX - d.sx, y: d.vp0.y + e.clientY - d.sy });
        break;
      }

      case 'move': {
        let dx = w.x - d.start.x;
        let dy = w.y - d.start.y;
        if (!d.started) {
          if (Math.hypot(dx, dy) * zoom < 3) return;
          d.started = true;
          st.beginBatch();
        }
        if (d.box) {
          const others = pg.order
            .map((id) => pg.items[id])
            .filter((it) => isShape(it) && !d.shapes[it.id] && isVisible(pg, it))
            .map((it) => itemBounds(pg, it.id)!);
          const snap = snapMove(
            { ...d.box, x: d.box.x + dx, y: d.box.y + dy },
            others,
            6 / zoom,
            st.snapToGrid ? GRID : 0,
          );
          dx += snap.dx;
          dy += snap.dy;
          setGuides(snap.guides);
        }
        st.updatePage((p) => {
          for (const [id, o] of Object.entries(d.shapes)) {
            const s = p.items[id];
            if (isShape(s)) {
              s.x = o.x + dx;
              s.y = o.y + dy;
            }
          }
          for (const f of d.freeEnds) {
            const c = p.items[f.id];
            if (isConnector(c)) {
              c[f.end].x = f.origin.x + dx;
              c[f.end].y = f.origin.y + dy;
            }
          }
        });
        break;
      }

      case 'resize': {
        const g = (v: number) => (st.snapToGrid ? snapToGrid(v) : v);
        // Pictures and circles keep their proportions unless Shift is held (other shapes: the reverse).
        const keepAspect = d.aspect !== e.shiftKey;
        const delta = { x: w.x - d.start.x, y: w.y - d.start.y };
        const r = resizeRect(d.orig, d.rotation, d.handle, delta, MIN_SIZE, g, keepAspect);
        st.updatePage((p) => {
          const s = p.items[d.id];
          if (!isShape(s)) return;
          Object.assign(s, r);
          // A text box sized by hand stops fitting itself to its text and wraps instead.
          delete s.autoSize;
        });
        break;
      }

      case 'rotate': {
        // The handle sits straight above the center, so pointing up is 0°.
        const raw = (Math.atan2(w.y - d.center.y, w.x - d.center.x) * 180) / Math.PI + 90;
        const angle = snapAngle(raw, e.shiftKey);
        st.updatePage((p) => {
          const s = p.items[d.id];
          if (!isShape(s)) return;
          if (angle) s.rotation = angle;
          else delete s.rotation;
        });
        break;
      }

      case 'bend': {
        const c = pg.items[d.id];
        if (!isConnector(c)) return;
        const [a, b] = connectorEnds(pg, c);
        const bend = Math.round(bendThrough(a.p, b.p, w));
        st.updatePage((p) => {
          const live = p.items[d.id];
          if (isConnector(live)) live.bend = bend;
        });
        break;
      }

      case 'marquee': {
        const r = normRect(d.start, w);
        setMarquee(r);
        st.setSelection(expandGroups(pg, [...new Set([...d.base, ...itemsInRect(pg, r)])]));
        break;
      }

      case 'connect': {
        const c = pg.items[d.id];
        if (!isConnector(c)) return;
        const other = d.end === 'target' ? c.source : c.target;
        let ep = findAttachment(pg, w, ATTACH_SNAP / zoom);
        // Both ends on one shape would make a line that starts and ends in the same place.
        if (ep && ep.shapeId === other.shapeId) ep = null;
        setAttachHint(ep);
        st.updatePage((p) => {
          const live = p.items[d.id];
          if (isConnector(live)) live[d.end] = ep ?? { x: w.x, y: w.y };
        });
        break;
      }

      case 'draw': {
        const p = st.placing;
        const entry = p?.kind === 'shape' ? LIBRARY[p.entry] : undefined;
        // Only shapes are drawn to size; text boxes and Graphs elements are placed where you press.
        if (!entry || entry.kind === 'text' || entry.kind === 'image') return;
        if (!d.id && Math.hypot(w.x - d.start.x, w.y - d.start.y) * zoom < DRAW_THRESHOLD) return;
        // Circles stay round unless Shift is held; Shift makes other shapes square.
        const square = !!SHAPES[entry.kind].keepAspect !== e.shiftKey;
        const r = drawRect(d.start, w, square, st.snapToGrid ? GRID : 0, MIN_SIZE);
        if (!d.id) {
          st.beginBatch();
          d.id = st.drawShape(entry, r);
        } else {
          const id = d.id;
          st.updatePage((pg) => {
            const s = pg.items[id];
            if (isShape(s)) Object.assign(s, r);
          });
        }
        break;
      }
    }
  };

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    const st = useStore.getState();
    const d = drag.current;
    drag.current = null;
    if (!d) return;

    switch (d.kind) {
      case 'pan':
        setPanning(spaceDown.current);
        if (d.menu && !d.moved && e.type === 'pointerup') openMenu(e.clientX, e.clientY);
        break;
      case 'move':
        if (d.started) st.endBatch();
        // A plain click on an item that was part of a larger selection selects just that item (or its group).
        else if (!e.shiftKey && st.selection.length > 1) st.setSelection(expandGroups(currentPage(st), [d.clicked]));
        setGuides([]);
        break;
      case 'resize':
      case 'rotate':
      case 'bend':
        st.endBatch();
        break;
      case 'marquee':
        setMarquee(null);
        break;
      case 'connect': {
        const w = toWorld(e.clientX, e.clientY);
        const tooShort = Math.hypot(w.x - d.start.x, w.y - d.start.y) * st.viewport.zoom < 8;
        if (d.isNew && tooShort) {
          // A click rather than a drag: no arrow.
          st.abortBatch();
          st.setSelection([]);
        } else {
          st.endBatch();
          if (d.isNew && !st.toolLocked) st.setTool('select');
        }
        setAttachHint(null);
        break;
      }
      case 'draw': {
        const p = st.placing;
        if (d.id) {
          st.endBatch();
        } else if (p?.kind === 'template') {
          // A click (or any press, for a fixed-size element): put it down there.
          st.addFromTemplate(p.id, d.start);
        } else if (p) {
          const entry = LIBRARY[p.entry];
          if (entry?.kind === 'text') st.addTextBox(d.start);
          else if (entry && entry.kind !== 'image') st.addShape(entry, d.start);
        }
        if (!st.toolLocked) st.setTool('select');
        break;
      }
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const st = useStore.getState();
    if (st.tool !== 'select' || st.editingId) return;
    // Pointer capture retargets the dblclick to the <svg>, so find what's actually under the cursor.
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-hit]');
    const hit = el?.getAttribute('data-hit');
    const id = el?.getAttribute('data-id');
    if (!el) {
      // Empty canvas: start a new text box where you double-clicked.
      st.addTextBox(toWorld(e.clientX, e.clientY));
      return;
    }
    // Handles, line ends and the like: nothing to edit.
    if ((hit !== 'shape' && hit !== 'connector') || !id) return;
    // Selecting just this item (not its group) lets you edit one member of a group.
    st.setSelection([id]);
    st.setEditing(id);
  };

  const onDragOver = (e: DragEvent) => {
    if (e.dataTransfer.types.includes(SHAPE_DRAG_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  const onDrop = (e: DragEvent) => {
    const payload = e.dataTransfer.getData(SHAPE_DRAG_MIME);
    if (payload.startsWith(TEMPLATE_DRAG_PREFIX)) {
      e.preventDefault();
      useStore.getState().addFromTemplate(payload.slice(TEMPLATE_DRAG_PREFIX.length), toWorld(e.clientX, e.clientY));
      return;
    }
    const entry = LIBRARY[Number(payload)];
    if (!entry || entry.kind === 'image') return;
    e.preventDefault();
    useStore.getState().addShape(entry, toWorld(e.clientX, e.clientY));
  };

  // ---- rendering ----
  const z = vp.zoom;
  const selectedShapes = selection.map((id) => page.items[id]).filter(isShape);
  const selectedConnectors = selection.map((id) => page.items[id]).filter(isConnector);
  const handleSize = 8 / z;
  // Shape an arrow end would attach to, and the exact point, to highlight both.
  const attachShape = attachHint?.shapeId ? page.items[attachHint.shapeId] : undefined;
  const attachBody = isShape(attachShape) ? attachShape : null;
  const attachPoint = attachBody && attachHint?.at ? pinnedPoint(attachBody, attachHint.at) : null;
  // The area that end attaches to, in the shape's frame: the shape, with any text beside it.
  const attachArea = attachBody ? localFrame(attachBody) : null;
  const single = selectedShapes.length === 1 && selection.length === 1 && !editingId ? selectedShapes[0] : null;
  const curved =
    selectedConnectors.length === 1 && selection.length === 1 && selectedConnectors[0].routing === 'curved'
      ? selectedConnectors[0]
      : null;
  const buckets = layerBuckets(page);

  // Outline each selected group with more than one member.
  const groupBoxes: Rect[] = [];
  const byGroup = new Map<string, string[]>();
  for (const id of selection) {
    const g = outerGroup(page.items[id]);
    if (g) byGroup.set(g, [...(byGroup.get(g) ?? []), id]);
  }
  for (const ids of byGroup.values()) {
    const b = ids.length > 1 ? unionRects(ids.map((id) => itemBounds(page, id)).filter((r): r is Rect => !!r)) : null;
    if (b) groupBoxes.push(b);
  }

  return (
    <div
      ref={containerRef}
      className={`canvas${panning ? ' panning' : ''}${tool === 'arrow' ? ' tool-arrow' : ''}${tool === 'place' ? ' tool-place' : ''}`}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <svg
        ref={svgRef}
        className="canvas-svg"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => !drag.current && setAttachHint(null)}
        onDoubleClick={onDoubleClick}
        // The menu opens from pointerup (see 'pan'), the same way on every OS.
        onContextMenu={(e) => e.preventDefault()}
      >
        {showGrid && (
          <>
            <defs>
              <pattern
                id="cc-grid"
                width={50}
                height={50}
                patternUnits="userSpaceOnUse"
                patternTransform={`translate(${vp.x} ${vp.y}) scale(${z})`}
              >
                {z >= 0.5 &&
                  [10, 20, 30, 40].map((v) => (
                    <g key={v} stroke="var(--grid-minor)" vectorEffect="non-scaling-stroke">
                      <line x1={v} y1={0} x2={v} y2={50} vectorEffect="non-scaling-stroke" />
                      <line x1={0} y1={v} x2={50} y2={v} vectorEffect="non-scaling-stroke" />
                    </g>
                  ))}
                <path d="M0 0H50M0 0V50" stroke="var(--grid-major)" fill="none" vectorEffect="non-scaling-stroke" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#cc-grid)" pointerEvents="none" />
          </>
        )}

        <g transform={`translate(${vp.x} ${vp.y}) scale(${z})`}>
          {/* Content, one group per visible layer, bottom to top. Exported as-is. */}
          <g ref={contentRef}>
            {page.layers
              .filter((l) => l.visible)
              .map((layer) => (
                <g key={layer.id} pointerEvents={layer.locked ? 'none' : undefined}>
                  {buckets.get(layer.id)!.map((id) => {
                    const it = page.items[id];
                    if (isShape(it))
                      return (
                        <ShapeView
                          key={id}
                          shape={it}
                          hideText={editingId === id}
                          locked={layer.locked}
                          imageSrc={shapeImageSrc(it, assets)}
                        />
                      );
                    if (isConnector(it))
                      return (
                        <ConnectorView
                          key={id}
                          connector={it}
                          points={connectorPoints(page, it, obstacles)}
                          hideLabel={editingId === id}
                          labelStacks={endLabelStacks(page, it)}
                        />
                      );
                    return null;
                  })}
                </g>
              ))}
          </g>

          {/* Overlay: selection, handles, guides, attach feedback. Not exported. */}
          <g>
            {groupBoxes.map((b, i) => (
              <rect
                key={i}
                x={b.x - 6 / z}
                y={b.y - 6 / z}
                width={b.w + 12 / z}
                height={b.h + 12 / z}
                fill="none"
                stroke={SELECT_COLOR}
                strokeWidth={1 / z}
                strokeDasharray={`${6 / z} ${4 / z}`}
                pointerEvents="none"
              />
            ))}

            {/* The shape being edited shows the editor's own outline instead. */}
            {selectedShapes.filter((s) => s.id !== editingId).map((s) => (
              <rect
                key={s.id}
                transform={shapeTransform(s)}
                width={s.w}
                height={s.h}
                fill="none"
                stroke={SELECT_COLOR}
                strokeWidth={1.5 / z}
                strokeDasharray={selectedShapes.length > 1 ? `${4 / z} ${3 / z}` : undefined}
                pointerEvents="none"
              />
            ))}

            {attachBody && attachArea && (
              <rect
                transform={shapeTransform(attachBody)}
                x={attachArea.x}
                y={attachArea.y}
                width={attachArea.w}
                height={attachArea.h}
                fill="rgba(47,111,235,0.08)"
                stroke={SELECT_COLOR}
                strokeWidth={2 / z}
                pointerEvents="none"
              />
            )}
            {attachPoint && (
              <circle
                cx={attachPoint.x}
                cy={attachPoint.y}
                r={5 / z}
                fill={SELECT_COLOR}
                stroke="#ffffff"
                strokeWidth={1.5 / z}
                pointerEvents="none"
              />
            )}

            {single && (
              // Drawn in the shape's own (rotated) frame, so handles sit on its corners.
              <g transform={shapeTransform(single)}>
                <line
                  x1={single.w / 2}
                  y1={0}
                  x2={single.w / 2}
                  y2={-ROTATE_HANDLE_OFFSET / z}
                  stroke={SELECT_COLOR}
                  strokeWidth={1 / z}
                  pointerEvents="none"
                />
                <circle
                  data-hit="rotate"
                  data-id={single.id}
                  className="rotate-handle"
                  cx={single.w / 2}
                  cy={-ROTATE_HANDLE_OFFSET / z}
                  r={5 / z}
                  fill="#ffffff"
                  stroke={SELECT_COLOR}
                  strokeWidth={1.5 / z}
                />
                {HANDLES.map((h) => {
                  const cx = h.includes('w') ? 0 : single.w;
                  const cy = h.includes('n') ? 0 : single.h;
                  return (
                    <rect
                      key={h}
                      data-hit="handle"
                      data-id={single.id}
                      data-handle={h}
                      className={`handle handle-${h}`}
                      x={cx - handleSize / 2}
                      y={cy - handleSize / 2}
                      width={handleSize}
                      height={handleSize}
                      fill="#ffffff"
                      stroke={SELECT_COLOR}
                      strokeWidth={1.5 / z}
                    />
                  );
                })}
              </g>
            )}

            {curved &&
              (() => {
                const [a, b] = connectorEnds(page, curved);
                const m = curveMidpoint(a.p, b.p, curved.bend ?? 0);
                return (
                  <rect
                    data-hit="bend"
                    data-id={curved.id}
                    className="bend-handle"
                    x={m.x - handleSize / 2}
                    y={m.y - handleSize / 2}
                    width={handleSize}
                    height={handleSize}
                    transform={`rotate(45 ${m.x} ${m.y})`}
                    fill="#ffffff"
                    stroke={SELECT_COLOR}
                    strokeWidth={1.5 / z}
                  />
                );
              })()}

            {selectedConnectors.map((c) => {
              const pts = connectorPoints(page, c, obstacles);
              return (['source', 'target'] as const).map((end) => {
                const p = end === 'source' ? pts[0] : pts[pts.length - 1];
                return (
                  <circle
                    key={`${c.id}-${end}`}
                    data-hit="cend"
                    data-id={c.id}
                    data-end={end}
                    className="cend"
                    cx={p.x}
                    cy={p.y}
                    r={5 / z}
                    fill={c[end].shapeId ? SELECT_COLOR : '#ffffff'}
                    stroke={SELECT_COLOR}
                    strokeWidth={1.5 / z}
                  />
                );
              });
            })}

            {guides.map((g, i) =>
              g.axis === 'x' ? (
                <line key={i} x1={g.pos} x2={g.pos} y1={g.from - 10} y2={g.to + 10} className="guide" strokeWidth={1 / z} />
              ) : (
                <line key={i} y1={g.pos} y2={g.pos} x1={g.from - 10} x2={g.to + 10} className="guide" strokeWidth={1 / z} />
              ),
            )}

            {marquee && (
              <rect
                x={marquee.x}
                y={marquee.y}
                width={marquee.w}
                height={marquee.h}
                fill="rgba(47,111,235,0.08)"
                stroke={SELECT_COLOR}
                strokeWidth={1 / z}
                pointerEvents="none"
              />
            )}
          </g>
        </g>
      </svg>
      {editingId && <TextEditor key={editingId} id={editingId} />}
      {menu && <ContextMenu x={menu.x} y={menu.y} world={menu.world} onClose={() => setMenu(null)} />}
    </div>
  );
}
