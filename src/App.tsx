import { useEffect } from 'react';
import { Canvas } from './canvas/Canvas';
import { saveAutosave } from './io/persist';
import { useStore } from './model/store';
import { Properties } from './ui/Properties';
import { ShapeLibrary } from './ui/ShapeLibrary';
import { useShortcuts } from './ui/shortcuts';
import { Toolbar } from './ui/Toolbar';

const AUTOSAVE_DELAY_MS = 500;

function useAutosave() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = useStore.subscribe((s, prev) => {
      if (s.doc === prev.doc) return;
      clearTimeout(timer);
      timer = setTimeout(() => saveAutosave(useStore.getState().doc), AUTOSAVE_DELAY_MS);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, []);
}

export function App() {
  useShortcuts();
  useAutosave();
  return (
    <div className="app">
      <Toolbar />
      <div className="workspace">
        <ShapeLibrary />
        <Canvas />
        <Properties />
      </div>
    </div>
  );
}
