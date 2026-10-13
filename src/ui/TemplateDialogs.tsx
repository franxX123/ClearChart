import { useState } from 'react';
import { isConnector, isShape } from '../model/doc';
import { currentPage, useStore } from '../model/store';
import type { LineTemplate, NodeTemplate } from '../model/types';
import { Modal } from './Modal';

const PLACEHOLDER_HINT = (
  <p className="muted">
    Write a CSV column name in braces where its value should go. Devices: <code>{'{hostName}'}</code>,{' '}
    <code>{'{hostIP}'}</code>, <code>{'{hostPlatform}'}</code> — a device listed as the neighbor gets its
    neighborName / neighborIP / neighborPlatform here too. Links: <code>{'{hostInterface}'}</code>,{' '}
    <code>{'{neighborInterface}'}</code> and any extra column. A line whose fields are all empty is left out.
  </p>
);

/** Names and saves a shape or line as a new template (custom component). */
export function SaveTemplateDialog({ itemId, onClose }: { itemId: string; onClose: () => void }) {
  const item = useStore((s) => currentPage(s).items[itemId]);
  const count = useStore((s) => (isShape(item) ? s.doc.templates?.nodes.length : s.doc.templates?.lines.length) ?? 0);
  const [name, setName] = useState(`${isShape(item) ? 'Node' : 'Line'} template ${count + 1}`);
  if (!item) return null;

  const save = () => {
    if (!name.trim()) return;
    useStore.getState().saveTemplate(itemId, name.trim());
    onClose();
  };

  return (
    <Modal
      title={isShape(item) ? 'Save as node template' : 'Save as line template'}
      onClose={onClose}
      actions={
        <>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!name.trim()} onClick={save}>
            Save
          </button>
        </>
      }
    >
      <label className="field">
        <span>Name</span>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
      </label>
      <p>
        The template copies this {isShape(item) ? "shape's look and text" : "line's look and labels"}. It appears under{' '}
        <b>Graphs</b> in the left panel and can be used for CSV imports.
      </p>
      {PLACEHOLDER_HINT}
    </Modal>
  );
}

/** Edits a template's name and text; everything made from it updates on save. */
export function EditTemplateDialog({ templateId, onClose }: { templateId: string; onClose: () => void }) {
  const node = useStore((s) => s.doc.templates?.nodes.find((t) => t.id === templateId));
  const line = useStore((s) => s.doc.templates?.lines.find((t) => t.id === templateId));
  // The single selected item, if it's the right kind to copy a look from.
  const source = useStore((s) => {
    const it = s.selection.length === 1 ? currentPage(s).items[s.selection[0]] : undefined;
    return (node && isShape(it)) || (line && isConnector(it)) ? it : undefined;
  });
  const [name, setName] = useState(node?.name ?? line?.name ?? '');
  const [text, setText] = useState(node?.text ?? '');
  const [label, setLabel] = useState(line?.label ?? '');
  const [startLabel, setStartLabel] = useState(line?.startLabel ?? '');
  const [endLabel, setEndLabel] = useState(line?.endLabel ?? '');
  const [copyLook, setCopyLook] = useState(false);
  if (!node && !line) return null;

  const save = () => {
    const st = useStore.getState();
    let patch: Partial<NodeTemplate> | Partial<LineTemplate> = node ? { name, text } : { name, label, startLabel, endLabel };
    if (copyLook && isShape(source)) {
      patch = { ...patch, kind: source.kind, w: Math.round(source.w), h: Math.round(source.h), style: { ...source.style } };
    } else if (copyLook && isConnector(source)) {
      patch = { ...patch, routing: source.routing, style: { ...source.style } };
    }
    st.updateTemplate(templateId, patch);
    onClose();
  };

  const remove = () => {
    if (!confirm(`Delete the template "${name}"? Items made from it keep their current look.`)) return;
    useStore.getState().deleteTemplate(templateId);
    onClose();
  };

  return (
    <Modal
      title={`Edit ${node ? 'node' : 'line'} template`}
      onClose={onClose}
      actions={
        <>
          <button className="danger" onClick={remove}>
            Delete
          </button>
          <span className="spacer" />
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!name.trim()} onClick={save}>
            Save
          </button>
        </>
      }
    >
      <label className="field">
        <span>Name</span>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      {node ? (
        <label className="field">
          <span>Text</span>
          <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} />
        </label>
      ) : (
        <>
          <label className="field">
            <span>Start label (next to the host)</span>
            <input type="text" value={startLabel} onChange={(e) => setStartLabel(e.target.value)} />
          </label>
          <label className="field">
            <span>Middle label</span>
            <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} />
          </label>
          <label className="field">
            <span>End label (next to the neighbor)</span>
            <input type="text" value={endLabel} onChange={(e) => setEndLabel(e.target.value)} />
          </label>
        </>
      )}
      <label className="toggle">
        <input type="checkbox" checked={copyLook} disabled={!source} onChange={(e) => setCopyLook(e.target.checked)} />
        Use the look of the selected {node ? 'shape' : 'line'}
        {!source && <span className="muted"> (select one first)</span>}
      </label>
      {PLACEHOLDER_HINT}
      <p className="muted">Saving updates every {node ? 'node' : 'line'} made from this template, on every page.</p>
    </Modal>
  );
}
