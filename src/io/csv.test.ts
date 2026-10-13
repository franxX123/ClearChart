import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';

describe('parseCsv', () => {
  it('reads a header row and keys rows by lower-cased header', () => {
    const t = parseCsv('hostName, Neighbor Name\nsw1,sw2\n');
    expect(t.headers).toEqual(['hostName', 'Neighbor Name']);
    expect(t.rows).toEqual([{ hostname: 'sw1', 'neighbor name': 'sw2' }]);
    expect(t.lines).toEqual([2]);
  });

  it('handles quotes, escaped quotes, commas and newlines inside quotes', () => {
    const t = parseCsv('a,b,c\n"x, y","say ""hi""","two\nlines"\n');
    expect(t.rows).toEqual([{ a: 'x, y', b: 'say "hi"', c: 'two\nlines' }]);
  });

  it('handles CRLF, a BOM, blank lines and short rows', () => {
    const t = parseCsv('﻿a,b\r\n1,2\r\n\r\n3\r\n');
    expect(t.headers).toEqual(['a', 'b']);
    expect(t.rows).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '' },
    ]);
    expect(t.lines).toEqual([2, 4]);
  });

  it('counts lines inside quoted newlines for later rows', () => {
    const t = parseCsv('a\n"1\n2"\nx');
    expect(t.lines).toEqual([2, 4]);
  });

  it('returns nothing for empty input', () => {
    expect(parseCsv('')).toEqual({ headers: [], rows: [], lines: [] });
  });
});
