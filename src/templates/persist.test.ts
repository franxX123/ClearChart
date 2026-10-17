import { describe, expect, it } from 'vitest';
import { parseTemplates, serializeTemplates } from './persist';
import type { GraphTemplate } from './types';

const templates: GraphTemplate[] = [
  {
    id: 't1',
    name: 'Campus',
    fields: ['name', 'platform'],
    nodes: [{ id: 'n1', name: 'Switch', rule: { field: 'platform', values: ['cisco 9300'] }, w: 100, h: 50, parts: [] }],
    links: [
      {
        id: 'l1',
        name: 'Fiber',
        rule: null,
        routing: 'straight',
        label: '{{cableType}}',
        style: { stroke: '#e67e22', strokeWidth: 2, dash: 'dashed', startArrow: 'none', endArrow: 'none' },
      },
    ],
  },
];

describe('template files', () => {
  it('round-trips templates', () => {
    expect(parseTemplates(serializeTemplates(templates))).toEqual(templates);
  });

  it('rejects other files and drops malformed components', () => {
    expect(() => parseTemplates('[]')).toThrow('Not a ClearChart templates file');
    expect(() => parseTemplates(JSON.stringify({ version: 1, items: {}, order: [] }))).toThrow();
    const broken = JSON.parse(serializeTemplates(templates));
    broken.templates[0].nodes.push({ id: 'n2', parts: [], w: 0, h: 10 });
    broken.templates[0].links.push({ id: 'l2' });
    broken.templates.push({ name: 'no id' });
    const parsed = parseTemplates(JSON.stringify(broken));
    expect(parsed).toEqual(templates);
  });
});
