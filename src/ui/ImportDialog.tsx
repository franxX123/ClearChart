import { useMemo, useState } from 'react';
import { LINK_COLUMNS } from '../import/links';
import type { ImportSummary } from '../import/plan';
import { useStore } from '../model/store';
import { Modal } from './Modal';

const SHOW_SKIPPED = 5;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Previews a links CSV against the current page, lets you pick templates, then imports it. */
export function ImportDialog({ fileName, csv, onClose }: { fileName: string; csv: string; onClose: () => void }) {
  const templates = useStore((s) => s.doc.templates);
  const doc = useStore((s) => s.doc);
  const activePage = useStore((s) => s.activePageId);
  // Devices get the element their platform matches; the rest get the default element (or this choice).
  const [nodeTemplateId, setNodeTemplateId] = useState(templates?.defaultNodeId ?? templates?.nodes[0]?.id ?? '');
  // Links: the most recently made line template.
  const [lineTemplateId, setLineTemplateId] = useState(templates?.lines.at(-1)?.id ?? '');
  const opts = { nodeTemplateId, lineTemplateId };

  const result = useMemo((): { summary: ImportSummary } | { error: string } => {
    try {
      return { summary: useStore.getState().previewImport(csv, { nodeTemplateId, lineTemplateId }) };
    } catch (err) {
      return { error: (err as Error).message };
    }
    // The preview depends on the page's contents and the chosen templates.
  }, [csv, nodeTemplateId, lineTemplateId, doc, activePage]);

  const summary = 'summary' in result ? result.summary : null;
  const nothingNew = !!summary && summary.devicesNew + summary.linksNew + summary.devicesUpdated === 0;

  const run = () => {
    try {
      useStore.getState().importLinks(csv, opts);
      onClose();
    } catch (err) {
      alert(`Couldn't import: ${(err as Error).message}`);
    }
  };

  return (
    <Modal
      title={`Import ${fileName}`}
      onClose={onClose}
      actions={
        <>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!summary || nothingNew} onClick={run}>
            Import
          </button>
        </>
      }
    >
      {'error' in result ? (
        <div className="import-error" role="alert">
          <p>{result.error}</p>
          <p className="muted">
            The first row must be headers. Columns: <code>{LINK_COLUMNS.join(', ')}</code>. Only hostName and
            neighborName are required; other columns are kept as data on the links.
          </p>
        </div>
      ) : (
        <>
          <ul className="import-summary">
            <li>
              <b>Devices:</b> {summary!.devicesNew} new, {summary!.devicesExisting} already on this page
              {summary!.devicesUpdated > 0 && ` (${summary!.devicesUpdated} with updated fields)`}
              {summary!.byTemplate.length > 0 && (
                <div className="muted">New: {summary!.byTemplate.map((b) => `${b.count} × ${b.name}`).join(', ')}</div>
              )}
            </li>
            <li>
              <b>Links:</b> {summary!.linksNew} new, {summary!.linksExisting} already drawn
              {summary!.merged > 0 && `, ${plural(summary!.merged, 'duplicate row')} merged`}
            </li>
            {summary!.skipped.length > 0 && (
              <li>
                <b>Skipped:</b> {plural(summary!.skipped.length, 'row')}
                <ul className="muted">
                  {summary!.skipped.slice(0, SHOW_SKIPPED).map((s) => (
                    <li key={s.line}>
                      line {s.line}: {s.reason}
                    </li>
                  ))}
                  {summary!.skipped.length > SHOW_SKIPPED && <li>…and {summary!.skipped.length - SHOW_SKIPPED} more</li>}
                </ul>
              </li>
            )}
          </ul>
          {nothingNew && <p className="muted">Everything in this file is already on the page.</p>}
          <label className="field">
            <span>Devices whose platform matches no rule look like</span>
            <select value={nodeTemplateId} onChange={(e) => setNodeTemplateId(e.target.value)}>
              {templates?.nodes.length ? (
                templates.nodes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))
              ) : (
                <option value="">Generic device (default)</option>
              )}
            </select>
          </label>
          <p className="muted hint-small">
            Each device gets the element whose platform rule its hostPlatform matches (edit an element in Graphs → ⋯ to
            change its rules). The choice above becomes the default element.
          </p>
          <label className="field">
            <span>Links look like</span>
            <select value={lineTemplateId} onChange={(e) => setLineTemplateId(e.target.value)}>
              {templates?.lines.length ? (
                templates.lines.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))
              ) : (
                <option value="">Link (default)</option>
              )}
            </select>
          </label>
        </>
      )}
    </Modal>
  );
}
