import { emptyDoc } from '../model/doc';
import { useStore } from '../model/store';
import { exportPng, exportSvg } from '../io/export';
import { openDocFile, saveDocFile } from '../io/persist';

export function Toolbar() {
  const title = useStore((s) => s.doc.title);
  const zoom = useStore((s) => s.viewport.zoom);
  const canUndo = useStore((s) => s.history.past.length > 0);
  const canRedo = useStore((s) => s.history.future.length > 0);
  const hasSelection = useStore((s) => s.selection.length > 0);
  const showGrid = useStore((s) => s.showGrid);
  const snap = useStore((s) => s.snapToGrid);
  const st = useStore.getState;

  const open = async () => {
    try {
      const doc = await openDocFile();
      if (doc) st().loadDoc(doc);
    } catch (err) {
      alert(`Couldn't open file: ${(err as Error).message}`);
    }
  };

  const newDoc = () => {
    if (st().doc.order.length && !confirm('Start a new diagram? Unsaved changes to this one will be lost.')) return;
    st().loadDoc(emptyDoc());
  };

  const empty = (ok: boolean) => !ok && alert('Nothing to export yet.');

  return (
    <header className="toolbar">
      <span className="brand">ClearChart</span>
      <input
        className="title-input"
        value={title}
        aria-label="Document title"
        onChange={(e) => st().update((d) => void (d.title = e.target.value), 'title')}
      />
      <div className="group">
        <button onClick={newDoc}>New</button>
        <button onClick={open}>Open</button>
        <button onClick={() => saveDocFile(st().doc)} title="Ctrl+S">Save</button>
      </div>
      <div className="group">
        <button onClick={() => empty(exportSvg(st().doc))}>Export SVG</button>
        <button onClick={async () => empty(await exportPng(st().doc))}>Export PNG</button>
      </div>
      <div className="group">
        <button disabled={!canUndo} onClick={() => st().undo()} title="Ctrl+Z">Undo</button>
        <button disabled={!canRedo} onClick={() => st().redo()} title="Ctrl+Shift+Z">Redo</button>
      </div>
      <div className="group">
        <button disabled={!hasSelection} onClick={() => st().bringToFront()} title="Ctrl+]">To front</button>
        <button disabled={!hasSelection} onClick={() => st().sendToBack()} title="Ctrl+[">To back</button>
        <button disabled={!hasSelection} onClick={() => st().deleteSelection()} title="Delete">Delete</button>
      </div>
      <div className="group">
        <button onClick={() => st().zoomBy(1 / 1.2)} title="Ctrl+-" aria-label="Zoom out">−</button>
        <button className="zoom-label" onClick={() => st().zoomTo(1)} title="Reset to 100%">
          {Math.round(zoom * 100)}%
        </button>
        <button onClick={() => st().zoomBy(1.2)} title="Ctrl+=" aria-label="Zoom in">+</button>
        <button onClick={() => st().fitToScreen()} title="Shift+1">Fit</button>
      </div>
      <div className="group">
        <label className="toggle">
          <input type="checkbox" checked={showGrid} onChange={() => st().toggleGrid()} /> Grid
        </label>
        <label className="toggle">
          <input type="checkbox" checked={snap} onChange={() => st().toggleSnap()} /> Snap
        </label>
      </div>
    </header>
  );
}
