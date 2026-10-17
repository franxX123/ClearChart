import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface MenuItem {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  run: () => void;
}

export type MenuEntry = MenuItem | 'separator';

const MARGIN = 4;

/**
 * A right-click menu at client position (x, y), kept inside the window. Closes on Escape, a
 * press outside, the wheel, window blur or resize, and after an item runs. Arrow keys move
 * between items. Global shortcuts ignore keys pressed inside `.context-menu`.
 */
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuEntry[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const r = ref.current!.getBoundingClientRect();
    setPos({
      left: Math.max(MARGIN, Math.min(x, window.innerWidth - r.width - MARGIN)),
      top: Math.max(MARGIN, Math.min(y, window.innerHeight - r.height - MARGIN)),
    });
    ref.current!.focus();
  }, [x, y]);

  useEffect(() => {
    const outside = (e: Event) => !ref.current?.contains(e.target as Node) && onClose();
    const close = () => onClose();
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('wheel', close, { passive: true });
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('wheel', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
    };
  }, [onClose]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const buttons = [...ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    if (!buttons.length) return;
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? buttons.length - 1
          : e.key === 'ArrowDown'
            ? (i + 1) % buttons.length
            : (i <= 0 ? buttons.length : i) - 1;
    buttons[next].focus();
  };

  return createPortal(
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      tabIndex={-1}
      style={pos}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) =>
        it === 'separator' ? (
          <div key={i} className="menu-sep" role="separator" />
        ) : (
          <button
            key={i}
            role="menuitem"
            disabled={it.disabled}
            onClick={() => {
              onClose();
              it.run();
            }}
          >
            <span>{it.label}</span>
            {it.shortcut && <span className="menu-key">{it.shortcut}</span>}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
