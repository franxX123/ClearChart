import type { NodeComponent } from '../model/types';
import type { GraphTemplate, LinkComponent } from './types';

const STORAGE_KEY = 'clearchart:templates';

interface TemplatesFile {
  version: 1;
  kind: 'clearchart-templates';
  templates: GraphTemplate[];
}

export const serializeTemplates = (templates: GraphTemplate[]) =>
  JSON.stringify({ version: 1, kind: 'clearchart-templates', templates } satisfies TemplatesFile, null, 2);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const isPositive = (v: unknown) => typeof v === 'number' && v > 0;

export const isNodeComponent = (c: unknown) =>
  isObj(c) && typeof c.id === 'string' && Array.isArray(c.parts) && isPositive(c.w) && isPositive(c.h);

/** Parses a templates file, throwing if it isn't one. Malformed components are dropped. */
export function parseTemplates(json: string): GraphTemplate[] {
  const raw = JSON.parse(json) as Partial<TemplatesFile>;
  if (raw?.version !== 1 || raw.kind !== 'clearchart-templates' || !Array.isArray(raw.templates)) {
    throw new Error('Not a ClearChart templates file');
  }
  return raw.templates.filter(isObj).flatMap((t): GraphTemplate[] => {
    if (typeof t.id !== 'string' || typeof t.name !== 'string') return [];
    return [
      {
        id: t.id,
        name: t.name,
        fields: Array.isArray(t.fields) ? t.fields.filter((f) => typeof f === 'string') : [],
        nodes: Array.isArray(t.nodes) ? (t.nodes.filter(isNodeComponent) as NodeComponent[]) : [],
        links: Array.isArray(t.links)
          ? (t.links.filter((c) => isObj(c) && typeof c.id === 'string' && isObj(c.style)) as LinkComponent[])
          : [],
      },
    ];
  });
}

export function loadTemplates(): GraphTemplate[] {
  try {
    const json = localStorage.getItem(STORAGE_KEY);
    return json ? parseTemplates(json) : [];
  } catch {
    return [];
  }
}

export function saveTemplates(templates: GraphTemplate[]): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, kind: 'clearchart-templates', templates }));
    return true;
  } catch {
    // Storage may be full (large images) or blocked; the caller warns.
    return false;
  }
}
