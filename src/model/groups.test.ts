import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { addItems, emptyDoc, makeShape } from './doc';
import {
  applyGroup,
  applyUngroup,
  expandToGroups,
  groupUnits,
  hasGroup,
  remapGroups,
  topGroup,
  wholeGroupsOnly,
} from './groups';
import type { Doc, Shape } from './types';

/** Doc with shapes a..e; `groups` maps a shape name to its group list. */
function docWith(groups: Record<string, string[]> = {}): { doc: Doc; ids: Record<string, string> } {
  const doc = emptyDoc();
  const ids: Record<string, string> = {};
  for (const name of ['a', 'b', 'c', 'd', 'e']) {
    const s = makeShape('rect', { x: 0, y: 0, w: 10, h: 10 }, name);
    if (groups[name]) s.groups = groups[name];
    ids[name] = s.id;
    addItems(doc, [s]);
  }
  return { doc, ids };
}

const names = (doc: Doc, ids: string[]) => ids.map((id) => (doc.items[id] as Shape).text);

describe('selecting groups', () => {
  it('expands a pick to its outermost group, in z-order', () => {
    const { doc, ids } = docWith({ a: ['g1', 'g2'], b: ['g1', 'g2'], c: ['g2'], d: ['g3'] });
    expect(names(doc, expandToGroups(doc, [ids.b]))).toEqual(['a', 'b', 'c']);
    expect(names(doc, expandToGroups(doc, [ids.e, ids.d]))).toEqual(['d', 'e']);
  });

  it('marquee keeps a group only when all of it is inside', () => {
    const { doc, ids } = docWith({ a: ['g1'], b: ['g1'], c: ['g2'], d: ['g2'] });
    expect(names(doc, wholeGroupsOnly(doc, [ids.a, ids.c, ids.d, ids.e]))).toEqual(['c', 'd', 'e']);
  });

  it('counts groups and loose items as units', () => {
    const { doc, ids } = docWith({ a: ['g1'], b: ['g1'] });
    expect(groupUnits(doc, [ids.a, ids.b])).toBe(1);
    expect(groupUnits(doc, [ids.a, ids.b, ids.c])).toBe(2);
    expect(hasGroup(doc, [ids.c])).toBe(false);
    expect(hasGroup(doc, [ids.c, ids.a])).toBe(true);
  });
});

describe('grouping and ungrouping', () => {
  it('nests a group inside a new one, and ungroup removes one level', () => {
    const { doc, ids } = docWith({ a: ['g1'], b: ['g1'] });
    const grouped = produce(doc, (d) => applyGroup(d, expandToGroups(d, [ids.a, ids.c]), 'g2'));
    expect(grouped.items[ids.a].groups).toEqual(['g1', 'g2']);
    expect(grouped.items[ids.b].groups).toEqual(['g1', 'g2']);
    expect(grouped.items[ids.c].groups).toEqual(['g2']);
    expect(names(grouped, expandToGroups(grouped, [ids.c]))).toEqual(['a', 'b', 'c']);

    // Ungrouping from a single member peels the outer group off every member.
    const ungrouped = produce(grouped, (d) => applyUngroup(d, [ids.c]));
    expect(ungrouped.items[ids.a].groups).toEqual(['g1']);
    expect(ungrouped.items[ids.c]).not.toHaveProperty('groups');
    expect(names(ungrouped, expandToGroups(ungrouped, [ids.a]))).toEqual(['a', 'b']);
  });

  it('expanding first keeps a partly picked group whole', () => {
    const { doc, ids } = docWith({ a: ['g1'], b: ['g1'] });
    const grouped = produce(doc, (d) => applyGroup(d, expandToGroups(d, [ids.a, ids.c]), 'g2'));
    expect(topGroup(grouped.items[ids.b])).toBe('g2');
  });
});

describe('copying groups', () => {
  it('gives copies new ids, shared the same way, and drops groups left with one member', () => {
    const { doc, ids } = docWith({ a: ['g1', 'g2'], b: ['g1', 'g2'], c: ['g2'], d: ['g3'] });
    const copies = [ids.a, ids.b, ids.c, ids.d].map((id) => structuredClone(doc.items[id]));
    remapGroups(copies);
    const [a, b, c, d] = copies;
    expect(a.groups).toHaveLength(2);
    expect(a.groups).toEqual(b.groups);
    expect(c.groups).toEqual([a.groups![1]]);
    expect(a.groups).not.toContain('g1');
    expect(a.groups).not.toContain('g2');
    expect(d).not.toHaveProperty('groups');
  });
});
