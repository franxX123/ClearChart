import { useState } from 'react';
import { currentPage, useStore } from '../model/store';

/** Page tabs under the canvas: switch, add, rename (double-click), duplicate and delete pages. */
export function PageTabs() {
  const pages = useStore((s) => s.doc.pages);
  const activeId = useStore((s) => currentPage(s).id);
  const [renaming, setRenaming] = useState<string | null>(null);
  const st = useStore.getState;

  const remove = (id: string) => {
    const page = pages.find((p) => p.id === id);
    if (!page) return;
    if (page.order.length && !confirm(`Delete "${page.name}" and everything on it?`)) return;
    st().deletePage(id);
  };

  return (
    <nav className="page-tabs" aria-label="Pages">
      <div className="page-tab-list" role="tablist">
        {pages.map((p) =>
          renaming === p.id ? (
            <input
              key={p.id}
              className="page-tab page-tab-input"
              autoFocus
              defaultValue={p.name}
              aria-label="Page name"
              onFocus={(e) => e.target.select()}
              onBlur={(e) => {
                const name = e.target.value.trim();
                if (name && name !== p.name) st().renamePage(p.id, name);
                setRenaming(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') e.currentTarget.value = p.name;
                if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
              }}
            />
          ) : (
            <button
              key={p.id}
              role="tab"
              aria-selected={p.id === activeId}
              className={`page-tab${p.id === activeId ? ' active' : ''}`}
              title="Double-click to rename"
              onClick={() => st().setActivePage(p.id)}
              onDoubleClick={() => setRenaming(p.id)}
            >
              {p.name}
            </button>
          ),
        )}
        <button className="page-add" onClick={() => st().addPage()} title="Add page" aria-label="Add page">
          +
        </button>
      </div>
      <div className="page-actions">
        <button onClick={() => st().duplicatePage(activeId)} title="Duplicate this page">
          Duplicate
        </button>
        <button onClick={() => remove(activeId)} disabled={pages.length <= 1} title="Delete this page">
          Delete
        </button>
      </div>
    </nav>
  );
}
