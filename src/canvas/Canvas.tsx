import { useEffect, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { ConnectorView } from '../connectors/ConnectorView';
import { connectorPoints, findAttachment, shapePorts } from '../connectors/routing';
import { isConnector, isShape } from '../model/doc';
import { useStore, type Viewport } from '../model/store';
import type { Endpoint, Point, Rect } from '../model/types';
import { LIBRARY } from '../shapes/library';
import { GRID, hitShape, itemsInRect, normRect, snapToGrid, unionRects } from './geometry';
import { ShapeView } from './ShapeView';
import { snapMove, type Guide } from './snap';
import { TextEditor } from './TextEditor';

export const SHAPE_DRAG_MIME = 'application/x-clearchart-shape';

/** The content layer, read by SVG/PNG export. */
export const canvasRefs: { content: SVGGElement | null } = { content: null };

type Handle = 'nw' | 'ne' | 'se' | 'sw';
const HANDLES: Handle[] = ['nw', 'ne', 'se', 'sw'];
const MIN_SIZE = 10;
const SELECT_COLOR = '#2f6feb';

type Drag =
  | { kind: 'pan'; sx: number; sy: number; vp0: Viewport }
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

  // Wheel: pinch or ctrl/cmd+wheel zooms around the cursor, plain wheel pans.
  // Registered natively because React's wheel listener is passive.
  useEffect(() => {
    const svg = svgRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const st = useStore.getState();
      if (e.ctrlKey || e.metaKey) {
        const r = svg.getBoundingClientRect();
        st.zoomBy(Math.exp(-e.deltaY * 0.01), { x: e.clientX - r.left, y: e.clientY - r.top });
      } else {
        const v = st.viewport;
        st.setViewport({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
      }
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

  const toWorld = (clientX: number, clientY: number): Point => {
    const r = svgRef.current!.getBoundingClientRect();
    const v = useStore.getState().viewport;
    return { x: (clientX - r.left - v.x) / v.zoom, y: (clientY - r.top - v.y) / v.zoom };
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button === 2) return;
    const st = useStore.getState();
    if (st.editingId) return;
    svgRef.current!.setPointerCapture(e.pointerId);
    const w = toWorld(e.clientX, e.clientY);

    if (e.button === 1 || spaceDown.current) {
      drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, vp0: st.viewport };
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
      return;
    }
    if (hit === 'shape' || hit === 'connector') {
      let sel = st.selection;
      if (e.shiftKey) {
        if (sel.includes(id)) {
          st.setSelection(sel.filter((x) => x !== id));
          return;
        }
        sel = [...sel, id];
      } else if (!sel.includes(id)) {
        sel = [id];
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

    if (!d) {
      setHoverId(hitShape(st.doc, w, 10 / zoom)?.id ?? null);
      return;
    }

    switch (d.kind) {
      case 'pan':
        st.setViewport({ ...d.vp0, x: d.vp0.x + e.clientX - d.sx, y: d.vp0.y + e.clientY - d.sy });
        break;

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
        const { orig, handle } = d;
        let left = orig.x;
        let right = orig.x + orig.w;
        let top = orig.y;
        let bottom = orig.y + orig.h;
        const g = (v: number) => (st.snapToGrid ? snapToGrid(v) : v);
        if (handle.includes('w')) left = g(left + w.x - d.start.x);
        if (handle.includes('e')) right = g(right + w.x - d.start.x);
        if (handle.includes('n')) top = g(top + w.y - d.start.y);
        if (handle.includes('s')) bottom = g(bottom + w.y - d.start.y);
        if (right - left < MIN_SIZE) {
          if (handle.includes('w')) left = right - MIN_SIZE;
          else right = left + MIN_SIZE;
        }
        if (bottom - top < MIN_SIZE) {
          if (handle.includes('n')) top = bottom - MIN_SIZE;
          else bottom = top + MIN_SIZE;
        }
        st.update((doc) => {
          const s = doc.items[d.id];
          if (isShape(s)) Object.assign(s, { x: left, y: top, w: right - left, h: bottom - top });
        });
        break;
      }

      case 'marquee': {
        const r = normRect(d.start, w);
        setMarquee(r);
        st.setSelection([...new Set([...d.base, ...itemsInRect(st.doc, r)])]);
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
        // A plain click on an item that was part of a multi-selection selects just that item.
        else if (!e.shiftKey && st.selection.length > 1) st.setSelection([d.clicked]);
        setGuides([]);
        break;
      case 'resize':
        st.endBatch();
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

  const onDragOver = (e: DragEvent) => {
    if (e.dataTransfer.types.includes(SHAPE_DRAG_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  const onDrop = (e: DragEvent) => {
    const idx = Number(e.dataTransfer.getData(SHAPE_DRAG_MIME));
    const entry = LIBRARY[idx];
    if (!entry) return;
    e.preventDefault();
    useStore.getState().addShape(entry, toWorld(e.clientX, e.clientY));
  };

  // ---- rendering ----
  const z = vp.zoom;
  const selectedShapes = selection.map((id) => doc.items[id]).filter(isShape);
  const selectedConnectors = selection.map((id) => doc.items[id]).filter(isConnector);
  const hovered = hoverId ? doc.items[hoverId] : undefined;
  const showPorts = isShape(hovered) && (!drag.current || drag.current.kind === 'connect');
  const handleSize = 8 / z;
  // Shape a dragged line end will attach to by its body (auto port), to highlight it.
  const attachTarget = attachHint?.shapeId && attachHint.port == null ? doc.items[attachHint.shapeId] : undefined;
  const attachBody = isShape(attachTarget) ? attachTarget : null;

  return (
    <div
      ref={containerRef}
      className={`canvas${panning ? ' panning' : ''}`}
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
        onPointerLeave={() => !drag.current && setHoverId(null)}
        onDoubleClick={onDoubleClick}
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
          <g ref={contentRef}>
            {doc.order.map((id) => {
              const it = doc.items[id];
              if (isShape(it)) return <ShapeView key={id} shape={it} hideText={editingId === id} />;
              if (isConnector(it))
                return (
                  <ConnectorView
                    key={id}
                    connector={it}
                    points={connectorPoints(doc, it)}
                    hideLabel={editingId === id}
                  />
                );
              return null;
            })}
          </g>

          {/* Overlay: selection, handles, ports, guides. Not exported. */}
          <g>
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
    </div>
  );
}
