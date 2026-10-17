import { produce } from 'immer';
import { nanoid } from 'nanoid';
import { create } from 'zustand';
import type { NodeComponent } from '../model/types';
import { loadTemplates, saveTemplates } from './persist';
import type { GraphTemplate, LinkComponent } from './types';

/**
 * The user's template library. It lives outside the document (and outside undo history):
 * templates are reused across diagrams. Saved to localStorage on every change.
 */
interface TemplatesState {
  templates: GraphTemplate[];
  createTemplate: (name: string) => string;
  renameTemplate: (id: string, name: string) => void;
  deleteTemplate: (id: string) => void;
  addFields: (id: string, fields: string[]) => void;
  saveNode: (templateId: string, comp: NodeComponent) => void;
  saveLink: (templateId: string, comp: LinkComponent) => void;
  deleteComponent: (templateId: string, compId: string) => void;
  moveComponent: (templateId: string, compId: string, delta: -1 | 1) => void;
  /** Adds templates from a file; ones with an id already in the library replace it. */
  mergeTemplates: (incoming: GraphTemplate[]) => void;
}

const upsert = <T extends { id: string }>(list: T[], item: T) => {
  const i = list.findIndex((x) => x.id === item.id);
  if (i >= 0) list[i] = item;
  else list.push(item);
};

export const useTemplates = create<TemplatesState>()((set, get) => {
  const edit = (recipe: (ts: GraphTemplate[]) => void) => set({ templates: produce(get().templates, recipe) });
  const editOne = (id: string, recipe: (t: GraphTemplate) => void) =>
    edit((ts) => {
      const t = ts.find((x) => x.id === id);
      if (t) recipe(t);
    });

  return {
    templates: loadTemplates(),
    createTemplate: (name) => {
      const id = nanoid(10);
      edit((ts) => void ts.push({ id, name, fields: [], nodes: [], links: [] }));
      return id;
    },
    renameTemplate: (id, name) => editOne(id, (t) => void (t.name = name)),
    deleteTemplate: (id) => set({ templates: get().templates.filter((t) => t.id !== id) }),
    addFields: (id, fields) =>
      editOne(id, (t) => {
        for (const f of fields) if (!t.fields.includes(f)) t.fields.push(f);
      }),
    saveNode: (templateId, comp) => editOne(templateId, (t) => upsert(t.nodes, comp)),
    saveLink: (templateId, comp) => editOne(templateId, (t) => upsert(t.links, comp)),
    deleteComponent: (templateId, compId) =>
      editOne(templateId, (t) => {
        t.nodes = t.nodes.filter((c) => c.id !== compId);
        t.links = t.links.filter((c) => c.id !== compId);
      }),
    moveComponent: (templateId, compId, delta) =>
      editOne(templateId, (t) => {
        for (const list of [t.nodes, t.links] as { id: string }[][]) {
          const i = list.findIndex((c) => c.id === compId);
          const j = i + delta;
          if (i < 0 || j < 0 || j >= list.length) continue;
          [list[i], list[j]] = [list[j], list[i]];
        }
      }),
    mergeTemplates: (incoming) => edit((ts) => incoming.forEach((t) => upsert(ts, t))),
  };
});

let warned = false;
useTemplates.subscribe((s, prev) => {
  if (s.templates === prev.templates) return;
  if (!saveTemplates(s.templates) && !warned) {
    warned = true;
    alert('Templates could not be saved in this browser (storage full?). Use "Export" to keep a copy.');
  }
});
