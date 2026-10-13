// A small RFC 4180 CSV parser: quoted fields, "" escapes, commas and newlines inside quotes,
// CRLF or LF line ends, a leading BOM. Pure, no DOM.

export interface CsvTable {
  /** Header names as written in the file (trimmed). */
  headers: string[];
  /** One object per data row, keyed by lower-cased header. Missing cells are ''. */
  rows: Record<string, string>[];
  /** 1-based line number in the file where each row starts (for error messages). */
  lines: number[];
}

/** Splits CSV text into records of raw fields, with the line each record starts on. */
function records(text: string): { fields: string[]; line: number }[] {
  const out: { fields: string[]; line: number }[] = [];
  let fields: string[] = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let start = 1;
  let i = 0;
  const endRecord = () => {
    fields.push(field);
    // Skip blank lines (a single empty field).
    if (fields.length > 1 || fields[0] !== '') out.push({ fields, line: start });
    fields = [];
    field = '';
  };
  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
      i++;
      continue;
    }
    if (ch === '"' && field === '') {
      quoted = true;
    } else if (ch === ',') {
      fields.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRecord();
      line++;
      start = line;
    } else {
      field += ch;
    }
    i++;
  }
  if (field !== '' || fields.length > 0) endRecord();
  return out;
}

/** Parses CSV text whose first record is a header row. */
export function parseCsv(text: string): CsvTable {
  const recs = records(text.replace(/^﻿/, ''));
  if (recs.length === 0) return { headers: [], rows: [], lines: [] };
  const headers = recs[0].fields.map((h) => h.trim());
  const keys = headers.map((h) => h.toLowerCase());
  const data = recs.slice(1);
  return {
    headers,
    rows: data.map(({ fields }) => Object.fromEntries(keys.map((k, c) => [k, (fields[c] ?? '').trim()]))),
    lines: data.map((r) => r.line),
  };
}
