import { describe, expect, it } from 'vitest';
import { parseCsv } from '../io/csv';
import { buildGraph } from './links';

const HEAD = 'hostName,hostInterface,hostIP,hostPlatform,neighborName,neighborInterface,neighborIP,neighborPlatform';
const graph = (...rows: string[]) => buildGraph(parseCsv([HEAD, ...rows].join('\n')));

describe('buildGraph', () => {
  it('dedupes devices by name, case-insensitively, keeping the first non-empty fields', () => {
    const g = graph('SW1,Gi0/1,10.0.0.1,,sw2,Gi0/2,,C9300', 'sw1,Gi0/3,10.9.9.9,C9500,SW3,Gi0/1,,');
    expect(g.nodes.size).toBe(3);
    expect(g.nodes.get('sw1')).toEqual({ hostName: 'SW1', hostIP: '10.0.0.1', hostPlatform: 'C9500' });
    // sw2 only ever appears as the neighbor; its neighbor* values use the host* field names.
    expect(g.nodes.get('sw2')).toEqual({ hostName: 'sw2', hostPlatform: 'C9300' });
    expect(g.links).toHaveLength(2);
  });

  it('merges a link reported from both sides, keeping the first orientation', () => {
    const g = graph('A,Gi0/1,,,B,Gi0/2,,', 'b,gi0/2,,,a,GI0/1,,');
    expect(g.links).toHaveLength(1);
    expect(g.merged).toBe(1);
    expect(g.links[0]).toMatchObject({ host: 'a', neighbor: 'b', data: { hostInterface: 'Gi0/1', neighborInterface: 'Gi0/2' } });
  });

  it('keeps separate links between the same devices on different interfaces', () => {
    const g = graph('A,Gi0/1,,,B,Gi0/1,,', 'A,Gi0/2,,,B,Gi0/2,,');
    expect(g.links).toHaveLength(2);
    expect(g.merged).toBe(0);
  });

  it('fills a merged link interface missing in the first row from the reciprocal one', () => {
    const g = graph('A,Gi0/1,,,B,,,', 'B,,,,A,Gi0/1,,');
    expect(g.links).toHaveLength(1);
    expect(g.links[0].data).toEqual({ hostInterface: 'Gi0/1' });
  });

  it('skips rows without both names, and self-links, with their line numbers', () => {
    const g = graph('A,Gi0/1,,,,,,', ',,,,B,,,', 'C,Gi1,,,c,Gi2,,', 'A,,,,B,,,');
    expect(g.skipped).toEqual([
      { line: 2, reason: 'missing neighborName' },
      { line: 3, reason: 'missing hostName' },
      { line: 4, reason: '"C" is linked to itself' },
    ]);
    expect(g.links).toHaveLength(1);
  });

  it('keeps extra columns as link data and only requires the two name columns', () => {
    const g = buildGraph(parseCsv('NeighborName,HOSTNAME,speed,vlan\nB,A,10G,\nA,B,,20'));
    expect(g.links).toHaveLength(1);
    expect(g.links[0].data).toEqual({ speed: '10G', vlan: '20' });
  });

  it('reports missing required columns', () => {
    expect(() => buildGraph(parseCsv('hostName,neighbor\nA,B'))).toThrow('Missing column: neighborName');
  });
});
