import { emptyDoc } from '../model/doc';
import { currentPage, useStore } from '../model/store';
import { exportPng, exportSvg } from '../io/export';
import { openDocFile, openTextFile, saveDocFile } from '../io/persist';
import { useDialog } from './dialogState';

export function Toolbar() {
  const title = useStore((s) => s.doc.title);
  const zoom = useStore((s) => s.viewport.zoom);
  const tool = useStore((s) => s.tool);
  const toolLocked = useStore((s) => s.toolLocked);
  const autosaveFull = useStore((s) => s.autosaveFull);
  const arrowTemplate = useStore((s) => s.doc.templates?.lines.find((t) => t.id === s.arrowTemplateId)?.name);
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
    if (st().doc.pages.some((p) => p.order.length) && !confirm('Start a new diagram? Unsaved changes to this one will be lost.')) return;
    st().loadDoc(emptyDoc());
  };

  const importCsv = async () => {
    try {
      const file = await openTextFile('.csv,text/csv');
      if (file) useDialog.getState().open({ kind: 'import', fileName: file.name, csv: file.text });
    } catch (err) {
      alert(`Couldn't read the file: ${(err as Error).message}`);
    }
  };

  const empty = (ok: boolean) => !ok && alert('Nothing to export on this page yet.');
  /** Export file name: the title, plus the page name when there's more than one page. */
  const exportName = () => {
    const { doc } = st();
    return doc.pages.length > 1 ? `${doc.title} ${currentPage(st()).name}` : doc.title;
  };

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
        <button onClick={importCsv} title="Draw devices and links from a CSV (hostName, neighborName, interfaces…)">
          Import CSV
        </button>
      </div>
      <div className="group">
        <button onClick={() => empty(exportSvg(currentPage(st()), exportName()))} title="Exports the current page">
          Export SVG
        </button>
        <button onClick={async () => empty(await exportPng(currentPage(st()), exportName()))} title="Exports the current page">
          Export PNG
        </button>
      </div>
      <div className="group" role="radiogroup" aria-label="Tool">
        <button
          role="radio"
          aria-checked={tool === 'select'}
          className={tool === 'select' ? 'active' : ''}
          onClick={() => st().setTool('select')}
          title="Select and move (V)"
        >
          Select
        </button>
        <button
          role="radio"
          aria-checked={tool === 'arrow'}
          className={tool === 'arrow' ? 'active' : ''}
          onClick={() => st().setTool(tool === 'arrow' && !toolLocked ? 'select' : 'arrow')}
          onDoubleClick={() => st().setTool('arrow', true)}
          title="Draw an arrow (A). Double-click to keep the tool on."
        >
          Arrow{arrowTemplate ? `: ${arrowTemplate}` : ''}
          {toolLocked ? ' 🔒' : ''}
        </button>
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
      {autosaveFull && (
        <span className="autosave-warning" role="status">
          Autosave is full — use Save to keep your work
        </span>
      )}
    </header>
  );
}
