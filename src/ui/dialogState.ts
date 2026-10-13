import { create } from 'zustand';

// Which modal dialog is open. Separate from the document store: dialogs are pure UI state,
// opened from the toolbar, the context menu or the shape panel and rendered by <Dialogs/>.

export type Dialog =
  | { kind: 'import'; fileName: string; csv: string }
  | { kind: 'saveTemplate'; itemId: string }
  | { kind: 'editTemplate'; templateId: string }
  | null;

export const useDialog = create<{ dialog: Dialog; open: (d: Dialog) => void; close: () => void }>()((set) => ({
  dialog: null,
  open: (dialog) => set({ dialog }),
  close: () => set({ dialog: null }),
}));
