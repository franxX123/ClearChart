import { useState } from 'react';
import { SHAPE_DRAG_MIME } from '../canvas/Canvas';
import { viewCenter } from '../model/store';
import { isLineEntry, LIBRARY, SHAPES, type LibraryEntry } from '../shapes/library';
import { placeEntry } from './libraryActions';
import { TemplateLibrary } from './TemplateLibrary';

function Thumb({ entry }: { entry: LibraryEntry }) {
  const pad = 3;
  if (isLineEntry(entry)) {
    return (
      <svg viewBox="0 0 44 32" width={44} height={32} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round">
        <path d="M6 16H36" />
        <path d="M30 11l7 5-7 5z" fill="currentColor" />
      </svg>
    );
  }
  const isText = entry.kind === 'text';
  if (entry.kind === 'image') {
    return (
      <svg viewBox="-2 -2 28 24" width={44} height={32} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round">
        <rect x={0} y={0} width={24} height={20} rx={2} />
        <circle cx={7} cy={6.5} r={2} />
        <path d="M2 17l6-6 4 4 3-3 7 6" />
      </svg>
    );
  }
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

  const tip = (entry: LibraryEntry) => {
    const key = entry.shortcut ? ` (${entry.shortcut})` : '';
    if (entry.kind === 'image') return `Image${key} — click to pick a file, or drop image files on the canvas`;
    if (isLineEntry(entry)) return `${entry.label}${key} — a line; drag its ends onto shapes. Change arrows and routing in Properties`;
    return `${entry.label}${key} — click or drag onto the canvas`;
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
                  title={tip(entry)}
                  draggable={entry.kind !== 'image'}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(SHAPE_DRAG_MIME, String(idx));
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() => placeEntry(entry, viewCenter())}
                >
                  {entry.shortcut && (
                    <kbd className="tile-key" aria-hidden="true">
                      {entry.shortcut}
                    </kbd>
                  )}
                  <Thumb entry={entry} />
                  <span>{entry.label}</span>
                </button>
              ))}
          </div>
        </section>
      ))}
      {entries.length === 0 && <p className="muted">No shapes match “{query}”.</p>}
      <TemplateLibrary query={q} />
      <div className="hint muted">
        Drag a shape onto the canvas. Hover a shape and drag from a blue dot to draw a line. Double-click to edit
        text. Keys 1–7 add the basic shapes at the pointer. Scroll to zoom; right-drag, Shift + scroll or Space +
        drag to pan. Right-click for more.
      </div>
    </aside>
  );
}
