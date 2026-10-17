import { useCallback, useEffect, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { ConnectorView } from '../connectors/ConnectorView';
import { connectorPoints, findAttachment, shapePorts } from '../connectors/routing';
import { addImageFromFile } from '../io/image';
import { isConnector, isShape } from '../model/doc';
import { expandToGroups, topGroup, wholeGroupsOnly } from '../model/groups';
import { useStore, type Viewport } from '../model/store';
import type { Endpoint, Point, Rect } from '../model/types';
import { LIBRARY } from '../shapes/library';
import { useTemplates } from '../templates/store';
import { canvasMenuItems } from '../ui/canvasMenu';
import { ContextMenu } from '../ui/ContextMenu';
import { placeEntry } from '../ui/libraryActions';
import { GRID, hitShape, itemBounds, itemsInRect, normRect, resizeRect, unionRects, type Handle } from './geometry';
import { ShapeView } from './ShapeView';
import { snapMove, type Guide } from './snap';
import { FONT_FAMILY } from './text';
import { TextEditor } from './TextEditor';
import { wheelPan, wheelZoomFactor } from './wheel';

export const SHAPE_DRAG_MIME = 'application/x-clearchart-shape';
/** Payload: JSON `{ templateId, componentId }`. */
export const COMPONENT_DRAG_MIME = 'application/x-clearchart-component';

/**
 * The content layer (read by SVG/PNG export), the <svg>, and the last pointer position over
 * the canvas in client coordinates (null when the pointer is elsewhere).
 */
export const canvasRefs: { content: SVGGElement | null; svg: SVGSVGElement | null; pointer: Point | null } = {
  content: null,
  svg: null,
  pointer: null,
};

/** World point under the mouse pointer, or null if it isn't over the canvas. */
export function pointerWorld(): Point | null {
  const { svg, pointer } = canvasRefs;
  if (!svg || !pointer) return null;
  const r = svg.getBoundingClientRect();
  const v = useStore.getState().viewport;
  return { x: (pointer.x - r.left - v.x) / v.zoom, y: (pointer.y - r.top - v.y) / v.zoom };
}

const HANDLES: Handle[] = ['nw', 'ne', 'se', 'sw'];
/** A pan starts after this many screen px, so a right-click that doesn't move opens the menu. */
const PAN_SLOP = 4;
/** Browsers fire `contextmenu` on press or just after release; ignore it this long after a right release. */
const CONTEXTMENU_GRACE_MS = 300;
const SELECT_COLOR = '#2f6feb';
/** Gap between a selected group and the dashed box drawn around it, in screen px. */
const GROUP_PAD = 6;

type Drag =
  | { kind: 'pan'; sx: number; sy: number; vp0: Viewport; button: number; moved: boolean }
  | {
      kind: 'move';
      start: Point;
      clicked: string;
      started: boolean;
      shapes: Record<string, Rect>;
      freeEnds: { id: string; end: 'source' | 'target'; origin: Point }[];
    }
  | { kind: 'resize'; id: string; handle: Handle; start: Point; orig: Rect }
  | { kind: 'marquee'; start: Point; base: string[] }
  | { kind: 'connect'; id: string; end: 'source' | 'target'; isNew: boolean; start: Point };

/** Live "W × H" label next to the corner being dragged, so equal sides (a square) are easy to hit. */
function SizeReadout({ shape, handle, zoom }: { shape: Rect; handle: Handle; zoom: number }) {
  const west = handle.includes('w');
  const north = handle.includes('n');
  const text = `${Math.round(shape.w)} × ${Math.round(shape.h)}`;
  const fs = 11 / zoom;
  const w = text.length * fs * 0.6 + 12 / zoom;
  const h = fs + 8 / zoom;
  const off = 10 / zoom;
  const x = west ? shape.x - off - w : shape.x + shape.w + off;
  const y = north ? shape.y - off - h : shape.y + shape.h + off;
  return (
    <g pointerEvents="none">
      <rect x={x} y={y} width={w} height={h} rx={3 / zoom} fill={SELECT_COLOR} />
      <text
        x={x + w / 2}
        y={y + h / 2}
        fill="#ffffff"
        fontFamily={FONT_FAMILY}
        fontSize={fs}
        textAnchor="middle"
        dominantBaseline="central"
      >
        {text}
      </text>
    </g>
  );
}

export function Canvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const contentRef = useRef<SVGGElement>(null);
  const drag = useRef<Drag | null>(null);
  const spaceDown = useRef(false);

  const doc = useStore((s) => s.doc);
  const selection = useStore((s) => s.selection);
  const vp = useStore((s) => s.viewport);
  const editingId = useStore((s) => s.editingId);
  const showGrid = useStore((s) => s.showGrid);

  const [hoverId, setHoverId] = useState<string | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [attachHint, setAttachHint] = useState<Endpoint | null>(null);
  const [panning, setPanning] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; at: Point } | null>(null);
  const [grabbing, setGrabbing] = useState(false);
  const [resizing, setResizing] = useState<{ id: string; handle: Handle } | null>(null);
  const lastRightUp = useRef(0);

  useEffect(() => {
    canvasRefs.content = contentRef.current;
    canvasRefs.svg = svgRef.current;
    return () => {
      canvasRefs.content = null;
      canvasRefs.svg = null;
    };
  }, []);

  // Track canvas size for zoom-to-fit and zooming around the center.
  useEffect(() => {
    const el = containerRef.current!;
    const ro = new ResizeObserver(() => useStore.getState().setCanvasSize(el.clientWidth, el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Wheel (and trackpad pinch, which arrives as ctrl+wheel) zooms around the cursor;
  // Shift+wheel pans. Registered natively because React's wheel listener is passive.
  useEffect(() => {
    const svg = svgRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const st = useStore.getState();
      if (e.shiftKey) {
        const { dx, dy } = wheelPan(e);
        const v = st.viewport;
        st.setViewport({ ...v, x: v.x - dx, y: v.y - dy });
      } else {
        const r = svg.getBoundingClientRect();
        st.zoomBy(wheelZoomFactor(e), { x: e.clientX - r.left, y: e.clientY - r.top });
      }
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  // Hold space to pan with the left button.
  useEffect(() => {
    const typing = (e: KeyboardEvent) => (e.target as HTMLElement).closest('input, textarea, select, .modal, .context-menu');
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
        setPanning(false);
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  const toWorld = (clientX: number, clientY: number): Point => {
    const r = svgRef.current!.getBoundingClientRect();
    const v = useStore.getState().viewport;
    return { x: (clientX - r.left - v.x) / v.zoom, y: (clientY - r.top - v.y) / v.zoom };
  };

  /** Opens the context menu at a client point, first selecting what's under it (with its group) if unselected. */
  const openMenuAt = (clientX: number, clientY: number) => {
    const st = useStore.getState();
    if (st.editingId) return;
    const at = toWorld(clientX, clientY);
    // The geometric fallback covers the ports and handles drawn over a shape.
    const under = document.elementFromPoint(clientX, clientY);
    const el = under?.closest('[data-hit="shape"], [data-hit="connector"]');
    const id = el?.getAttribute('data-id') ?? hitShape(st.doc, at)?.id;
    if (id && !st.selection.includes(id)) st.setSelection(expandToGroups(st.doc, [id]));
    setMenu({ x: clientX, y: clientY, at });
  };

  // The keyboard Menu key (or Shift+F10) opens the canvas menu at the pointer. Keyboard-triggered
  // menus aren't from the right button (Chrome reports button -1) and target the focused
  // element; right-clicks elsewhere, text fields and dialogs keep the browser's menu.
  useEffect(() => {
    const onKeyMenu = (e: MouseEvent) => {
      const target = e.target as Element;
      if (e.button === 2 || target.closest?.('.canvas, input, textarea, select, [contenteditable="true"], .modal, .context-menu')) {
        return;
      }
      e.preventDefault();
      const r = svgRef.current!.getBoundingClientRect();
      const p = canvasRefs.pointer ?? { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      openMenuAt(p.x, p.y);
    };
    window.addEventListener('contextmenu', onKeyMenu);
    return () => window.removeEventListener('contextmenu', onKeyMenu);
    // openMenuAt only uses refs, store getters and state setters, so the first one stays valid.
  }, []);

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    const st = useStore.getState();
    if (st.editingId) return;
    svgRef.current!.setPointerCapture(e.pointerId);
    const w = toWorld(e.clientX, e.clientY);

    // Middle or right button, or Space held: pan. A right press that doesn't move opens the menu on release.
    if (e.button === 1 || e.button === 2 || spaceDown.current) {
      drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, vp0: st.viewport, button: e.button, moved: false };
      return;
    }

    const el = (e.target as Element).closest('[data-hit]');
    const hit = el?.getAttribute('data-hit');
    const id = el?.getAttribute('data-id') ?? '';

    if (hit === 'port') {
      const port = Number(el!.getAttribute('data-port'));
      st.beginBatch();
      const cid = st.addConnector({ shapeId: id, port, x: w.x, y: w.y }, { x: w.x, y: w.y });
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
    if (hit === 'handle') {
      const s = st.doc.items[id];
      if (!isShape(s)) return;
      st.beginBatch();
      const handle = el!.getAttribute('data-handle') as Handle;
      drag.current = { kind: 'resize', id, handle, start: w, orig: { x: s.x, y: s.y, w: s.w, h: s.h } };
      setResizing({ id, handle });
      return;
    }
    if (hit === 'shape' || hit === 'connector') {
      // A press picks the item's whole group; double-click picks a single member.
      const unit = expandToGroups(st.doc, [id]);
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
      const shapes: Record<string, Rect> = {};
      const freeEnds: { id: string; end: 'source' | 'target'; origin: Point }[] = [];
      for (const sid of sel) {
        const it = st.doc.items[sid];
        if (isShape(it)) shapes[sid] = { x: it.x, y: it.y, w: it.w, h: it.h };
        if (isConnector(it)) {
          for (const end of ['source', 'target'] as const) {
            if (!it[end].shapeId) freeEnds.push({ id: sid, end, origin: { x: it[end].x, y: it[end].y } });
          }
        }
      }
      drag.current = { kind: 'move', start: w, clicked: id, started: false, shapes, freeEnds };
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
    canvasRefs.pointer = { x: e.clientX, y: e.clientY };

    if (!d) {
      setHoverId(hitShape(st.doc, w, 10 / zoom)?.id ?? null);
      return;
    }

    switch (d.kind) {
      case 'pan': {
        const dx = e.clientX - d.sx;
        const dy = e.clientY - d.sy;
        if (!d.moved) {
          if (Math.hypot(dx, dy) < PAN_SLOP) return;
          d.moved = true;
          setGrabbing(true);
        }
        st.setViewport({ ...d.vp0, x: d.vp0.x + dx, y: d.vp0.y + dy });
        break;
      }

      case 'move': {
        let dx = w.x - d.start.x;
        let dy = w.y - d.start.y;
        if (!d.started) {
          if (Math.hypot(dx, dy) * zoom < 3) return;
          d.started = true;
          st.beginBatch();
          setHoverId(null);
        }
        const moving = unionRects(Object.values(d.shapes));
        if (moving) {
          const others = st.doc.order
            .map((id) => st.doc.items[id])
            .filter((it) => isShape(it) && !d.shapes[it.id]) as Rect[];
          const snap = snapMove(
            { ...moving, x: moving.x + dx, y: moving.y + dy },
            others,
            6 / zoom,
            st.snapToGrid ? GRID : 0,
          );
          dx += snap.dx;
          dy += snap.dy;
          setGuides(snap.guides);
        }
        st.update((doc) => {
          for (const [id, o] of Object.entries(d.shapes)) {
            const s = doc.items[id];
            if (isShape(s)) {
              s.x = o.x + dx;
              s.y = o.y + dy;
            }
          }
          for (const f of d.freeEnds) {
            const c = doc.items[f.id];
            if (isConnector(c)) {
              c[f.end].x = f.origin.x + dx;
              c[f.end].y = f.origin.y + dy;
            }
          }
        });
        break;
      }

      case 'resize': {
        // Shift keeps the proportions (a circle stays a circle).
        const r = resizeRect(d.orig, d.handle, w.x - d.start.x, w.y - d.start.y, {
          keepRatio: e.shiftKey,
          grid: st.snapToGrid ? GRID : 0,
        });
        st.update((doc) => {
          const s = doc.items[d.id];
          if (isShape(s)) Object.assign(s, r);
        });
        break;
      }

      case 'marquee': {
        const r = normRect(d.start, w);
        setMarquee(r);
        st.setSelection([...new Set([...d.base, ...wholeGroupsOnly(st.doc, itemsInRect(st.doc, r))])]);
        break;
      }

      case 'connect': {
        const c = st.doc.items[d.id];
        if (!isConnector(c)) return;
        const other = d.end === 'target' ? c.source : c.target;
        let ep = findAttachment(st.doc, w, 10 / zoom);
        // Don't attach a line end to the exact port its other end uses.
        if (ep && ep.shapeId === other.shapeId && ep.port != null && ep.port === other.port) ep = null;
        setAttachHint(ep);
        setHoverId(ep?.shapeId ?? null);
        st.update((doc) => {
          const live = doc.items[d.id];
          if (isConnector(live)) live[d.end] = ep ?? { x: w.x, y: w.y };
        });
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
      case 'move':
        if (d.started) st.endBatch();
        // A plain click on an item that was part of a multi-selection selects just that item (and its group).
        else if (!e.shiftKey && st.selection.length > 1) st.setSelection(expandToGroups(st.doc, [d.clicked]));
        setGuides([]);
        break;
      case 'resize':
        st.endBatch();
        setResizing(null);
        break;
      case 'marquee':
        setMarquee(null);
        break;
      case 'connect': {
        const c = st.doc.items[d.id];
        const w = toWorld(e.clientX, e.clientY);
        const tooShort = Math.hypot(w.x - d.start.x, w.y - d.start.y) * st.viewport.zoom < 8;
        if (d.isNew && isConnector(c) && tooShort && !c.target.shapeId) {
          // A click on a port rather than a drag: select the shape instead of making a stub line.
          st.abortBatch();
          st.setSelection(c.source.shapeId ? [c.source.shapeId] : []);
        } else {
          st.endBatch();
        }
        setAttachHint(null);
        break;
      }
      case 'pan':
        setGrabbing(false);
        if (d.button === 2) {
          lastRightUp.current = Date.now();
          if (!d.moved && e.type === 'pointerup') openMenuAt(e.clientX, e.clientY);
        }
        break;
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    // Pointer capture retargets the dblclick to the <svg>, so find what's actually under the cursor.
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const el = under?.closest('[data-hit="shape"], [data-hit="connector"]');
    const id = el?.getAttribute('data-id');
    if (!id) return;
    const st = useStore.getState();
    st.setSelection([id]);
    st.setEditing(id);
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    // A right press is handled on release (pan if it moved, menu if not). Linux and macOS fire
    // this event on press, Windows just after release; either way it's ignored here.
    const d = drag.current;
    if ((d?.kind === 'pan' && d.button === 2) || Date.now() - lastRightUp.current < CONTEXTMENU_GRACE_MS) return;
    openMenuAt(e.clientX, e.clientY);
  };

  const onDragOver = (e: DragEvent) => {
    const types = e.dataTransfer.types;
    if (types.includes(SHAPE_DRAG_MIME) || types.includes(COMPONENT_DRAG_MIME) || types.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  const onDrop = (e: DragEvent) => {
    const at = toWorld(e.clientX, e.clientY);
    const images = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
    if (images.length) {
      e.preventDefault();
      images.forEach((f, i) => addImageFromFile(f, { x: at.x + i * 20, y: at.y + i * 20 }));
      return;
    }
    const comp = e.dataTransfer.getData(COMPONENT_DRAG_MIME);
    if (comp) {
      e.preventDefault();
      const { templateId, componentId } = JSON.parse(comp) as { templateId: string; componentId: string };
      const def = useTemplates
        .getState()
        .templates.find((t) => t.id === templateId)
        ?.nodes.find((c) => c.id === componentId);
      if (def) useStore.getState().addComponent(def, at);
      return;
    }
    const entry = LIBRARY[Number(e.dataTransfer.getData(SHAPE_DRAG_MIME))];
    if (!entry) return;
    e.preventDefault();
    void placeEntry(entry, at);
  };

  // ---- rendering ----
  const z = vp.zoom;
  const shapeAt = (ep: Endpoint) => {
    const s = ep.shapeId ? doc.items[ep.shapeId] : undefined;
    return isShape(s) ? s : undefined;
  };
  const selectedShapes = selection.map((id) => doc.items[id]).filter(isShape);
  const selectedConnectors = selection.map((id) => doc.items[id]).filter(isConnector);
  const hovered = hoverId ? doc.items[hoverId] : undefined;
  const showPorts = isShape(hovered) && (!drag.current || drag.current.kind === 'connect');
  const handleSize = 8 / z;
  // Shape a dragged line end will attach to by its body (auto port), to highlight it.
  const attachTarget = attachHint?.shapeId && attachHint.port == null ? doc.items[attachHint.shapeId] : undefined;
  const attachBody = isShape(attachTarget) ? attachTarget : null;
  // Groups whose members are all selected get a dashed box around them.
  const selected = new Set(selection);
  const groupMembers = new Map<string, string[]>();
  for (const id of doc.order) {
    const g = topGroup(doc.items[id]);
    if (g) groupMembers.set(g, [...(groupMembers.get(g) ?? []), id]);
  }
  const groupBoxes = [...groupMembers]
    .filter(([, ids]) => ids.every((id) => selected.has(id)))
    .map(([g, ids]) => [g, unionRects(ids.map((id) => itemBounds(doc, id)).filter((r): r is Rect => r !== null))] as const)
    .filter((e): e is readonly [string, Rect] => e[1] !== null);
  const gp = GROUP_PAD / z;

  return (
    <div
      ref={containerRef}
      className={`canvas${panning ? ' panning' : ''}${grabbing ? ' grabbing' : ''}`}
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
        onPointerLeave={() => {
          canvasRefs.pointer = null;
          if (!drag.current) setHoverId(null);
        }}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
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
          <g ref={contentRef}>
            {doc.order.map((id) => {
              const it = doc.items[id];
              if (isShape(it))
                return (
                  <ShapeView
                    key={id}
                    shape={it}
                    component={it.componentId ? doc.components?.[it.componentId] : undefined}
                    hideText={editingId === id}
                  />
                );
              if (isConnector(it))
                return (
                  <ConnectorView
                    key={id}
                    connector={it}
                    points={connectorPoints(doc, it)}
                    hideLabel={editingId === id}
                    endShapes={[shapeAt(it.source), shapeAt(it.target)]}
                  />
                );
              return null;
            })}
          </g>

          {/* Overlay: selection, handles, ports, guides. Not exported. */}
          <g>
            {groupBoxes.map(([g, b]) => (
              <rect
                key={g}
                x={b.x - gp}
                y={b.y - gp}
                width={b.w + gp * 2}
                height={b.h + gp * 2}
                fill="none"
                stroke={SELECT_COLOR}
                strokeWidth={1 / z}
                strokeDasharray={`${6 / z} ${4 / z}`}
                pointerEvents="none"
              />
            ))}
            {selectedShapes.map((s) => (
              <rect
                key={s.id}
                x={s.x}
                y={s.y}
                width={s.w}
                height={s.h}
                fill="none"
                stroke={SELECT_COLOR}
                strokeWidth={1.5 / z}
                strokeDasharray={selectedShapes.length > 1 ? `${4 / z} ${3 / z}` : undefined}
                pointerEvents="none"
              />
            ))}

            {showPorts &&
              shapePorts(hovered).map((pt, i) => {
                const active = attachHint?.shapeId === hovered.id && attachHint.port === i;
                return (
                  <circle
                    key={i}
                    data-hit="port"
                    data-id={hovered.id}
                    data-port={i}
                    className="port"
                    cx={pt.p.x}
                    cy={pt.p.y}
                    r={(active ? 6 : 4.5) / z}
                    fill={active ? SELECT_COLOR : '#ffffff'}
                    stroke={SELECT_COLOR}
                    strokeWidth={1.5 / z}
                  />
                );
              })}

            {attachBody && (
              <rect
                x={attachBody.x}
                y={attachBody.y}
                width={attachBody.w}
                height={attachBody.h}
                fill="rgba(47,111,235,0.08)"
                stroke={SELECT_COLOR}
                strokeWidth={2 / z}
                pointerEvents="none"
              />
            )}

            {selectedShapes.length === 1 &&
              selection.length === 1 &&
              !editingId &&
              HANDLES.map((h) => {
                const s = selectedShapes[0];
                const cx = h.includes('w') ? s.x : s.x + s.w;
                const cy = h.includes('n') ? s.y : s.y + s.h;
                return (
                  <rect
                    key={h}
                    data-hit="handle"
                    data-id={s.id}
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

            {selectedConnectors.map((c) => {
              const pts = connectorPoints(doc, c);
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

            {resizing && isShape(doc.items[resizing.id]) && (
              <SizeReadout shape={doc.items[resizing.id] as Rect} handle={resizing.handle} zoom={z} />
            )}

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
      {menu && <ContextMenu x={menu.x} y={menu.y} items={canvasMenuItems(menu.at)} onClose={closeMenu} />}
    </div>
  );
}
