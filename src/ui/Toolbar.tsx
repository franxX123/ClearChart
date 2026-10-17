import { useState } from 'react';
import { useStore } from '../model/store';
import { exportPng, exportSvg } from '../io/export';
import { JSON_FILES, openDocFile, pickFile, saveDocFile } from '../io/persist';
import { parseGraph, type ParsedGraph } from '../templates/graph';
import { ImportDialog } from './ImportDialog';

export function Toolbar() {
  const title = useStore((s) => s.doc.title);
  const zoom = useStore((s) => s.viewport.zoom);
  const showGrid = useStore((s) => s.showGrid);
  const snap = useStore((s) => s.snapToGrid);
  const st = useStore.getState;
  const [graph, setGraph] = useState<{ graph: ParsedGraph; fileName: string } | null>(null);

  const open = async () => {
    try {
      const doc = await openDocFile();
      if (!doc) return;
      // Reuse the current tab if nothing has been drawn in it yet.
      const s = st();
      if (s.doc.order.length === 0 && s.history.past.length === 0) s.loadDoc(doc);
      else s.newTab(doc);
    } catch (err) {
      alert(`Couldn't open file: ${(err as Error).message}`);
    }
  };

  const importGraph = async () => {
    try {
      const file = await pickFile(JSON_FILES);
      if (file) setGraph({ graph: parseGraph(await file.text()), fileName: file.name });
    } catch (err) {
      alert(`Couldn't read graph: ${(err as Error).message}`);
    }
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
        <button onClick={() => st().newTab()} title="New diagram in a new tab">New</button>
        <button onClick={open} title="Open a .clearchart.json file in a new tab">Open</button>
        <button onClick={() => saveDocFile(st().doc)} title="Ctrl+S">Save</button>
        <button onClick={importGraph} title="Build a diagram from a JSON edge list using a graph template">
          Import graph
        </button>
      </div>
      <div className="group">
        <button onClick={() => empty(exportSvg(st().doc))}>Export SVG</button>
        <button onClick={async () => empty(await exportPng(st().doc))}>Export PNG</button>
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
      {graph && <ImportDialog graph={graph.graph} fileName={graph.fileName} onClose={() => setGraph(null)} />}
    </header>
  );
}
