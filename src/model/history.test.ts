import { describe, expect, it } from 'vitest';
import { emptyDoc } from './doc';
import { abortBatch, beginBatch, change, emptyHistory, endBatch, redo, undo } from './history';

const setTitle = (t: string) => (d: { title: string }) => {
  d.title = t;
};

describe('history', () => {
  it('undoes and redoes a change', () => {
    let [doc, h] = change(emptyDoc(), emptyHistory(), setTitle('A'));
    expect(doc.title).toBe('A');
    [doc, h] = undo(doc, h);
    expect(doc.title).toBe('Untitled diagram');
    [doc, h] = redo(doc, h);
    expect(doc.title).toBe('A');
    expect(h.past).toHaveLength(1);
  });

  it('ignores no-op changes', () => {
    const doc = emptyDoc();
    const [next, h] = change(doc, emptyHistory(), () => {});
    expect(next).toBe(doc);
    expect(h.past).toHaveLength(0);
  });

  it('collapses a batch into one undo step', () => {
    let doc = emptyDoc();
    let h = beginBatch(emptyHistory());
    for (const t of ['A', 'B', 'C']) [doc, h] = change(doc, h, setTitle(t));
    h = endBatch(h);
    expect(h.past).toHaveLength(1);
    [doc, h] = undo(doc, h);
    expect(doc.title).toBe('Untitled diagram');
  });

  it('aborting a batch reverts its edits without an undo entry', () => {
    let doc = emptyDoc();
    let h = beginBatch(emptyHistory());
    [doc, h] = change(doc, h, setTitle('A'));
    [doc, h] = change(doc, h, setTitle('B'));
    [doc, h] = abortBatch(doc, h);
    expect(doc.title).toBe('Untitled diagram');
    expect(h.past).toHaveLength(0);
    expect(h.batch).toBeNull();
  });

  it('merges edits with the same key inside the time window', () => {
    let doc = emptyDoc();
    let h = emptyHistory();
    [doc, h] = change(doc, h, setTitle('A'), 'title', 1000);
    [doc, h] = change(doc, h, setTitle('AB'), 'title', 1500);
    expect(h.past).toHaveLength(1);
    [doc, h] = change(doc, h, setTitle('ABC'), 'title', 5000);
    expect(h.past).toHaveLength(2);
    [doc, h] = undo(doc, h);
    [doc, h] = undo(doc, h);
    expect(doc.title).toBe('Untitled diagram');
  });

  it('a new change clears the redo stack', () => {
    let [doc, h] = change(emptyDoc(), emptyHistory(), setTitle('A'));
    [doc, h] = undo(doc, h);
    [doc, h] = change(doc, h, setTitle('B'));
    expect(h.future).toHaveLength(0);
    expect(doc.title).toBe('B');
  });
});
