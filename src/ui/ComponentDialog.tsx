import { nanoid } from 'nanoid';
import { useId, useState } from 'react';
import { ComponentParts } from '../canvas/ShapeView';
import { ConnectorView } from '../connectors/ConnectorView';
import { DEFAULT_CONNECTOR_STYLE, isConnector, isShape } from '../model/doc';
import { useStore } from '../model/store';
import type { ArrowHead, Connector, ConnectorStyle, LineDash, NodeComponent, Routing, Rule } from '../model/types';
import { parseValues, partsFromSelection, placeholderFields } from '../templates/rules';
import { useTemplates } from '../templates/store';
import type { GraphTemplate, LinkComponent } from '../templates/types';
import { ColorField, NumberField, SelectField } from './fields';
import { Modal } from './Modal';
import { useOverlays } from './overlays';

const NEW_TEMPLATE = '\u0000new';

/**
 * The template a component is saved into: `templateId` when given (opened from that template
 * in the sidebar), otherwise picked in the dialog, defaulting to the last one used, with an
 * option to create a new template on save.
 */
function useTargetTemplate(templateId: string | undefined) {
  const templates = useTemplates((s) => s.templates);
  const [choice, setChoice] = useState(() => {
    if (templateId) return templateId;
    const ts = useTemplates.getState().templates;
    const last = useOverlays.getState().lastTemplateId;
    return (ts.find((t) => t.id === last) ?? ts[0])?.id ?? NEW_TEMPLATE;
  });
  const [newName, setNewName] = useState(() => `Template ${useTemplates.getState().templates.length + 1}`);
  const existing = templates.find((t) => t.id === choice);
  const template: GraphTemplate = existing ?? { id: '', name: newName.trim(), fields: [], nodes: [], links: [] };

  const picker = templateId ? null : (
    <div className="rule-row">
      <label className="field grow">
        <span>Template</span>
        <select value={existing ? choice : NEW_TEMPLATE} onChange={(e) => setChoice(e.target.value)}>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
          <option value={NEW_TEMPLATE}>New template…</option>
        </select>
      </label>
      {!existing && (
        <label className="field grow">
          <span>New template name</span>
          <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} />
        </label>
      )}
    </div>
  );

  return {
    template,
    picker,
    error: !existing && !newName.trim() ? 'Name the new template.' : null,
    /** Creates the new template if one was chosen; returns the id to save into. */
    commit: () => {
      const id = existing ? existing.id : useTemplates.getState().createTemplate(newName.trim());
      useOverlays.getState().setLastTemplate(id);
      return id;
    },
  };
}

const dialogTitle = (what: string, editing: boolean, templateId: string | undefined, template: GraphTemplate) =>
  editing ? `Edit ${what} · ${template.name}` : templateId ? `New ${what} · ${template.name}` : `New ${what}`;

interface RuleState {
  isDefault: boolean;
  field: string;
  values: string;
}

const ruleState = (rule: Rule | null | undefined, fields: string[], preferred: string): RuleState => ({
  isDefault: rule === null,
  field: rule?.field ?? (fields.includes(preferred) ? preferred : (fields[0] ?? '')),
  values: rule?.values.join(', ') ?? '',
});

const toRule = (r: RuleState): Rule | null =>
  r.isDefault ? null : { field: r.field.trim(), values: parseValues(r.values) };

const ruleError = (r: RuleState) =>
  r.isDefault ? null : !r.field.trim() ? 'Choose a field to match.' : parseValues(r.values).length === 0 ? 'Enter at least one value.' : null;

function RuleEditor({ rule, onChange, fields }: { rule: RuleState; onChange: (r: RuleState) => void; fields: string[] }) {
  const listId = useId();
  return (
    <fieldset className="rule">
      <legend>Use this component when</legend>
      <label className="toggle">
        <input type="checkbox" checked={rule.isDefault} onChange={(e) => onChange({ ...rule, isDefault: e.target.checked })} />
        Default: use it when no other rule matches
      </label>
      {!rule.isDefault && (
        <div className="rule-row">
          <label className="field">
            <span>Field</span>
            <input type="text" list={listId} value={rule.field} placeholder="platform" onChange={(e) => onChange({ ...rule, field: e.target.value })} />
            <datalist id={listId}>
              {fields.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
          </label>
          <span className="rule-op">is one of</span>
          <label className="field grow">
            <span>Values, comma-separated</span>
            <input type="text" value={rule.values} placeholder="cisco 9200, cisco 9300" onChange={(e) => onChange({ ...rule, values: e.target.value })} />
          </label>
        </div>
      )}
    </fieldset>
  );
}

function FieldHint({ used, known }: { used: string[]; known: string[] }) {
  const unknown = known.length ? used.filter((f) => !known.includes(f)) : [];
  return (
    <p className="muted small">
      {used.length ? (
        <>
          Filled from: {used.map((f) => `{{${f}}}`).join(', ')}.
          {unknown.length > 0 && <span className="warn"> Not in this template's known fields: {unknown.join(', ')}.</span>}
        </>
      ) : (
        <>No placeholders. Type {'{{field}}'} into a text on the canvas to show node data, e.g. {'{{name}}'}.</>
      )}
      {known.length > 0 && <> Known fields: {known.join(', ')}.</>}
    </p>
  );
}

/** Creates a node component from the canvas selection, or edits one (optionally re-taking its look). */
export function NodeComponentDialog({
  templateId,
  initial,
  onClose,
}: {
  templateId?: string;
  initial?: NodeComponent;
  onClose: () => void;
}) {
  const target = useTargetTemplate(templateId);
  const { template } = target;
  // Snapshot the selection when the dialog opens.
  const [fromSelection] = useState(() => {
    const { doc, selection } = useStore.getState();
    const shapes = doc.order.filter((id) => selection.includes(id)).map((id) => doc.items[id]).filter(isShape);
    return partsFromSelection(shapes, doc.components);
  });
  const [useSelection, setUseSelection] = useState(!initial);
  const [name, setName] = useState(initial?.name ?? `Node ${template.nodes.length + 1}`);
  const [rule, setRule] = useState(() => ruleState(initial?.rule, template.fields, 'platform'));

  const look = useSelection ? fromSelection : initial;
  const error = !look
    ? 'Select the shapes, text and images that make up the component on the canvas first.'
    : !name.trim()
      ? 'Give the component a name.'
      : (target.error ?? ruleError(rule));

  const save = () => {
    if (error || !look) return;
    const comp: NodeComponent = {
      id: initial?.id ?? nanoid(10),
      name: name.trim(),
      rule: toRule(rule),
      w: look.w,
      h: look.h,
      parts: structuredClone(look.parts),
    };
    useTemplates.getState().saveNode(target.commit(), comp);
    // Instances already in this diagram pick up the new definition (undoable).
    if (initial && useStore.getState().doc.components?.[comp.id]) {
      useStore.getState().update((d) => void (d.components![comp.id] = structuredClone(comp)));
    }
    onClose();
  };

  return (
    <Modal
      title={dialogTitle('node component', !!initial, templateId, template)}
      onClose={onClose}
      wide
      footer={
        <>
          {error && <span className="warn small">{error}</span>}
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!!error} onClick={save}>
            Save
          </button>
        </>
      }
    >
      {target.picker}
      <div className="dialog-cols">
        <div className="grow">
          <label className="field">
            <span>Name</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <RuleEditor rule={rule} onChange={setRule} fields={template.fields} />
          {initial && (
            <label className="toggle">
              <input
                type="checkbox"
                checked={useSelection}
                disabled={!fromSelection}
                onChange={(e) => setUseSelection(e.target.checked)}
              />
              Replace its look with the current canvas selection
            </label>
          )}
        </div>
        <div className="preview">
          {look ? (
            <svg viewBox={`-4 -4 ${look.w + 8} ${look.h + 8}`} width={200} height={140}>
              <ComponentParts component={{ id: '', name: '', rule: null, ...look }} w={look.w} h={look.h} />
            </svg>
          ) : (
            <span className="muted small">Nothing selected</span>
          )}
        </div>
      </div>
      {look && <FieldHint used={placeholderFields(look.parts.map((p) => p.text))} known={template.fields} />}
    </Modal>
  );
}

const ARROWS: ArrowHead[] = ['none', 'arrow', 'open'];

/** Creates or edits a line component: its rule, line style and middle label. */
export function LinkComponentDialog({
  templateId,
  initial,
  onClose,
}: {
  templateId?: string;
  initial?: LinkComponent;
  onClose: () => void;
}) {
  const target = useTargetTemplate(templateId);
  const { template } = target;
  // A selected line seeds the style of a new component.
  const [seed] = useState(() => {
    const { doc, selection } = useStore.getState();
    return selection.map((id) => doc.items[id]).find(isConnector);
  });
  const [name, setName] = useState(initial?.name ?? `Line ${template.links.length + 1}`);
  const [rule, setRule] = useState(() => ruleState(initial?.rule, template.fields, 'cableType'));
  const [style, setStyle] = useState<ConnectorStyle>(
    () => initial?.style ?? seed?.style ?? { ...DEFAULT_CONNECTOR_STYLE, endArrow: 'none' },
  );
  const [routing, setRouting] = useState<Routing>(initial?.routing ?? seed?.routing ?? 'straight');
  const [label, setLabel] = useState(initial?.label ?? '');
  const patch = (p: Partial<ConnectorStyle>) => setStyle((s) => ({ ...s, ...p }));

  const error = !name.trim() ? 'Give the component a name.' : (target.error ?? ruleError(rule));
  const save = () => {
    if (error) return;
    useTemplates.getState().saveLink(target.commit(), {
      id: initial?.id ?? nanoid(10),
      name: name.trim(),
      rule: toRule(rule),
      style,
      routing,
      label,
    });
    onClose();
  };

  const preview: Connector = {
    id: 'preview',
    type: 'connector',
    source: { x: 20, y: 30 },
    target: { x: 300, y: 30 },
    routing,
    label,
    style,
    sourceLabel: 'Gi1/0/1',
    targetLabel: 'Te1/1/1',
  };

  return (
    <Modal
      title={dialogTitle('line component', !!initial, templateId, template)}
      onClose={onClose}
      footer={
        <>
          {error && <span className="warn small">{error}</span>}
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!!error} onClick={save}>
            Save
          </button>
        </>
      }
    >
      {target.picker}
      <label className="field">
        <span>Name</span>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <RuleEditor rule={rule} onChange={setRule} fields={template.fields} />
      <p className="muted small">A line matches when either of its two nodes matches the rule.</p>
      <div className="style-grid">
        <ColorField label="Color" value={style.stroke} allowNone={false} onChange={(stroke) => patch({ stroke })} />
        <NumberField label="Width" value={style.strokeWidth} min={0.5} max={12} step={0.5} onChange={(strokeWidth) => patch({ strokeWidth })} />
        <SelectField<LineDash> label="Pattern" value={style.dash} options={['solid', 'dashed', 'dotted']} onChange={(dash) => patch({ dash })} />
        <SelectField<Routing> label="Routing" value={routing} options={['straight', 'elbow']} onChange={setRouting} />
        <SelectField<ArrowHead> label="Start arrow" value={style.startArrow} options={ARROWS} onChange={(startArrow) => patch({ startArrow })} />
        <SelectField<ArrowHead> label="End arrow" value={style.endArrow} options={ARROWS} onChange={(endArrow) => patch({ endArrow })} />
      </div>
      <label className="field">
        <span>Middle label (optional)</span>
        <input type="text" value={label} placeholder="{{cableType}}" onChange={(e) => setLabel(e.target.value)} />
      </label>
      <div className="preview">
        <svg viewBox="0 0 320 60" width={320} height={60}>
          <ConnectorView connector={preview} points={[preview.source, preview.target]} />
        </svg>
      </div>
      <p className="muted small">Interface labels at each end come from the field chosen when importing.</p>
    </Modal>
  );
}
