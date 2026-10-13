import { describe, expect, it } from 'vitest';
import { makeConnector, makeShape } from './doc';
import {
  applyTemplate,
  defaultTemplates,
  fitNodeSize,
  lineFromTemplate,
  nodeFromTemplate,
  renderNodeText,
  restyleNode,
  templateFields,
  templateFromLine,
  templateFromShape,
} from './templates';

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
    const style = defaultTemplates().nodes[0].style;
    expect(fitNodeSize('rect', 160, 64, 'short', style)).toEqual({ w: 160, h: 64 });
    const big = fitNodeSize('rect', 160, 64, 'a much much longer device name here\n2\n3\n4', style);
    expect(big.w).toBeGreaterThan(160);
    expect(big.h).toBeGreaterThan(64);
  });

  it('makes a node from a template, centered, linked and carrying its data', () => {
    const t = defaultTemplates().nodes[0];
    const s = nodeFromTemplate(t, { hostName: 'core1', hostPlatform: 'N9K' }, { x: 100, y: 100 });
    expect(s).toMatchObject({ kind: 'roundRect', text: 'core1\nN9K', templateId: t.id, data: { hostName: 'core1', hostPlatform: 'N9K' } });
    expect(s.x + s.w / 2).toBeCloseTo(100, 0);
    expect(s.style).not.toBe(t.style);
  });

  it('re-renders text on data changes and restyles from a changed template, keeping the center', () => {
    const t = defaultTemplates().nodes[0];
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
});
