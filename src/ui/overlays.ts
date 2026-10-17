import { create } from 'zustand';
import { isConnector, isShape } from '../model/doc';
import { useStore } from '../model/store';

/** A component dialog to show. Without `templateId` the dialog asks which template to use. */
export interface DialogRequest {
  kind: 'node' | 'link';
  templateId?: string;
  /** Component to edit; omitted to create one. */
  compId?: string;
}

const LAST_TEMPLATE_KEY = 'clearchart:lastTemplate';
const TOAST_MS = 3500;

/** UI state that isn't part of any document: the open component dialog and the toast message. */
interface OverlaysState {
  dialog: DialogRequest | null;
  toast: { id: number; text: string } | null;
  /** Template a component was last saved into; the default when the dialog asks. */
  lastTemplateId: string | null;
  openDialog: (d: DialogRequest) => void;
  closeDialog: () => void;
  showToast: (text: string) => void;
  hideToast: () => void;
  setLastTemplate: (id: string) => void;
}

const readLast = () => {
  try {
    return localStorage.getItem(LAST_TEMPLATE_KEY);
  } catch {
    return null;
  }
};

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const useOverlays = create<OverlaysState>()((set) => ({
  dialog: null,
  toast: null,
  lastTemplateId: readLast(),
  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: null }),
  showToast: (text) => {
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => set({ toast: null }), TOAST_MS);
    set({ toast: { id: Date.now(), text } });
  },
  hideToast: () => {
    clearTimeout(toastTimer);
    set({ toast: null });
  },
  setLastTemplate: (id) => {
    try {
      localStorage.setItem(LAST_TEMPLATE_KEY, id);
    } catch {
      // Only a default; fine to lose.
    }
    set({ lastTemplateId: id });
  },
}));

export const showToast = (text: string) => useOverlays.getState().showToast(text);

const selected = () => {
  const { doc, selection } = useStore.getState();
  return selection.map((id) => doc.items[id]);
};

/** Opens the new node component dialog for the selected shapes, or explains what to select. */
export function startNodeComponent(templateId?: string): void {
  if (!selected().some(isShape)) {
    showToast('Select the shapes, text and images that make up the component first.');
    return;
  }
  useOverlays.getState().openDialog({ kind: 'node', templateId });
}

/** Opens the new line component dialog, seeded from the selected line, or asks for one. */
export function startLineComponent(templateId?: string): void {
  if (!selected().some(isConnector)) {
    showToast('Select a line first. The new line component starts from its style.');
    return;
  }
  useOverlays.getState().openDialog({ kind: 'link', templateId });
}
