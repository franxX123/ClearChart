import { describe, expect, it } from 'vitest';
import { fitText } from './text';

// No DOM in tests: measureText falls back to 0.55 × fontSize per character.
const style = { fontSize: 14, bold: false, italic: false };

describe('fitText', () => {
  it('fits the widest line plus padding and caret room, one line height per line', () => {
    // "there" = 5 × 7.7 = 38.5 px wide; + 2 × 2 padding + 2 caret slack.
    expect(fitText('Hi\nthere', style)).toEqual({ w: 45, h: 39 });
  });

  it('keeps blank lines and spaces', () => {
    expect(fitText('a\n\n', style).h).toBe(Math.ceil(3 * 14 * 1.25 + 4));
    expect(fitText('a  b', style).w).toBeGreaterThan(fitText('ab', style).w);
  });

  it('leaves room for the caret when empty', () => {
    expect(fitText('', style)).toEqual({ w: 15, h: 22 });
  });
});
