import { describe, expect, it } from 'vitest';
import { fitWithin } from './image';

describe('fitWithin', () => {
  it('scales the longer side down to the limit, keeping proportions', () => {
    expect(fitWithin(4000, 3000, 2000)).toEqual({ w: 2000, h: 1500 });
    expect(fitWithin(1000, 5000, 400)).toEqual({ w: 80, h: 400 });
  });

  it('never scales up and never returns a zero side', () => {
    expect(fitWithin(300, 200, 2000)).toEqual({ w: 300, h: 200 });
    expect(fitWithin(5000, 1, 400)).toEqual({ w: 400, h: 1 });
  });
});
