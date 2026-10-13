import { useState } from 'react';
import { SHAPE_DRAG_MIME, TEMPLATE_DRAG_PREFIX } from '../canvas/Canvas';
import { pickImageFile, readImageFile } from '../io/image';
import { useStore } from '../model/store';
import type { LineTemplate, NodeTemplate } from '../model/types';
import { LIBRARY, SHAPES, type LibraryEntry } from '../shapes/library';
import { useDialog } from './dialogState';

function Thumb({ entry }: { entry: LibraryEntry }) {
  const pad = 3;
  if (entry.kind === 'image') {
    // A small landscape: frame, sun and hill.
    return (
      <svg viewBox="0 0 28 22" width={44} height={32} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round">
        <rect x={2} y={2} width={24} height={18} rx={2} fill="var(--thumb-fill)" />
        <circle cx={9} cy={8} r={2} />
        <path d="M3 18l7-6 5 4 4-3 6 5" />
      </svg>
    );
  }
  const isText = entry.kind === 'text';
  return (
    <svg viewBox={`${-pad} ${-pad} ${entry.w + pad * 2} ${entry.h + pad * 2}`} width={44} height={32}>
      {isText ? (
        <text x={entry.w / 2} y={entry.h / 2} fontSize={entry.h * 0.8} textAnchor="middle" dominantBaseline="central" fill="currentColor">
          T
        </text>
      ) : (
        <path
          d={SHAPES[entry.kind].path(entry.w, entry.h)}
          fill={entry.style?.fill ?? 'var(--thumb-fill)'}
          stroke="currentColor"
          strokeWidth={Math.max(entry.w, entry.h) / 24}
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

/** World point at the center of the visible canvas. */
function viewCenter() {
  const { viewport: vp, canvasSize } = useStore.getState();
  return { x: (canvasSize.w / 2 - vp.x) / vp.zoom, y: (canvasSize.h / 2 - vp.y) / vp.zoom };
}

/** Asks for a picture file and adds it at the center of the view. */
async function addImageFromDevice() {
  const file = await pickImageFile();
  if (!file) return;
  try {
    const img = await readImageFile(file);
    useStore.getState().addImage(img.src, img.w, img.h, viewCenter());
  } catch (err) {
    alert(`Couldn't add the picture: ${(err as Error).message}`);
  }
}

/** Preview of a node template: its shape, in its colors. */
function NodeThumb({ t }: { t: NodeTemplate }) {
  const pad = 3;
  const fill = t.style.fill === 'none' ? 'transparent' : t.style.fill;
  const stroke = t.style.stroke === 'none' ? 'currentColor' : t.style.stroke;
  return (
    <svg viewBox={`${-pad} ${-pad} ${t.w + pad * 2} ${t.h + pad * 2}`} width={44} height={32}>
      <path d={SHAPES[t.kind].path(t.w, t.h)} fill={fill} stroke={stroke} strokeWidth={Math.max(t.w, t.h) / 24} strokeLinejoin="round" />
    </svg>
  );
}

/** Preview of a line template: a short line in its color and pattern, with its end labels' spots. */
function LineThumb({ t }: { t: LineTemplate }) {
  const dash = t.style.dash === 'dashed' ? '5 3' : t.style.dash === 'dotted' ? '1 3' : undefined;
  return (
    <svg viewBox="0 0 44 32" width={44} height={32}>
      <rect x={1} y={11} width={8} height={10} rx={2} fill="none" stroke="currentColor" />
      <rect x={35} y={11} width={8} height={10} rx={2} fill="none" stroke="currentColor" />
      <path d={t.routing === 'curved' ? 'M9 16Q22 6 35 16' : 'M9 16H35'} fill="none" stroke={t.style.stroke} strokeWidth={2} strokeDasharray={dash} />
    </svg>
  );
}

/**
 * The Graphs section: node templates (click or drag to add) and line templates (click to draw
 * arrows with them). The ⋯ button edits a template.
 */
function GraphTemplates({ query }: { query: string }) {
  const templates = useStore((s) => s.doc.templates);
  const arrowTemplateId = useStore((s) => s.arrowTemplateId);
  const tool = useStore((s) => s.tool);
  const match = (name: string) => name.toLowerCase().includes(query);
  const nodes = templates?.nodes.filter((t) => match(t.name)) ?? [];
  const lines = templates?.lines.filter((t) => match(t.name)) ?? [];
  const edit = (templateId: string) => useDialog.getState().open({ kind: 'editTemplate', templateId });
  if (query && !nodes.length && !lines.length) return null;

  return (
    <section>
      <h3>Graphs</h3>
      {nodes.length + lines.length === 0 ? (
        <p className="muted hint-small">
          Right-click a shape or line and choose <b>Save as template</b>, or import a CSV, to make components here.
        </p>
      ) : (
        <div className="shape-grid">
          {nodes.map((t) => (
            <div key={t.id} className="template-tile">
              <button
                className="shape-tile"
                title={`${t.name} — click or drag onto the canvas`}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(SHAPE_DRAG_MIME, `${TEMPLATE_DRAG_PREFIX}${t.id}`);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={() => useStore.getState().addFromTemplate(t.id, viewCenter())}
              >
                <NodeThumb t={t} />
                <span>{t.name}</span>
              </button>
              <button className="tile-menu" title={`Edit ${t.name}`} aria-label={`Edit template ${t.name}`} onClick={() => edit(t.id)}>
                ⋯
              </button>
            </div>
          ))}
          {lines.map((t) => {
            const active = tool === 'arrow' && arrowTemplateId === t.id;
            return (
              <div key={t.id} className="template-tile">
                <button
                  className={`shape-tile${active ? ' active' : ''}`}
                  title={`${t.name} — click, then drag on the canvas to draw it`}
                  aria-pressed={active}
                  onClick={() => (active ? useStore.getState().setTool('select') : useStore.getState().setArrowTemplate(t.id))}
                >
                  <LineThumb t={t} />
                  <span>{t.name}</span>
                </button>
                <button className="tile-menu" title={`Edit ${t.name}`} aria-label={`Edit template ${t.name}`} onClick={() => edit(t.id)}>
                  ⋯
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function ShapeLibrary() {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const entries = LIBRARY.map((entry, idx) => ({ entry, idx })).filter(({ entry }) => entry.label.toLowerCase().includes(q));
  const categories = [...new Set(entries.map((e) => e.entry.category))];

  return (
    <aside className="sidebar">
      <input
        className="search"
        type="search"
        placeholder="Search shapes"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {categories.map((cat) => (
        <section key={cat}>
          <h3>{cat}</h3>
          <div className="shape-grid">
            {entries
              .filter((e) => e.entry.category === cat)
              .map(({ entry, idx }) =>
                entry.kind === 'image' ? (
                  <button key={idx} className="shape-tile" title="Add a picture from this device" onClick={addImageFromDevice}>
                    <Thumb entry={entry} />
                    <span>{entry.label}</span>
                  </button>
                ) : (
                  <button
                    key={idx}
                    className="shape-tile"
                    title={`${entry.label} — click or drag onto the canvas`}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(SHAPE_DRAG_MIME, String(idx));
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    onClick={() => useStore.getState().addShape(entry, viewCenter())}
                  >
                    <Thumb entry={entry} />
                    <span>{entry.label}</span>
                  </button>
                ),
              )}
          </div>
        </section>
      ))}
      {entries.length === 0 && <p className="muted">No shapes match “{query}”.</p>}
      <GraphTemplates query={q} />
      <div className="hint muted">
        Drag a shape onto the canvas. Press A (or the Arrow button) and drag to draw an arrow; drop its end on any
        part of a shape to attach it. Double-click to edit text. Scroll to zoom, right-drag or Space + drag to pan,
        right-click for more actions.
      </div>
    </aside>
  );
}
