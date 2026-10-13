import { useDialog } from './dialogState';
import { ImportDialog } from './ImportDialog';
import { EditTemplateDialog, SaveTemplateDialog } from './TemplateDialogs';

/** Renders whichever modal dialog is open (see `dialogState.ts`). */
export function Dialogs() {
  const dialog = useDialog((s) => s.dialog);
  const close = useDialog((s) => s.close);
  if (!dialog) return null;
  switch (dialog.kind) {
    case 'import':
      return <ImportDialog fileName={dialog.fileName} csv={dialog.csv} onClose={close} />;
    case 'saveTemplate':
      return <SaveTemplateDialog key={dialog.itemId} itemId={dialog.itemId} onClose={close} />;
    case 'editTemplate':
      return <EditTemplateDialog key={dialog.templateId} templateId={dialog.templateId} onClose={close} />;
  }
}
