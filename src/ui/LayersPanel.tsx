import { useState } from 'react';
import { layerBuckets } from '../model/page';
import { currentLayer, currentPage, useStore } from '../model/store';

const ICONS = {
  eye: 'M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5Zm7 2.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  eyeOff: 'M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5ZM2 14 14 2',
  lock: 'M4 7V5a4 4 0 0 1 8 0v2M3 7h10v7H3Z',
  unlock: 'M4 7V5a4 4 0 0 1 7.5-2M3 7h10v7H3Z',
  up: 'M8 13V3M4 7l4-4 4 4',
  down: 'M8 3v10M4 9l4 4 4-4',
  trash: 'M3 4h10M6 4V2h4v2M4.5 4l.5 10h6l.5-10',
};

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 16 16" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

/** Layers of the current page, top layer first. Click a row to make it the layer new items go on. */
export function LayersPanel() {
  const page = useStore(currentPage);
  const activeId = useStore((s) => currentLayer(s).id);
  const [renaming, setRenaming] = useState<string | null>(null);
  const st = useStore.getState;
  const counts = layerBuckets(page);
  const rows = [...page.layers].reverse();

  const remove = (id: string, name: string) => {
    const n = counts.get(id)?.length ?? 0;
    if (n && !confirm(`Delete layer "${name}" and the ${n} item${n === 1 ? '' : 's'} on it?`)) return;
    st().deleteLayer(id);
  };

  return (
    <section className="layers">
      <div className="section-head">
        <h3>Layers</h3>
        <button className="icon-btn" onClick={() => st().addLayer()} title="Add layer" aria-label="Add layer">
          +
        </button>
      </div>
      <ul className="layer-list">
        {rows.map((l, i) => (
          <li
            key={l.id}
            className={`layer-row${l.id === activeId ? ' active' : ''}${l.visible ? '' : ' hidden'}`}
            onClick={() => st().setActiveLayer(l.id)}
          >
            {renaming === l.id ? (
              <input
                className="layer-name-input"
                autoFocus
                defaultValue={l.name}
                aria-label="Layer name"
                onClick={(e) => e.stopPropagation()}
                onFocus={(e) => e.target.select()}
                onBlur={(e) => {
                  const name = e.target.value.trim();
                  if (name && name !== l.name) st().renameLayer(l.id, name);
                  setRenaming(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') e.currentTarget.value = l.name;
                  if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
                }}
              />
            ) : (
              <span className="layer-name" title="Double-click to rename" onDoubleClick={() => setRenaming(l.id)}>
                {l.name} <span className="muted">{counts.get(l.id)?.length ?? 0}</span>
              </span>
            )}
            <span className="layer-buttons" onClick={(e) => e.stopPropagation()}>
              <button
                className="icon-btn"
                onClick={() => st().setLayerFlags(l.id, { visible: !l.visible })}
                title={l.visible ? 'Hide layer' : 'Show layer'}
                aria-label={l.visible ? `Hide ${l.name}` : `Show ${l.name}`}
                aria-pressed={!l.visible}
              >
                <Icon d={l.visible ? ICONS.eye : ICONS.eyeOff} />
              </button>
              <button
                className={`icon-btn${l.locked ? ' active' : ''}`}
                onClick={() => st().setLayerFlags(l.id, { locked: !l.locked })}
                title={l.locked ? 'Unlock layer' : 'Lock layer'}
                aria-label={l.locked ? `Unlock ${l.name}` : `Lock ${l.name}`}
                aria-pressed={l.locked}
              >
                <Icon d={l.locked ? ICONS.lock : ICONS.unlock} />
              </button>
              <button className="icon-btn" disabled={i === 0} onClick={() => st().moveLayer(l.id, 1)} title="Move up" aria-label={`Move ${l.name} up`}>
                <Icon d={ICONS.up} />
              </button>
              <button
                className="icon-btn"
                disabled={i === rows.length - 1}
                onClick={() => st().moveLayer(l.id, -1)}
                title="Move down"
                aria-label={`Move ${l.name} down`}
              >
                <Icon d={ICONS.down} />
              </button>
              <button
                className="icon-btn"
                disabled={rows.length <= 1}
                onClick={() => remove(l.id, l.name)}
                title="Delete layer"
                aria-label={`Delete ${l.name}`}
              >
                <Icon d={ICONS.trash} />
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
