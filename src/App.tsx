import { useEffect } from 'react';
import { Canvas } from './canvas/Canvas';
import { hasTabDoc, removeTabDoc, saveTabDoc, saveTabIndex } from './io/persist';
import type { Doc } from './model/types';
import { useStore } from './model/store';
import { Overlays } from './ui/Overlays';
import { Properties } from './ui/Properties';
import { ShapeLibrary } from './ui/ShapeLibrary';
import { useShortcuts } from './ui/shortcuts';
import { TabBar } from './ui/TabBar';
import { Toolbar } from './ui/Toolbar';

const AUTOSAVE_DELAY_MS = 500;

/**
 * Saves each tab's document under its own key (debounced) and the list of tabs whenever it
 * changes. Inactive tabs can't change, so only the active one is ever pending.
 */
function useAutosave() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending: { id: string; doc: Doc } | null = null;
    const flush = () => {
      clearTimeout(timer);
      if (pending) saveTabDoc(pending.id, pending.doc);
      pending = null;
    };
    const docOf = (id: string) => {
      const s = useStore.getState();
      return id === s.activeTab ? s.doc : s.parked[id]?.doc;
    };
    const saveIndex = () => {
      const { tabs, activeTab } = useStore.getState();
      // Tabs that were never saved (a fresh sample, or migrated from the single-diagram autosave).
      for (const id of tabs) if (!hasTabDoc(id)) saveTabDoc(id, docOf(id)!);
      saveTabIndex({ tabs, active: activeTab });
    };
    saveIndex();

    const unsubscribe = useStore.subscribe((s, prev) => {
      if (s.tabs !== prev.tabs || s.activeTab !== prev.activeTab) {
        // Save the tab being left before anything else.
        flush();
        for (const id of prev.tabs) if (!s.tabs.includes(id)) removeTabDoc(id);
        saveIndex();
        return;
      }
      if (s.doc === prev.doc) return;
      pending = { id: s.activeTab, doc: s.doc };
      clearTimeout(timer);
      timer = setTimeout(flush, AUTOSAVE_DELAY_MS);
    });
    window.addEventListener('pagehide', flush);
    return () => {
      flush();
      unsubscribe();
      window.removeEventListener('pagehide', flush);
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
        <div className="canvas-area">
          <Canvas />
          <TabBar />
        </div>
        <Properties />
      </div>
      <Overlays />
    </div>
  );
}
