import { useState, type ReactNode } from 'react';
import { COMPONENT_DRAG_MIME } from '../canvas/Canvas';
import { ComponentParts } from '../canvas/ShapeView';
import { downloadBlob, JSON_FILES, pickFile } from '../io/persist';
import { isConnector } from '../model/doc';
import { useStore, viewCenter } from '../model/store';
import type { NodeComponent } from '../model/types';
import { parseGraph } from '../templates/graph';
import { parseTemplates, serializeTemplates } from '../templates/persist';
import { describeRule } from '../templates/rules';
import { useTemplates } from '../templates/store';
import type { GraphTemplate, LinkComponent } from '../templates/types';
import { showToast, startLineComponent, startNodeComponent, useOverlays } from './overlays';

const lib = useTemplates.getState;

function NodeThumb({ comp }: { comp: NodeComponent }) {
  return (
    <svg viewBox={`-2 -2 ${comp.w + 4} ${comp.h + 4}`} width={40} height={30}>
      <ComponentParts component={comp} w={comp.w} h={comp.h} />
    </svg>
  );
}

function LinkThumb({ comp }: { comp: LinkComponent }) {
  const st = comp.style;
  const w = Math.min(st.strokeWidth, 4);
  return (
    <svg viewBox="0 0 40 30" width={40} height={30}>
      <line
        x1={4}
        y1={22}
        x2={36}
        y2={8}
        stroke={st.stroke}
        strokeWidth={w}
        strokeDasharray={st.dash === 'dashed' ? `${w * 4} ${w * 3}` : st.dash === 'dotted' ? `0 ${w * 2.5}` : undefined}
        strokeLinecap="round"
      />
    </svg>
  );
}

function ComponentRow({
  thumb,
  name,
  detail,
  title,
  first,
  last,
  onActivate,
  onDragStart,
  onMove,
  onEdit,
  onDelete,
}: {
  thumb: ReactNode;
  name: string;
  detail: string;
  title: string;
  first: boolean;
  last: boolean;
  onActivate: () => void;
  onDragStart?: (e: React.DragEvent) => void;
  onMove: (delta: -1 | 1) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className="comp-row"
      role="button"
      tabIndex={0}
      title={title}
      draggable={!!onDragStart}
      onDragStart={onDragStart}
      onClick={onActivate}
      onKeyDown={(e) => e.key === 'Enter' && onActivate()}
    >
      {thumb}
      <span className="comp-text">
        <span className="comp-name">{name}</span>
        <span className="muted">{detail}</span>
      </span>
      <span className="comp-actions" onClick={(e) => e.stopPropagation()}>
        <button className="icon" title="Higher priority" disabled={first} onClick={() => onMove(-1)}>
          ▲
        </button>
        <button className="icon" title="Lower priority" disabled={last} onClick={() => onMove(1)}>
          ▼
        </button>
        <button className="icon" title="Edit" onClick={onEdit}>
          ✎
        </button>
        <button className="icon" title="Delete" onClick={onDelete}>
          ✕
        </button>
      </span>
    </div>
  );
}

function TemplateSection({ tp, query }: { tp: GraphTemplate; query: string }) {
  const openDialog = useOverlays.getState().openDialog;
  const [open, setOpen] = useState(true);
  const match = (name: string) => name.toLowerCase().includes(query);
  const nodes = tp.nodes.filter((c) => match(c.name));
  const links = tp.links.filter((c) => match(c.name));

  const rename = () => {
    const name = prompt('Template name', tp.name)?.trim();
    if (name) lib().renameTemplate(tp.id, name);
  };
  const remove = () => {
    const n = tp.nodes.length + tp.links.length;
    if (confirm(`Delete the template "${tp.name}"${n ? ` and its ${n} component${n === 1 ? '' : 's'}` : ''}?`)) {
      lib().deleteTemplate(tp.id);
    }
  };
  const removeComponent = (c: { id: string; name: string }) => {
    if (confirm(`Delete the component "${c.name}"?`)) lib().deleteComponent(tp.id, c.id);
  };
  const loadFields = async () => {
    try {
      const file = await pickFile(JSON_FILES);
      if (!file) return;
      const { fields } = parseGraph(await file.text());
      lib().addFields(tp.id, fields);
    } catch (err) {
      alert(`Couldn't read fields: ${(err as Error).message}`);
    }
  };
  const applyLine = (c: LinkComponent) => {
    const st = useStore.getState();
    if (!st.selection.some((id) => isConnector(st.doc.items[id]))) {
      showToast(`Select the lines to apply "${c.name}" to.`);
      return;
    }
    st.editConnectors({ routing: c.routing, style: { ...c.style } });
  };

  return (
    <div className="template">
      <div className="template-head">
        <button className="template-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? '▾' : '▸'} {tp.name}
        </button>
        <button className="icon" title="Rename" onClick={rename}>
          ✎
        </button>
        <button className="icon" title="Delete template" onClick={remove}>
          ✕
        </button>
      </div>
      {open && (
        <>
          <div className="sub">Nodes</div>
          {nodes.map((c) => (
            <ComponentRow
              key={c.id}
              thumb={<NodeThumb comp={c} />}
              name={c.name}
              detail={describeRule(c.rule)}
              title="Click or drag onto the canvas"
              first={c === tp.nodes[0]}
              last={c === tp.nodes[tp.nodes.length - 1]}
              onActivate={() => useStore.getState().addComponent(c, viewCenter())}
              onDragStart={(e) => {
                e.dataTransfer.setData(COMPONENT_DRAG_MIME, JSON.stringify({ templateId: tp.id, componentId: c.id }));
                e.dataTransfer.effectAllowed = 'copy';
              }}
              onMove={(d) => lib().moveComponent(tp.id, c.id, d)}
              onEdit={() => openDialog({ kind: 'node', templateId: tp.id, compId: c.id })}
              onDelete={() => removeComponent(c)}
            />
          ))}
          {tp.nodes.length === 0 && <p className="muted small">No node components yet.</p>}
          <div className="sub">Lines</div>
          {links.map((c) => (
            <ComponentRow
              key={c.id}
              thumb={<LinkThumb comp={c} />}
              name={c.name}
              detail={describeRule(c.rule)}
              title="Click to apply this style to the selected lines"
              first={c === tp.links[0]}
              last={c === tp.links[tp.links.length - 1]}
              onActivate={() => applyLine(c)}
              onMove={(d) => lib().moveComponent(tp.id, c.id, d)}
              onEdit={() => openDialog({ kind: 'link', templateId: tp.id, compId: c.id })}
              onDelete={() => removeComponent(c)}
            />
          ))}
          {tp.links.length === 0 && <p className="muted small">No line components yet.</p>}
          <div className="btn-row wrap">
            <button
              className="small"
              onClick={() => startNodeComponent(tp.id)}
              title="Save the selected shapes as a node component"
            >
              + Node from selection
            </button>
            <button
              className="small"
              onClick={() => startLineComponent(tp.id)}
              title="Save the selected line's style as a line component"
            >
              + Line from selection
            </button>
            <button className="small" onClick={loadFields} title="Read field names from a sample graph JSON file">
              Load fields…
            </button>
          </div>
          {tp.fields.length > 0 && <p className="muted small">Fields: {tp.fields.join(', ')}</p>}
        </>
      )}
    </div>
  );
}

/** Sidebar section listing graph templates and their components. */
export function TemplateLibrary({ query }: { query: string }) {
  const templates = useTemplates((s) => s.templates);

  const create = () => {
    const name = prompt('Name the new graph template', `Template ${templates.length + 1}`)?.trim();
    if (name) lib().createTemplate(name);
  };
  const exportFile = () =>
    downloadBlob(new Blob([serializeTemplates(templates)], { type: 'application/json' }), 'clearchart-templates.json');
  const importFile = async () => {
    try {
      const file = await pickFile(JSON_FILES);
      if (!file) return;
      const incoming = parseTemplates(await file.text());
      lib().mergeTemplates(incoming);
      alert(`Imported ${incoming.length} template${incoming.length === 1 ? '' : 's'}.`);
    } catch (err) {
      alert(`Couldn't import templates: ${(err as Error).message}`);
    }
  };

  return (
    <section className="templates">
      <div className="section-head">
        <h3>Graph templates</h3>
        <button className="small" onClick={create}>
          + New
        </button>
      </div>
      {templates.length === 0 && (
        <p className="muted small">
          A graph template is a set of node and line components with rules. Use one with Import graph to build a diagram
          from a JSON edge list.
        </p>
      )}
      {templates.map((tp) => (
        <TemplateSection key={tp.id} tp={tp} query={query} />
      ))}
      <div className="btn-row">
        <button className="small" onClick={importFile}>
          Import…
        </button>
        <button className="small" onClick={exportFile} disabled={templates.length === 0}>
          Export…
        </button>
      </div>
    </section>
  );
}
