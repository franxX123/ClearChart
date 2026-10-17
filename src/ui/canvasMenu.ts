import { isShape } from '../model/doc';
import { groupUnits, hasGroup } from '../model/groups';
import { useStore } from '../model/store';
import type { Point } from '../model/types';
import type { MenuEntry } from './ContextMenu';
import { startLineComponent, startNodeComponent } from './overlays';

/** Items of the canvas right-click menu, for the current selection; `at` is where it opened. */
export function canvasMenuItems(at: Point): MenuEntry[] {
  const st = useStore.getState();
  const { doc, selection } = st;
  const none = selection.length === 0;
  const only = selection.length === 1 ? doc.items[selection[0]] : undefined;
  const component = isShape(only) && only.kind === 'component' && only.componentId && doc.components?.[only.componentId];

  return [
    { label: 'Undo', shortcut: 'Ctrl+Z', disabled: st.history.past.length === 0, run: st.undo },
    { label: 'Redo', shortcut: 'Ctrl+Shift+Z', disabled: st.history.future.length === 0, run: st.redo },
    'separator',
    { label: 'Copy', shortcut: 'Ctrl+C', disabled: none, run: st.copy },
    { label: 'Paste', shortcut: 'Ctrl+V', disabled: !st.clipboard, run: () => st.paste(at) },
    { label: 'Duplicate', shortcut: 'Ctrl+D', disabled: none, run: st.duplicate },
    'separator',
    { label: 'Group', shortcut: 'Ctrl+G', disabled: groupUnits(doc, selection) < 2, run: st.group },
    { label: 'Ungroup', shortcut: 'Ctrl+Shift+G', disabled: !hasGroup(doc, selection), run: st.ungroup },
    'separator',
    { label: 'Bring to front', shortcut: 'Ctrl+]', disabled: none, run: st.bringToFront },
    { label: 'Send to back', shortcut: 'Ctrl+[', disabled: none, run: st.sendToBack },
    'separator',
    { label: 'Create as Node Component…', run: () => startNodeComponent() },
    { label: 'Create as Line Component…', run: () => startLineComponent() },
    ...(component ? [{ label: 'Break apart', run: () => st.breakApart(only.id) }] : []),
    'separator',
    { label: 'Delete', shortcut: 'Del', disabled: none, run: st.deleteSelection },
  ];
}
