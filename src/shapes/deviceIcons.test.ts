import { describe, expect, it } from 'vitest';
import { defaultTemplates } from '../model/doc';
import { templateForPlatform } from '../model/templates';
import type { NodeTemplate } from '../model/types';
import { BUILT_IN_DEVICES, builtInAssetId, builtInAssets, DEFAULT_DEVICE_KEY } from './deviceIcons';

/** Whether every tag in `markup` is closed in order (a stand-in for an XML parser, which node lacks). */
function balanced(markup: string): boolean {
  const open: string[] = [];
  for (const m of markup.matchAll(/<(\/?)([a-zA-Z]+)[^>]*?(\/?)>/g)) {
    const [, closing, name, selfClosing] = m;
    if (selfClosing) continue;
    if (!closing) open.push(name);
    else if (open.pop() !== name) return false;
  }
  return open.length === 0;
}

describe('built-in device icons', () => {
  it('are small, well-formed SVG pictures, one per device', () => {
    const assets = builtInAssets();
    expect(Object.keys(assets)).toHaveLength(BUILT_IN_DEVICES.length);
    for (const d of BUILT_IN_DEVICES) {
      expect(d.svg.startsWith(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="`)).toBe(true);
      expect(d.svg).toContain(`width="${d.w}" height="${d.h}"`);
      expect(d.svg.endsWith('</svg>')).toBe(true);
      expect(balanced(d.svg)).toBe(true);
      expect(d.svg).not.toMatch(/NaN|undefined/);
      expect(d.svg.length).toBeLessThan(2000);
      const url = assets[builtInAssetId(d.key)];
      expect(url.startsWith('data:image/svg+xml,')).toBe(true);
      expect(decodeURIComponent(url.slice('data:image/svg+xml,'.length))).toBe(d.svg);
    }
    expect(new Set(BUILT_IN_DEVICES.map((d) => d.key)).size).toBe(BUILT_IN_DEVICES.length);
    expect(BUILT_IN_DEVICES.find((d) => d.key === DEFAULT_DEVICE_KEY)?.rules).toEqual([]);
  });

  it('route common platform names to the right element', () => {
    const t = defaultTemplates();
    const pick = (platform: string) => templateForPlatform(t, platform)?.name;
    expect(pick('Nexus 9300')).toBe('Switch');
    expect(pick('N9K-C93180YC-FX')).toBe('Switch');
    expect(pick('N5K-C5548UP')).toBe('Switch');
    expect(pick('cisco WS-C2960X-48FPD-L')).toBe('Switch');
    expect(pick('C9500-24Y4C')).toBe('Switch');
    expect(pick('ISR4451-X/K9')).toBe('Router');
    expect(pick('cisco CISCO2911/K9')).toBe('Router');
    expect(pick('ASR1001-X')).toBe('Router');
    expect(pick('ASA5516')).toBe('Firewall');
    expect(pick('Cisco Firepower 2130')).toBe('Firewall');
    expect(pick('AIR-AP2802I-B-K9')).toBe('Wireless AP');
    // "c91" (Catalyst 9100 access points) is longer than the switches' "c9".
    expect(pick('C9120AXI-B')).toBe('Wireless AP');
    expect(pick('BIG-IP i5800')).toBe('Load balancer');
    expect(pick('UCSC-C220-M5SX')).toBe('Server');
    expect(pick('Juniper MX204')).toBe('Generic device');
    expect(pick('')).toBe('Generic device');
  });

  it('give way to your own elements, even to a shorter rule', () => {
    const t = defaultTemplates();
    expect(t.nodes.every((n) => n.builtIn)).toBe(true);
    // An uploaded picture: not built-in.
    const { builtIn: _, ...base } = t.nodes[0];
    const upload: NodeTemplate = { ...base, id: 'n9300', name: 'Nexus 9300', image: { asset: 'up' }, platforms: ['9300'] };
    t.nodes.push(upload);
    expect(templateForPlatform(t, 'Nexus 9300')?.name).toBe('Nexus 9300'); // "9300" beats the built-in "nexus"
    expect(templateForPlatform(t, 'Nexus 9500')?.name).toBe('Switch');
  });
});
