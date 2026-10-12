import { describe, expect, it } from 'vitest';
import { sampleDoc } from '../model/doc';
import { parseDoc, serializeDoc } from './persist';

describe('document files', () => {
  it('round-trips a document', () => {
    const doc = sampleDoc();
    expect(parseDoc(serializeDoc(doc))).toEqual(doc);
  });

  it('rejects files that are not ClearChart documents', () => {
    expect(() => parseDoc('{"hello":1}')).toThrow('Not a ClearChart document');
    expect(() => parseDoc('not json')).toThrow();
    expect(() =>
      parseDoc(JSON.stringify({ version: 1, items: {}, order: ['missing'] })),
    ).toThrow('Invalid item');
  });
});
