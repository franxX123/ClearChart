import type { AlignMode } from '../canvas/arrange';
import { rotationOf } from '../canvas/transform';
import { isConnector, isShape } from '../model/doc';
import { groupUnits, layerOf } from '../model/page';
import { currentPage, useStore } from '../model/store';
import { templateFields } from '../model/templates';
import type { ArrowHead, Item, LineDash, Routing } from '../model/types';
import { useDialog } from './dialogState';
import { LayersPanel } from './LayersPanel';

/** A color input that also allows "none" (transparent). */
function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const none = value === 'none';
  return (
    <div className="field">
      <span>{label}</span>
      <div className="color-row">
        <input type="color" value={none ? '#ffffff' : value} disabled={none} onChange={(e) => onChange(e.target.value)} />
        <label className="toggle">
          <input type="checkbox" checked={none} onChange={(e) => onChange(e.target.checked ? 'none' : '#ffffff')} /> None
        </label>
      </div>
    </div>
  );
}

function NumberField(props: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void }) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <input
        type="number"
        value={props.value}
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) props.onChange(Math.min(props.max, Math.max(props.min, v)));
        }}
      />
    </label>
  );
}

/** 0–100 % slider with a number box, for a 0–1 opacity value (absent = fully opaque). */
function OpacityField({ value, onChange }: { value: number | undefined; onChange: (v: number) => void }) {
  const pct = Math.round((value ?? 1) * 100);
  const set = (v: number) => Number.isFinite(v) && onChange(Math.min(100, Math.max(0, v)) / 100);
  return (
    <div className="field">
      <span>Opacity</span>
      <div className="slider-row">
        <input type="range" min={0} max={100} value={pct} aria-label="Opacity" onChange={(e) => set(Number(e.target.value))} />
        <input type="number" min={0} max={100} value={pct} aria-label="Opacity percent" onChange={(e) => set(Number(e.target.value))} />
        <span className="muted">%</span>
      </div>
    </div>
  );
}

function SelectField<T extends string>(props: { label: string; value: T; options: T[]; onChange: (v: T) => void }) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <select value={props.value} onChange={(e) => props.onChange(e.target.value as T)}>
        {props.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

const ARROWS: ArrowHead[] = ['none', 'arrow', 'open'];

const ALIGN: { mode: AlignMode; label: string; title: string }[] = [
  { mode: 'left', label: 'Left', title: 'Align left edges' },
  { mode: 'center', label: 'Center', title: 'Align horizontal centers' },
  { mode: 'right', label: 'Right', title: 'Align right edges' },
  { mode: 'top', label: 'Top', title: 'Align top edges' },
  { mode: 'middle', label: 'Middle', title: 'Align vertical centers' },
  { mode: 'bottom', label: 'Bottom', title: 'Align bottom edges' },
];

/**
 * Fields of a templated or data-bearing item (e.g. an imported device's name, ip, platform).
 * Editing one re-renders the item's text from its template.
 */
function DataSection({ item }: { item: Item }) {
  const template = useStore((s) =>
    item.templateId
      ? (s.doc.templates?.nodes.find((t) => t.id === item.templateId) ?? s.doc.templates?.lines.find((t) => t.id === item.templateId))
      : undefined,
  );
  if (!template && !item.data) return null;
  // Every field the template uses, plus any other data the item carries.
  const used = template ? ('text' in template ? templateFields(template.text) : templateFields(template.startLabel, template.label, template.endLabel)) : [];
  const keys = [...used, ...Object.keys(item.data ?? {}).filter((k) => !used.some((u) => u.toLowerCase() === k.toLowerCase()))];
  const value = (k: string) => {
    const key = Object.keys(item.data ?? {}).find((d) => d.toLowerCase() === k.toLowerCase());
    return key ? item.data![key] : '';
  };
  const st = useStore.getState;

  return (
    <section>
      <h3>Data</h3>
      {template && (
        <div className="field">
          <span>Template</span>
          <div className="btn-row">
            <span className="template-name">{template.name}</span>
            <button onClick={() => useDialog.getState().open({ kind: 'editTemplate', templateId: template.id })}>Edit</button>
            <button onClick={() => st().unlinkTemplate([item.id])} title="Keep the current look and text, stop following the template">
              Unlink
            </button>
          </div>
        </div>
      )}
      {keys.map((k) => (
        <label key={k} className="field">
          <span>{k}</span>
          <input type="text" value={value(k)} onChange={(e) => st().setItemData(item.id, k, e.target.value, `data:${item.id}:${k}`)} />
        </label>
      ))}
      {keys.length === 0 && <p className="muted">This template has no {'{fields}'}.</p>}
    </section>
  );
}

export function Properties() {
  const page = useStore(currentPage);
  const selection = useStore((s) => s.selection);
  const st = useStore.getState;

  const items = selection.map((id) => page.items[id]).filter(Boolean);
  const shapes = items.filter(isShape);
  const connectors = items.filter(isConnector);
  // Fields show the first selected item's values; edits apply to every selected item of that type.
  const shape = shapes[0];
  const line = connectors[0];
  // Pictures have no fill or text; hide those fields when only pictures are selected.
  const onlyImages = shapes.length > 0 && shapes.every((s) => s.kind === 'image');
  // Groups and lone items; align/distribute move these as wholes.
  const units = groupUnits(page, selection);
  const shapeUnits = units.filter((u) => u.some((id) => isShape(page.items[id]))).length;
  const grouped = items.some((it) => it.groupIds?.length);
  const layerIds = [...new Set(items.map((it) => layerOf(page, it).id))];

  return (
    <aside className="properties">
      {!shape && !line && (
        <>
          <h3>{page.name}</h3>
          <p className="muted">
            {page.order.length} item{page.order.length === 1 ? '' : 's'}. Select a shape or line to style it.
          </p>
        </>
      )}

      {shape && (
        <section>
          <h3>{shapes.length > 1 ? `${shapes.length} shapes` : onlyImages ? 'Picture' : 'Shape'}</h3>
          {!onlyImages && (
            <ColorField label="Fill" value={shape.style.fill} onChange={(fill) => st().styleShapes({ fill }, 'fill')} />
          )}
          <ColorField label="Border" value={shape.style.stroke} onChange={(stroke) => st().styleShapes({ stroke }, 'stroke')} />
          <NumberField
            label="Border width"
            value={shape.style.strokeWidth}
            min={0}
            max={12}
            step={0.5}
            onChange={(strokeWidth) => st().styleShapes({ strokeWidth }, 'strokeWidth')}
          />
          {!onlyImages && (
            <>
              <ColorField
                label="Text color"
                value={shape.style.textColor}
                onChange={(textColor) => st().styleShapes({ textColor: textColor === 'none' ? '#000000' : textColor }, 'textColor')}
              />
              <NumberField
                label="Font size"
                value={shape.style.fontSize}
                min={6}
                max={96}
                onChange={(fontSize) => st().styleShapes({ fontSize }, 'fontSize')}
              />
              <div className="field">
                <span>Text style</span>
                <div className="btn-row">
                  <button
                    className={shape.style.bold ? 'active' : ''}
                    onClick={() => st().styleShapes({ bold: !shape.style.bold })}
                    aria-pressed={shape.style.bold}
                  >
                    <b>B</b>
                  </button>
                  <button
                    className={shape.style.italic ? 'active' : ''}
                    onClick={() => st().styleShapes({ italic: !shape.style.italic })}
                    aria-pressed={shape.style.italic}
                  >
                    <i>I</i>
                  </button>
                </div>
              </div>
            </>
          )}
          <OpacityField value={shape.style.opacity} onChange={(opacity) => st().styleShapes({ opacity }, 'opacity')} />
          <NumberField
            label="Rotation (°)"
            value={Math.round(rotationOf(shape) * 10) / 10}
            min={-360}
            max={360}
            onChange={(deg) => st().rotateShapes(deg, 'rotation')}
          />
          {shapes.length === 1 && (
            <div className="field">
              <span>Position / size</span>
              <span className="muted mono">
                {Math.round(shape.x)}, {Math.round(shape.y)} · {Math.round(shape.w)}×{Math.round(shape.h)}
              </span>
            </div>
          )}
        </section>
      )}

      {line && (
        <section>
          <h3>{connectors.length > 1 ? `${connectors.length} lines` : 'Line'}</h3>
          <ColorField
            label="Color"
            value={line.style.stroke}
            onChange={(stroke) => st().editConnectors({ style: { stroke: stroke === 'none' ? '#000000' : stroke } }, 'lineStroke')}
          />
          <NumberField
            label="Width"
            value={line.style.strokeWidth}
            min={0.5}
            max={12}
            step={0.5}
            onChange={(strokeWidth) => st().editConnectors({ style: { strokeWidth } }, 'lineWidth')}
          />
          <OpacityField value={line.style.opacity} onChange={(opacity) => st().editConnectors({ style: { opacity } }, 'lineOpacity')} />
          <SelectField<LineDash>
            label="Pattern"
            value={line.style.dash}
            options={['solid', 'dashed', 'dotted']}
            onChange={(dash) => st().editConnectors({ style: { dash } })}
          />
          <SelectField<Routing>
            label="Routing"
            value={line.routing}
            options={['straight', 'elbow', 'curved']}
            onChange={(routing) => st().editConnectors({ routing })}
          />
          <SelectField<ArrowHead>
            label="Start arrow"
            value={line.style.startArrow}
            options={ARROWS}
            onChange={(startArrow) => st().editConnectors({ style: { startArrow } })}
          />
          <SelectField<ArrowHead>
            label="End arrow"
            value={line.style.endArrow}
            options={ARROWS}
            onChange={(endArrow) => st().editConnectors({ style: { endArrow } })}
          />
          {line.templateId ? (
            <p className="muted">Labels come from the line's template and fields (below).</p>
          ) : (
            <>
              <label className="field">
                <span>Label</span>
                <input type="text" value={line.label} onChange={(e) => st().editConnectors({ label: e.target.value }, 'label')} />
              </label>
              <label className="field">
                <span>Start label</span>
                <input
                  type="text"
                  value={line.startLabel ?? ''}
                  onChange={(e) => st().editConnectors({ startLabel: e.target.value }, 'startLabel')}
                />
              </label>
              <label className="field">
                <span>End label</span>
                <input
                  type="text"
                  value={line.endLabel ?? ''}
                  onChange={(e) => st().editConnectors({ endLabel: e.target.value }, 'endLabel')}
                />
              </label>
            </>
          )}
        </section>
      )}

      {items.length === 1 && <DataSection item={items[0]} />}

      {items.length > 0 && (
        <section>
          <h3>Arrange</h3>
          {shapeUnits >= 2 && (
            <div className="field">
              <span>Align</span>
              <div className="btn-grid">
                {ALIGN.map((a) => (
                  <button key={a.mode} onClick={() => st().align(a.mode)} title={a.title}>
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {shapeUnits >= 3 && (
            <div className="field">
              <span>Distribute</span>
              <div className="btn-row">
                <button onClick={() => st().distribute('x')} title="Equal horizontal spacing">
                  Horizontally
                </button>
                <button onClick={() => st().distribute('y')} title="Equal vertical spacing">
                  Vertically
                </button>
              </div>
            </div>
          )}
          <div className="field">
            <span>Group</span>
            <div className="btn-row">
              <button disabled={units.length < 2} onClick={() => st().group()} title="Ctrl+G">
                Group
              </button>
              <button disabled={!grouped} onClick={() => st().ungroup()} title="Ctrl+Shift+G">
                Ungroup
              </button>
            </div>
          </div>
          <label className="field">
            <span>Layer</span>
            <select
              value={layerIds.length === 1 ? layerIds[0] : ''}
              onChange={(e) => e.target.value && st().moveSelectionToLayer(e.target.value)}
            >
              {layerIds.length > 1 && <option value="">(several)</option>}
              {[...page.layers].reverse().map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
        </section>
      )}

      <LayersPanel />
    </aside>
  );
}
