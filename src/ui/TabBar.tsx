import { useStore } from '../model/store';

const st = useStore.getState;

function closeTab(id: string) {
  const s = st();
  const doc = id === s.activeTab ? s.doc : s.parked[id]?.doc;
  if (
    doc?.order.length &&
    !confirm(`Close "${doc.title}"? It will be removed from this browser. Save it first if you need a copy.`)
  ) {
    return;
  }
  s.closeTab(id);
}

/** One tab per open diagram, under the toolbar. */
export function TabBar() {
  const tabs = useStore((s) => s.tabs);
  const active = useStore((s) => s.activeTab);
  const activeTitle = useStore((s) => s.doc.title);
  const parked = useStore((s) => s.parked);

  return (
    <nav className="tabbar" aria-label="Open diagrams">
      <div className="tabs" role="tablist">
        {tabs.map((id) => {
          const title = (id === active ? activeTitle : parked[id]?.doc.title)?.trim() || 'Untitled diagram';
          return (
            <div
              key={id}
              role="tab"
              tabIndex={0}
              aria-selected={id === active}
              className={`tab${id === active ? ' active' : ''}`}
              title={title}
              onClick={() => st().switchTab(id)}
              onKeyDown={(e) => e.key === 'Enter' && st().switchTab(id)}
              // Middle-click closes, as in a browser; preventDefault stops autoscroll.
              onMouseDown={(e) => e.button === 1 && e.preventDefault()}
              onAuxClick={(e) => e.button === 1 && closeTab(id)}
            >
              <span className="tab-title">{title}</span>
              <button
                className="icon tab-close"
                aria-label={`Close ${title}`}
                title="Close"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(id);
                }}
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
      <button className="icon tab-new" title="New diagram" aria-label="New diagram" onClick={() => st().newTab()}>
        +
      </button>
    </nav>
  );
}
