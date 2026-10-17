import { useMemo, useState } from 'react';
import { useStore } from '../model/store';
import { layoutPlan, planImport, type ImportOptions, type ParsedGraph } from '../templates/graph';
import { useTemplates } from '../templates/store';
import { Modal } from './Modal';

const LINK_FIELD_GUESSES = ['interface', 'cabletype', 'cable_type', 'cable', 'port', 'speed', 'vlan'];

const counts = (c: Record<string, number>) =>
  Object.entries(c)
    .map(([name, n]) => `${name} ×${n}`)
    .join(', ');

/** Options and a live preview for importing a parsed graph file with a template. */
export function ImportDialog({ graph, fileName, onClose }: { graph: ParsedGraph; fileName: string; onClose: () => void }) {
  const templates = useTemplates((s) => s.templates);
  const doc = useStore((s) => s.doc);
  const { fields, edges } = graph;

  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '');
  const [keyField, setKeyField] = useState(fields.includes('name') ? 'name' : (fields[0] ?? ''));
  const [endLabelField, setEndLabelField] = useState(fields.includes('interface') ? 'interface' : '');
  const [linkFields, setLinkFields] = useState(() => fields.filter((f) => LINK_FIELD_GUESSES.includes(f.toLowerCase())));

  const template = templates.find((t) => t.id === templateId) ?? null;
  const opts = useMemo(
    (): ImportOptions => ({ keyField, endLabelField: endLabelField || null, linkFields }),
    [keyField, endLabelField, linkFields],
  );
  const plan = useMemo(() => planImport(doc, edges, template, opts), [doc, edges, template, opts]);
  const r = plan.report;
  const nothingNew = r.newNodes === 0 && r.newLinks === 0;

  const toggleLinkField = (f: string, on: boolean) =>
    setLinkFields((fs) => (on ? [...fs, f] : fs.filter((x) => x !== f)));

  const run = () => {
    // Plan again against the current doc, then lay out and add everything as one undo step.
    const current = useStore.getState().doc;
    const final = planImport(current, edges, template, opts);
    layoutPlan(current, final);
    useStore.getState().importGraph(final);
    if (template) useTemplates.getState().addFields(template.id, fields);
    onClose();
  };

  return (
    <Modal
      title={`Import graph · ${fileName}`}
      onClose={onClose}
      wide
      footer={
        <>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={nothingNew || !keyField} onClick={run}>
            Import
          </button>
        </>
      }
    >
      <div className="style-grid">
        <label className="field">
          <span>Template</span>
          <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
            <option value="">No template (plain boxes and lines)</option>
          </select>
        </label>
        <label className="field">
          <span>Unique node key</span>
          <select value={keyField} onChange={(e) => setKeyField(e.target.value)}>
            {fields.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Label at each line end</span>
          <select value={endLabelField} onChange={(e) => setEndLabelField(e.target.value)}>
            <option value="">(none)</option>
            {fields.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </label>
      </div>

      <fieldset className="rule">
        <legend>Link fields (describe the cable, not the device)</legend>
        <div className="check-grid">
          {fields.map((f) => (
            <label key={f} className="toggle">
              <input
                type="checkbox"
                checked={linkFields.includes(f) && f !== keyField}
                disabled={f === keyField}
                onChange={(e) => toggleLinkField(f, e.target.checked)}
              />
              {f}
            </label>
          ))}
        </div>
        <p className="muted small">
          Link fields aren't stored on nodes, so a device with different ports in different rows is still one node. Line
          rules and labels can use them.
        </p>
      </fieldset>

      <div className="report">
        <div>
          <b>{r.newNodes}</b> new node{r.newNodes === 1 ? '' : 's'}
          {r.reusedNodes > 0 && <>, {r.reusedNodes} already on the canvas (kept in place)</>}
        </div>
        <div>
          <b>{r.newLinks}</b> new link{r.newLinks === 1 ? '' : 's'}
          {r.duplicateLinks > 0 && <>, {r.duplicateLinks} duplicate{r.duplicateLinks === 1 ? '' : 's'} skipped</>}
        </div>
        {r.missingKey > 0 && (
          <div className="warn">
            {r.missingKey} edge{r.missingKey === 1 ? '' : 's'} skipped: a node has no “{keyField}”
          </div>
        )}
        {r.selfLoops > 0 && <div className="muted">{r.selfLoops} self-link{r.selfLoops === 1 ? '' : 's'} skipped</div>}
        {r.newNodes > 0 && <div className="muted">Nodes: {counts(r.nodeCounts)}</div>}
        {r.newLinks > 0 && <div className="muted">Lines: {counts(r.linkCounts)}</div>}
        {nothingNew && <div className="muted">Nothing new to add.</div>}
      </div>
    </Modal>
  );
}
