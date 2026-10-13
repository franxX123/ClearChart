import { describe, expect, it } from 'vitest';
import { DEFAULT_SHAPE_STYLE, makeConnector, makeShape } from './doc';
import {
  applyTemplate,
  defaultTemplates,
  fitNodeSize,
  lineFromTemplate,
  matchPlatform,
  nodeFromTemplate,
  renderNodeText,
  restyleNode,
  rulesMatch,
  templateFields,
  templateForPlatform,
  templateFromLine,
  templateFromShape,
} from './templates';
import type { NodeTemplate, Templates } from './types';

/** A box element with the device fields inside it. */
const box = (over: Partial<NodeTemplate> = {}): NodeTemplate => ({
  id: 'box',
  name: 'Device',
  kind: 'roundRect',
  w: 160,
  h: 64,
  style: { ...DEFAULT_SHAPE_STYLE },
  text: '{hostName}\n{hostIP}\n{hostPlatform}',
  ...over,
});

/** A picture element (text beside it), with platform rules. */
const picture = (id: string, platforms: string[] = []): NodeTemplate => ({
  ...box({ id, name: id, kind: 'image', w: 56, h: 40 }),
  style: { ...DEFAULT_SHAPE_STYLE, fill: 'none', stroke: 'none' },
  image: { asset: `a-${id}` },
  textPosition: 'right',
  platforms,
});

describe('templates', () => {
  it('fills placeholders case-insensitively and drops lines whose fields are all empty', () => {
    const text = 'hostName: {name}\nIP: {IP}\nplatform: {platform}\n-- fixed --';
    expect(applyTemplate(text, { name: 'sw1', ip: '10.0.0.1' })).toBe('hostName: sw1\nIP: 10.0.0.1\n-- fixed --');
    expect(applyTemplate('{a} / {b}', { b: 'x' })).toBe(' / x');
  });

  it('lists placeholder fields once, in order', () => {
    expect(templateFields('{name}\n{ip} {Name}', '{hostInterface}')).toEqual(['name', 'ip', 'hostInterface']);
  });

  it('grows a node to fit its text but never below the template size', () => {
    const style = box().style;
    expect(fitNodeSize('rect', 160, 64, 'short', style)).toEqual({ w: 160, h: 64 });
    const big = fitNodeSize('rect', 160, 64, 'a much much longer device name here\n2\n3\n4', style);
    expect(big.w).toBeGreaterThan(160);
    expect(big.h).toBeGreaterThan(64);
  });

  it('makes a node from a template, centered, linked and carrying its data', () => {
    const t = box();
    const s = nodeFromTemplate(t, { hostName: 'core1', hostPlatform: 'N9K' }, { x: 100, y: 100 });
    expect(s).toMatchObject({ kind: 'roundRect', text: 'core1\nN9K', templateId: t.id, data: { hostName: 'core1', hostPlatform: 'N9K' } });
    expect(s.textPosition).toBeUndefined();
    expect(s.image).toBeUndefined();
    expect(s.x + s.w / 2).toBeCloseTo(100, 0);
    expect(s.style).not.toBe(t.style);
  });

  it('re-renders text on data changes and restyles from a changed template, keeping the center', () => {
    const t = box();
    const s = nodeFromTemplate(t, { hostName: 'a' }, { x: 0, y: 0 });
    s.data = { hostName: 'a', hostIP: '1.2.3.4' };
    renderNodeText(s, t);
    expect(s.text).toBe('a\n1.2.3.4');
    const changed = { ...t, kind: 'ellipse' as const, w: 200, text: 'Device {hostName}', style: { ...t.style, fill: '#ff0000' } };
    restyleNode(s, changed);
    expect(s).toMatchObject({ kind: 'ellipse', text: 'Device a', w: 200 });
    expect(s.style.fill).toBe('#ff0000');
    expect(s.x + s.w / 2).toBeCloseTo(0, 5);
  });

  it('makes picture nodes at the template size with their text beside them, however long the text', () => {
    const t = picture('sw');
    const long = 'a-very-long-hostname-that-would-not-fit-in-56px';
    const s = nodeFromTemplate(t, { hostName: long, hostIP: '10.0.0.1' }, { x: 100, y: 100 });
    expect(s).toMatchObject({ kind: 'image', image: { asset: 'a-sw' }, textPosition: 'right', w: 56, h: 40, text: `${long}\n10.0.0.1` });
    s.data = { ...s.data, hostPlatform: 'C9300' };
    renderNodeText(s, t);
    expect(s.text).toBe(`${long}\n10.0.0.1\nC9300`);
    expect({ w: s.w, h: s.h }).toEqual({ w: 56, h: 40 });
  });

  it('restyles between box and picture elements, keeping the center', () => {
    const s = nodeFromTemplate(box(), { hostName: 'r1' }, { x: 50, y: 50 });
    restyleNode(s, picture('router'));
    expect(s).toMatchObject({ kind: 'image', image: { asset: 'a-router' }, textPosition: 'right', w: 56, h: 40 });
    expect(s.x + s.w / 2).toBeCloseTo(50, 5);
    restyleNode(s, box());
    expect(s.kind).toBe('roundRect');
    expect(s.image).toBeUndefined();
    expect(s.textPosition).toBeUndefined();
    // A box element can put its text beside it too.
    restyleNode(s, box({ textPosition: 'right', w: 72, h: 48 }));
    expect(s).toMatchObject({ kind: 'roundRect', textPosition: 'right', w: 72, h: 48 });
  });

  it('picks the element whose platform rule is the longest match, ignoring case, your own before built-ins', () => {
    const builtIn = (t: NodeTemplate): NodeTemplate => ({ ...t, builtIn: true });
    const templates: Templates = {
      nodes: [
        builtIn(picture('generic')),
        builtIn(picture('switch', ['c9', 'catalyst'])),
        builtIn(picture('wireless', ['c91'])),
        picture('9300', ['9300', ' ']),
        picture('9300-48', ['C9300-48']),
        picture('router', ['ISR']),
      ],
      lines: [],
      defaultNodeId: 'generic',
    };
    // Your own rules first, even when a built-in rule ("catalyst") is longer.
    expect(templateForPlatform(templates, 'Catalyst C9300-24T')?.id).toBe('9300');
    // Among your own, the longest match.
    expect(templateForPlatform(templates, 'Catalyst C9300-48P')?.id).toBe('9300-48');
    // Built-ins only when none of yours match; the longest among them.
    expect(templateForPlatform(templates, 'cisco C9500-24Y4C')?.id).toBe('switch');
    expect(templateForPlatform(templates, 'C9120AXI-B')?.id).toBe('wireless');
    expect(templateForPlatform(templates, 'isr4451-x/k9')?.id).toBe('router');
    // No match, an empty platform, or a blank rule: the default element.
    expect(templateForPlatform(templates, 'Juniper MX204')?.id).toBe('generic');
    expect(templateForPlatform(templates, '')?.id).toBe('generic');
    expect(templateForPlatform(templates, undefined)?.id).toBe('generic');
    // An explicit default wins over the document's; without either, the first element.
    expect(templateForPlatform(templates, 'MX204', 'router')?.id).toBe('router');
    expect(templateForPlatform({ ...templates, defaultNodeId: undefined }, 'MX204')?.id).toBe('generic');
    expect(templateForPlatform({ nodes: [], lines: [] }, 'x')).toBeUndefined();
    // Without the default fallback: only real matches.
    expect(matchPlatform(templates, 'ISR4451')?.id).toBe('router');
    expect(matchPlatform(templates, 'Juniper MX204')).toBeUndefined();
    expect(matchPlatform(templates, '')).toBeUndefined();
    expect(rulesMatch(['9300', ' '], 'Catalyst C9300')).toBe(true);
    expect(rulesMatch(['9300', ' '], 'C9500')).toBe(false);
    expect(rulesMatch([], 'C9500')).toBe(false);
  });

  it('makes lines with end labels from data', () => {
    const t = defaultTemplates().lines[0];
    const c = lineFromTemplate(t, { hostInterface: 'Gi0/1', neighborInterface: 'Gi0/2' }, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(c).toMatchObject({ routing: 'straight', startLabel: 'Gi0/1', endLabel: 'Gi0/2', label: '', templateId: t.id });
    expect(c.style.endArrow).toBe('none');
  });

  it('captures templates from a shape and a line', () => {
    const s = makeShape('hexagon', { x: 5, y: 5, w: 120.4, h: 60 }, 'Name: {name}', { fill: '#abcdef' });
    expect(templateFromShape(s, 'Router', 'r')).toMatchObject({ id: 'r', name: 'Router', kind: 'hexagon', w: 120, h: 60, text: 'Name: {name}' });
    const c = makeConnector({ x: 0, y: 0 }, { x: 1, y: 1 }, '{speed}');
    c.endLabel = '{neighborInterface}';
    expect(templateFromLine(c, 'Uplink', 'u')).toMatchObject({ label: '{speed}', startLabel: '', endLabel: '{neighborInterface}' });
  });

  it('captures a picture as a picture element with the device fields beside it', () => {
    const s = makeShape('image', { x: 0, y: 0, w: 80, h: 50 }, '');
    s.image = { src: 'data:image/png;base64,AAAA' };
    const t = templateFromShape(s, 'Nexus', 'n', 'asset1');
    expect(t).toMatchObject({ kind: 'image', image: { asset: 'asset1' }, textPosition: 'right', w: 80, h: 50, text: '{hostName}\n{hostIP}\n{hostPlatform}' });
  });

  it('starts with the built-in device elements, the generic one as default', () => {
    const t = defaultTemplates();
    expect(t.nodes.map((n) => n.name)).toContain('Switch');
    const def = t.nodes.find((n) => n.id === t.defaultNodeId);
    expect(def?.name).toBe('Generic device');
    expect(def?.platforms).toEqual([]);
    for (const n of t.nodes) expect(n).toMatchObject({ kind: 'image', textPosition: 'right', text: '{hostName}\n{hostIP}\n{hostPlatform}' });
    expect(t.lines.map((l) => l.name)).toEqual(['Link']);
  });
});
