import { isConnector, isShape } from '../model/doc';
import { useStore } from '../model/store';
import type { ArrowHead, LineDash, Routing } from '../model/types';

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

export function Properties() {
  const doc = useStore((s) => s.doc);
  const selection = useStore((s) => s.selection);
  const st = useStore.getState;

  const items = selection.map((id) => doc.items[id]);
  const shapes = items.filter(isShape);
  const connectors = items.filter(isConnector);
  // Fields show the first selected item's values; edits apply to every selected item of that type.
  const shape = shapes[0];
  const line = connectors[0];

  return (
    <aside className="properties">
      {!shape && !line && (
        <>
          <h3>Document</h3>
          <p className="muted">
            {doc.order.length} item{doc.order.length === 1 ? '' : 's'}. Select a shape or line to style it.
          </p>
        </>
      )}

      {shape && (
        <section>
          <h3>{shapes.length > 1 ? `${shapes.length} shapes` : 'Shape'}</h3>
          <ColorField label="Fill" value={shape.style.fill} onChange={(fill) => st().styleShapes({ fill }, 'fill')} />
          <ColorField label="Border" value={shape.style.stroke} onChange={(stroke) => st().styleShapes({ stroke }, 'stroke')} />
          <NumberField
            label="Border width"
            value={shape.style.strokeWidth}
            min={0}
            max={12}
            step={0.5}
            onChange={(strokeWidth) => st().styleShapes({ strokeWidth }, 'strokeWidth')}
          />
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
          <SelectField<LineDash>
            label="Pattern"
            value={line.style.dash}
            options={['solid', 'dashed', 'dotted']}
            onChange={(dash) => st().editConnectors({ style: { dash } })}
          />
          <SelectField<Routing>
            label="Routing"
            value={line.routing}
            options={['elbow', 'straight']}
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
          <label className="field">
            <span>Label</span>
            <input
              type="text"
              value={line.label}
              onChange={(e) => st().editConnectors({ label: e.target.value }, 'label')}
            />
          </label>
        </section>
      )}
    </aside>
  );
}
