import { useState } from 'react';
import { type LoadedImage, pickImageFile, readImageFile } from '../io/image';
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
  const picture = isShape(item) && item.kind === 'image';
  const [name, setName] = useState(picture ? 'Device' : `${isShape(item) ? 'Node' : 'Line'} template ${count + 1}`);
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
        {picture
          ? 'The template shows this picture, with the device fields to its right. '
          : `The template copies this ${isShape(item) ? "shape's look and text" : "line's look and labels"}. `}
        It appears under <b>Graphs</b> in the left panel and can be used for CSV imports
        {picture && ' — edit it there (⋯) to choose which platforms it is for'}.
      </p>
      {PLACEHOLDER_HINT}
    </Modal>
  );
}

/** Splits "9300, C93 ,," into rule texts. */
const parseRules = (s: string) =>
  s
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);

/** Edits a template's name and text (and, for node elements, picture and platform rules); everything made from it updates on save. */
export function EditTemplateDialog({ templateId, onClose }: { templateId: string; onClose: () => void }) {
  const node = useStore((s) => s.doc.templates?.nodes.find((t) => t.id === templateId));
  const line = useStore((s) => s.doc.templates?.lines.find((t) => t.id === templateId));
  const wasDefault = useStore((s) => {
    const t = s.doc.templates;
    return !!node && (t?.defaultNodeId ?? t?.nodes[0]?.id) === templateId;
  });
  const storedPicture = useStore((s) => (node?.image ? s.doc.assets?.[node.image.asset] : undefined));
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
  const [rules, setRules] = useState((node?.platforms ?? []).join(', '));
  const [isDefault, setIsDefault] = useState(wasDefault);
  const [textRight, setTextRight] = useState(node?.textPosition === 'right');
  /** A new picture to apply on save; null removes the current one; undefined keeps it. */
  const [picture, setPicture] = useState<LoadedImage | null | undefined>(undefined);
  if (!node && !line) return null;

  const shownPicture = picture === undefined ? storedPicture : (picture?.src ?? undefined);
  const hasPicture = !!shownPicture;

  const choosePicture = async () => {
    const file = await pickImageFile();
    if (!file) return;
    try {
      setPicture(await readImageFile(file));
    } catch (err) {
      alert(`Couldn't use the picture: ${(err as Error).message}`);
    }
  };

  const save = () => {
    const st = useStore.getState();
    // One undo step for the whole edit.
    st.beginBatch();
    try {
      if (node) {
        if (picture) st.setTemplatePicture(templateId, picture.src, picture.w, picture.h);
        else if (picture === null) st.removeTemplatePicture(templateId);
      }
      let patch: Partial<NodeTemplate> | Partial<LineTemplate> = node
        ? { name, text, platforms: parseRules(rules), ...(hasPicture ? {} : { textPosition: textRight ? 'right' : undefined }) }
        : { name, label, startLabel, endLabel };
      if (copyLook && isShape(source)) {
        patch = { ...patch, kind: source.kind, w: Math.round(source.w), h: Math.round(source.h), style: { ...source.style } };
      } else if (copyLook && isConnector(source)) {
        patch = { ...patch, routing: source.routing, style: { ...source.style } };
      }
      st.updateTemplate(templateId, patch);
      if (node && isDefault && !wasDefault) st.setDefaultNodeTemplate(templateId);
    } finally {
      st.endBatch();
    }
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
        <>
          <div className="field">
            <span>Picture</span>
            <div className="picture-row">
              <div className="picture-preview">{shownPicture ? <img src={shownPicture} alt="" /> : <span className="muted">none</span>}</div>
              <div className="btn-col">
                <button onClick={choosePicture}>{hasPicture ? 'Change picture…' : 'Add picture…'}</button>
                {hasPicture && <button onClick={() => setPicture(null)}>Remove picture</button>}
              </div>
            </div>
          </div>
          <label className="field">
            <span>Use for devices whose platform contains (comma-separated)</span>
            <input type="text" placeholder="e.g. 9300, C93" value={rules} onChange={(e) => setRules(e.target.value)} />
          </label>
          <label className="toggle">
            <input type="checkbox" checked={isDefault} disabled={wasDefault} onChange={(e) => setIsDefault(e.target.checked)} />
            Default for devices whose platform matches no rule
            {wasDefault && <span className="muted"> (make another element the default to change)</span>}
          </label>
          {!hasPicture && (
            <label className="field" style={{ marginTop: 10 }}>
              <span>Text</span>
              <select value={textRight ? 'right' : 'inside'} onChange={(e) => setTextRight(e.target.value === 'right')}>
                <option value="inside">Inside the shape</option>
                <option value="right">Right of the shape</option>
              </select>
            </label>
          )}
          <label className="field" style={{ marginTop: hasPicture ? 10 : 0 }}>
            <span>{hasPicture ? 'Text right of the picture' : 'Text template'}</span>
            <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          <p className="muted">
            When a device's <code>{'{hostPlatform}'}</code> contains one of the texts above (ignoring case), it gets this
            element. The longest matching text wins, and your own elements come before the built-in ones. Rules apply
            right away to imported devices already on the diagram.
          </p>
        </>
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
