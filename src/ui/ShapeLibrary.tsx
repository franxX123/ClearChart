import { useState } from 'react';
import { SHAPE_DRAG_MIME } from '../canvas/Canvas';
import { useStore } from '../model/store';
import { LIBRARY, SHAPES, type LibraryEntry } from '../shapes/library';

function Thumb({ entry }: { entry: LibraryEntry }) {
  const pad = 3;
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

export function ShapeLibrary() {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const entries = LIBRARY.map((entry, idx) => ({ entry, idx })).filter(({ entry }) => entry.label.toLowerCase().includes(q));
  const categories = [...new Set(entries.map((e) => e.entry.category))];

  const addAtCenter = (entry: LibraryEntry) => {
    const { viewport: vp, canvasSize } = useStore.getState();
    useStore.getState().addShape(entry, {
      x: (canvasSize.w / 2 - vp.x) / vp.zoom,
      y: (canvasSize.h / 2 - vp.y) / vp.zoom,
    });
  };

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
              .map(({ entry, idx }) => (
                <button
                  key={idx}
                  className="shape-tile"
                  title={`${entry.label} — click or drag onto the canvas`}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(SHAPE_DRAG_MIME, String(idx));
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() => addAtCenter(entry)}
                >
                  <Thumb entry={entry} />
                  <span>{entry.label}</span>
                </button>
              ))}
          </div>
        </section>
      ))}
      {entries.length === 0 && <p className="muted">No shapes match “{query}”.</p>}
      <div className="hint muted">
        Drag a shape onto the canvas. Hover a shape and drag from a blue dot to draw a line. Double-click to edit
        text. Space + drag or scroll to pan, Ctrl + scroll to zoom.
      </div>
    </aside>
  );
}
