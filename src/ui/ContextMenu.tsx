import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { isShape } from '../model/doc';
import { currentPage, useStore } from '../model/store';
import type { Point } from '../model/types';
import { useDialog } from './dialogState';

interface Entry {
  label: string;
  keys: string;
  enabled: boolean;
  run: () => void;
}

/**
 * Right-click menu over the canvas. `x`/`y` are relative to the canvas container; `world` is
 * where it was opened, used by Paste.
 */
export function ContextMenu({ x, y, world, onClose }: { x: number; y: number; world: Point; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const hasSelection = useStore((s) => s.selection.length > 0);
  const canUndo = useStore((s) => s.history.past.length > 0);
  const canRedo = useStore((s) => s.history.future.length > 0);
  const canPaste = useStore((s) => s.clipboard !== null);
  const single = useStore((s) => (s.selection.length === 1 ? currentPage(s).items[s.selection[0]] : undefined));
  const st = useStore.getState;

  const groups: Entry[][] = [
    [
      { label: 'Undo', keys: 'Ctrl+Z', enabled: canUndo, run: () => st().undo() },
      { label: 'Redo', keys: 'Ctrl+Shift+Z', enabled: canRedo, run: () => st().redo() },
    ],
    [
      { label: 'Cut', keys: 'Ctrl+X', enabled: hasSelection, run: () => (st().copy(), st().deleteSelection()) },
      { label: 'Copy', keys: 'Ctrl+C', enabled: hasSelection, run: () => st().copy() },
      { label: 'Paste', keys: 'Ctrl+V', enabled: canPaste, run: () => st().paste(world) },
      { label: 'Duplicate', keys: 'Ctrl+D', enabled: hasSelection, run: () => st().duplicate() },
      { label: 'Delete', keys: 'Del', enabled: hasSelection, run: () => st().deleteSelection() },
    ],
    [
      { label: 'Bring to front', keys: 'Ctrl+]', enabled: hasSelection, run: () => st().bringToFront() },
      { label: 'Send to back', keys: 'Ctrl+[', enabled: hasSelection, run: () => st().sendToBack() },
    ],
  ];
  // Templates: from one plain shape or line, or back into the template a templated item uses.
  if (single && !(isShape(single) && single.kind === 'image')) {
    const dialogs = useDialog.getState();
    groups.push(
      single.templateId
        ? [
            { label: 'Edit template…', keys: '', enabled: true, run: () => dialogs.open({ kind: 'editTemplate', templateId: single.templateId! }) },
            { label: 'Update template from this item', keys: '', enabled: true, run: () => st().updateTemplateFromItem(single.id) },
          ]
        : [
            {
              label: isShape(single) ? 'Save as node template…' : 'Save as line template…',
              keys: '',
              enabled: true,
              run: () => dialogs.open({ kind: 'saveTemplate', itemId: single.id }),
            },
          ],
    );
  }

  // Keep the menu inside the canvas, then focus its first enabled item for keyboard use.
  useLayoutEffect(() => {
    const el = ref.current!;
    const parent = el.offsetParent as HTMLElement | null;
    const maxX = (parent?.clientWidth ?? Infinity) - el.offsetWidth - 4;
    const maxY = (parent?.clientHeight ?? Infinity) - el.offsetHeight - 4;
    setPos({ x: Math.max(4, Math.min(x, maxX)), y: Math.max(4, Math.min(y, maxY)) });
    el.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [x, y]);

  // Close on a press outside the menu, or when the window loses focus.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Keep global shortcuts (Delete, Ctrl+Z…) from firing while the menu has focus.
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      style={{ left: pos.x, top: pos.y }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {groups.map((group, gi) => (
        <div key={gi} className="context-group" role="group">
          {group.map((item) => (
            <button
              key={item.label}
              role="menuitem"
              disabled={!item.enabled}
              onClick={() => {
                onClose();
                item.run();
              }}
            >
              <span>{item.label}</span>
              <span className="keys">{item.keys}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
