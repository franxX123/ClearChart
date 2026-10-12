import { useEffect } from 'react';
import { saveDocFile } from '../io/persist';
import { useStore } from '../model/store';

export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
      const st = useStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const run = (fn: () => void) => {
        e.preventDefault();
        fn();
      };

      if (mod) {
        if (key === 'z' && e.shiftKey) return run(st.redo);
        if (key === 'z') return run(st.undo);
        if (key === 'y') return run(st.redo);
        if (key === 'c') return run(st.copy);
        if (key === 'x') return run(() => (st.copy(), st.deleteSelection()));
        if (key === 'v') return run(st.paste);
        if (key === 'd') return run(st.duplicate);
        if (key === 'a') return run(st.selectAll);
        if (key === 's') return run(() => saveDocFile(st.doc));
        if (key === ']') return run(st.bringToFront);
        if (key === '[') return run(st.sendToBack);
        if (key === '=' || key === '+') return run(() => st.zoomBy(1.2));
        if (key === '-') return run(() => st.zoomBy(1 / 1.2));
        if (key === '0') return run(() => st.zoomTo(1));
        return;
      }

      if (e.shiftKey && e.code === 'Digit1') return run(st.fitToScreen);
      if (key === 'delete' || key === 'backspace') return run(st.deleteSelection);
      if (key === 'escape') return run(() => st.setSelection([]));
      if (key === 'enter' && st.selection.length === 1) return run(() => st.setEditing(st.selection[0]));

      const step = e.shiftKey ? 10 : 1;
      const arrows: Record<string, [number, number]> = {
        arrowleft: [-step, 0],
        arrowright: [step, 0],
        arrowup: [0, -step],
        arrowdown: [0, step],
      };
      if (arrows[key] && st.selection.length) return run(() => st.nudge(...arrows[key]));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
