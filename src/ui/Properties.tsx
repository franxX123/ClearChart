import { isConnector, isShape } from '../model/doc';
import { useStore } from '../model/store';
import type { ArrowHead, LineDash, NodeComponent, Routing, Shape } from '../model/types';
import { placeholderFields } from '../templates/rules';
import { ColorField, NumberField, SelectField, SliderField } from './fields';
import { useOverlays } from './overlays';
import { PanelToggle } from './PanelToggle';

/** Data fields of a component instance: those its text uses, then any others it carries. */
function DataSection({ shape, component }: { shape: Shape; component?: NodeComponent }) {
  const st = useStore.getState;
  const used = component ? placeholderFields(component.parts.map((p) => p.text)) : [];
  const fields = [...new Set([...used, ...Object.keys(shape.data ?? {})])];
  return (
    <section>
      <h3>{component ? component.name : 'Component'}</h3>
      {!component && <p className="muted small">This component's definition is missing from the diagram.</p>}
      {fields.length === 0 && component && <p className="muted small">No data fields.</p>}
      <SliderField
        label="Opacity"
        value={shape.style.opacity ?? 1}
        onChange={(opacity) => st().styleComponents({ opacity }, 'componentOpacity')}
      />
      {fields.map((f) => (
        <label key={f} className="field">
          <span>
            {f}
            {!used.includes(f) && <span className="muted"> (not shown)</span>}
          </span>
          <input type="text" value={shape.data?.[f] ?? ''} onChange={(e) => st().setShapeData(shape.id, f, e.target.value)} />
        </label>
      ))}
      {component && (
        <button onClick={() => st().breakApart(shape.id)} title="Replace with its parts as ordinary shapes">
          Break apart
        </button>
      )}
    </section>
  );
}

const ARROWS: ArrowHead[] = ['none', 'arrow', 'open'];

export function Properties() {
  const doc = useStore((s) => s.doc);
  const selection = useStore((s) => s.selection);
  const open = useOverlays((s) => s.panels.right);
  const st = useStore.getState;

  if (!open) {
    return (
      <aside className="properties collapsed">
        <PanelToggle side="right" label="properties" />
      </aside>
    );
  }

  const items = selection.map((id) => doc.items[id]);
  // Components are styled through their template, so they get a data section instead.
  const components = items.filter(isShape).filter((s) => s.kind === 'component');
  const shapes = items.filter(isShape).filter((s) => s.kind !== 'component');
  const connectors = items.filter(isConnector);
  // Fields show the first selected item's values; edits apply to every selected item of that type.
  const shape = shapes[0];
  const line = connectors[0];
  const instance = selection.length === 1 ? components[0] : undefined;

  return (
    <aside className="properties">
      <div className="panel-head">
        <PanelToggle side="right" label="properties" />
      </div>
      {instance && (
        <DataSection
          shape={instance}
          component={instance.componentId ? doc.components?.[instance.componentId] : undefined}
        />
      )}

      {!shape && !line && !instance && (
        <>
          <h3>Document</h3>
          <p className="muted">
            {doc.order.length} item{doc.order.length === 1 ? '' : 's'}.{' '}
            {components.length > 1 ? `${components.length} components selected.` : 'Select a shape or line to style it.'}
          </p>
        </>
      )}

      {shape && (
        <section>
          <h3>{shapes.length > 1 ? `${shapes.length} shapes` : 'Shape'}</h3>
          <ColorField label="Fill" value={shape.style.fill} onChange={(fill) => st().styleShapes({ fill }, 'fill')} />
          <SliderField
            label="Fill opacity"
            value={shape.style.fillOpacity ?? 1}
            disabled={shape.style.fill === 'none'}
            onChange={(fillOpacity) => st().styleShapes({ fillOpacity }, 'fillOpacity')}
          />
          <ColorField label="Border" value={shape.style.stroke} onChange={(stroke) => st().styleShapes({ stroke }, 'stroke')} />
          <NumberField
            label="Border width"
            value={shape.style.strokeWidth}
            min={0}
            max={12}
            step={0.5}
            onChange={(strokeWidth) => st().styleShapes({ strokeWidth }, 'strokeWidth')}
          />
          <SliderField
            label="Opacity"
            value={shape.style.opacity ?? 1}
            onChange={(opacity) => st().styleShapes({ opacity }, 'opacity')}
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
          <SliderField
            label="Opacity"
            value={line.style.opacity ?? 1}
            onChange={(opacity) => st().editConnectors({ style: { opacity } }, 'lineOpacity')}
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
          <label className="field">
            <span>Label at start</span>
            <input
              type="text"
              value={line.sourceLabel ?? ''}
              onChange={(e) => st().editConnectors({ sourceLabel: e.target.value }, 'sourceLabel')}
            />
          </label>
          <label className="field">
            <span>Label at end</span>
            <input
              type="text"
              value={line.targetLabel ?? ''}
              onChange={(e) => st().editConnectors({ targetLabel: e.target.value }, 'targetLabel')}
            />
          </label>
        </section>
      )}
    </aside>
  );
}
