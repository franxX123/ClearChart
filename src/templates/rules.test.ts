import { describe, expect, it } from 'vitest';
import { DEFAULT_SHAPE_STYLE, makeShape } from '../model/doc';
import type { NodeComponent } from '../model/types';
import {
  fillPlaceholders,
  matchRule,
  parseValues,
  partsFromSelection,
  pickLink,
  pickNode,
  placeholderFields,
} from './rules';
import type { GraphTemplate, LinkComponent } from './types';

const node = (id: string, rule: NodeComponent['rule']): NodeComponent => ({ id, name: id, rule, w: 10, h: 10, parts: [] });
const link = (id: string, rule: LinkComponent['rule']) =>
  ({ id, name: id, rule, routing: 'straight', label: '', style: {} }) as LinkComponent;

const template = (nodes: NodeComponent[], links: LinkComponent[] = []): GraphTemplate => ({
  id: 't',
  name: 't',
  fields: [],
  nodes,
  links,
});

describe('rules', () => {
  it('matches trimmed, case-insensitive values, any of several', () => {
    const rule = { field: 'platform', values: parseValues(' Cisco 9200 ,cisco 9300,, ') };
    expect(rule.values).toEqual(['Cisco 9200', 'cisco 9300']);
    expect(matchRule(rule, { platform: 'cisco 9200' })).toBe(true);
    expect(matchRule(rule, { platform: '  CISCO 9300 ' })).toBe(true);
    expect(matchRule(rule, { platform: 'cisco 9500' })).toBe(false);
    expect(matchRule(rule, {})).toBe(false);
    expect(matchRule({ field: '', values: ['x'] }, { '': 'x' })).toBe(false);
  });

  it('picks the first matching component, then the default, then nothing', () => {
    const t = template([
      node('fallback', null),
      node('switch', { field: 'platform', values: ['cisco 9300'] }),
      node('any-cisco', { field: 'platform', values: ['cisco 9300', 'cisco 4451'] }),
    ]);
    expect(pickNode(t, { platform: 'cisco 9300' })?.id).toBe('switch');
    expect(pickNode(t, { platform: 'cisco 4451' })?.id).toBe('any-cisco');
    expect(pickNode(t, { platform: 'juniper' })?.id).toBe('fallback');
    expect(pickNode(template([node('switch', { field: 'platform', values: ['x'] })]), { platform: 'y' })).toBeUndefined();
    expect(pickNode(null, {})).toBeUndefined();
  });

  it('matches a line rule against either end', () => {
    const t = template([], [link('fiber', { field: 'cableType', values: ['fiber'] }), link('plain', null)]);
    expect(pickLink(t, { cableType: 'copper' }, { cableType: 'Fiber' })?.id).toBe('fiber');
    expect(pickLink(t, { cableType: 'copper' }, {})?.id).toBe('plain');
  });

  it('fills placeholders, leaving them visible only without a record', () => {
    expect(fillPlaceholders('{{name}} ({{ ip }})', { name: 'sw1', ip: '10.0.0.1' })).toBe('sw1 (10.0.0.1)');
    expect(fillPlaceholders('{{name}} / {{site}}', { name: 'sw1' })).toBe('sw1 / ');
    expect(fillPlaceholders('{{name}}', undefined)).toBe('{{name}}');
    expect(placeholderFields(['{{name}}', '{{ip}} {{name}}', 'plain'])).toEqual(['name', 'ip']);
  });

  it('turns a selection into parts relative to its bounding box', () => {
    const a = makeShape('rect', { x: 100, y: 50, w: 40, h: 20 }, '{{name}}');
    const b = makeShape('image', { x: 150, y: 80, w: 10, h: 10 });
    b.src = 'data:image/png;base64,AAAA';
    const out = partsFromSelection([a, b])!;
    expect(out).toMatchObject({ w: 60, h: 40 });
    expect(out.parts[0]).toMatchObject({ kind: 'rect', x: 0, y: 0, w: 40, h: 20, text: '{{name}}' });
    expect(out.parts[1]).toMatchObject({ kind: 'image', x: 50, y: 30, src: b.src });
    expect(out.parts[0]).not.toHaveProperty('id');
    expect(partsFromSelection([])).toBeNull();
  });

  it('flattens component instances in a selection into their parts', () => {
    const def: NodeComponent = {
      id: 'c',
      name: 'c',
      rule: null,
      w: 20,
      h: 10,
      parts: [{ kind: 'rect', x: 10, y: 0, w: 10, h: 10, text: '', style: DEFAULT_SHAPE_STYLE }],
    };
    const inst = makeShape('component', { x: 0, y: 0, w: 40, h: 20 });
    inst.componentId = 'c';
    const out = partsFromSelection([inst], { c: def })!;
    // Scaled 2x: the part's box doubles, its offset doubles.
    expect(out.parts).toHaveLength(1);
    expect(out.parts[0]).toMatchObject({ x: 20, y: 0, w: 20, h: 20 });
  });
});
