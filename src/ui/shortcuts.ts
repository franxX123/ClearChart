import { useEffect } from 'react';
import { saveDocFile } from '../io/persist';
import { useStore } from '../model/store';
import { ARROW_SHORTCUT, LIBRARY } from '../shapes/library';
import { addImageFromDevice } from './ShapeLibrary';

/** Inputs that take clicks rather than typing: keyboard shortcuts still work while they have focus. */
const NON_TEXT_INPUTS = new Set(['range', 'color', 'checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'image']);

/** Whether keys pressed in `el` are typing (in a text field, text area, select or editable). */
function isTextEntry(el: Element): boolean {
  if (el.closest('textarea, select, [contenteditable="true"]')) return true;
  const input = el.closest('input');
  return !!input && !NON_TEXT_INPUTS.has(input.type);
}

/** The number key pressed (main row or keypad), or null. */
function digitOf(e: KeyboardEvent): string | null {
  const m = /^(?:Digit|Numpad)([0-9])$/.exec(e.code);
  return m ? m[1] : null;
}

/** Arms the draw tool of the Basic tile with number `key` (1 Rectangle … 6 Arrow); false if none. */
function armTool(key: string): boolean {
  const st = useStore.getState();
  if (key === ARROW_SHORTCUT) {
    st.setTool('arrow');
    return true;
  }
  const entry = LIBRARY.findIndex((e) => e.shortcut === key);
  if (entry < 0) return false;
  // A picture needs its file first: open the picker straight away (it's placed at the view center).
  if (LIBRARY[entry].kind === 'image') void addImageFromDevice();
  else st.setPlacing({ kind: 'shape', entry });
  return true;
}

export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Keys sent to the window or document itself (not from an element) count as on the page.
      const target = e.target instanceof Element ? e.target : document.body;
      if (isTextEntry(target)) return;
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
        if (key === 'g' && e.shiftKey) return run(st.ungroup);
        if (key === 'g') return run(st.group);
        if (key === 's') return run(() => saveDocFile(st.doc));
        if (key === ']') return run(st.bringToFront);
        if (key === '[') return run(st.sendToBack);
        if (key === '=' || key === '+') return run(() => st.zoomBy(1.2));
        if (key === '-') return run(() => st.zoomBy(1 / 1.2));
        if (key === '0') return run(() => st.zoomTo(1));
        return;
      }

      if (e.shiftKey && e.code === 'Digit1') return run(st.fitToScreen);
      const digit = !e.shiftKey && !e.altKey ? digitOf(e) : null;
      if (digit && armTool(digit)) return e.preventDefault();
      if (key === 'delete' || key === 'backspace') return run(st.deleteSelection);
      if (key === 'escape') return run(() => (st.setTool('select'), st.setSelection([])));
      if (key === 'a' && !e.shiftKey && !e.altKey) return run(() => st.setTool('arrow'));
      if (key === 'v' && !e.shiftKey && !e.altKey) return run(() => st.setTool('select'));
      if (key === 'enter' && st.selection.length === 1) return run(() => st.setEditing(st.selection[0]));

      // Arrow keys move a focused slider; they only nudge when no slider has focus.
      if (target.closest('input[type="range"]')) return;
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
