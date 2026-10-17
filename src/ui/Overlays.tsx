import { useTemplates } from '../templates/store';
import { LinkComponentDialog, NodeComponentDialog } from './ComponentDialog';
import { useOverlays } from './overlays';

/** Renders the open component dialog and the toast message (see `overlays.ts`). */
export function Overlays() {
  const dialog = useOverlays((s) => s.dialog);
  const toast = useOverlays((s) => s.toast);
  const templates = useTemplates((s) => s.templates);
  const close = useOverlays.getState().closeDialog;

  // A dialog for a template that has since been deleted has nothing to save into.
  const template = dialog?.templateId ? templates.find((t) => t.id === dialog.templateId) : undefined;
  const show = dialog && (!dialog.templateId || template);

  return (
    <>
      {show && dialog.kind === 'node' && (
        <NodeComponentDialog
          templateId={dialog.templateId}
          initial={template?.nodes.find((c) => c.id === dialog.compId)}
          onClose={close}
        />
      )}
      {show && dialog.kind === 'link' && (
        <LinkComponentDialog
          templateId={dialog.templateId}
          initial={template?.links.find((c) => c.id === dialog.compId)}
          onClose={close}
        />
      )}
      {toast && (
        <div key={toast.id} className="toast" role="status" onClick={() => useOverlays.getState().hideToast()}>
          {toast.text}
        </div>
      )}
    </>
  );
}
