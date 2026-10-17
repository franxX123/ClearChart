import { describe, expect, it } from 'vitest';
import { wheelPan, wheelZoomFactor } from './wheel';

const wheel = (deltaY: number, more: Partial<Parameters<typeof wheelZoomFactor>[0]> = {}) => ({
  deltaX: 0,
  deltaY,
  deltaMode: 0,
  ctrlKey: false,
  ...more,
});

describe('wheel zoom', () => {
  it('zooms in when scrolling up and out when scrolling down, by a small step per notch', () => {
    expect(wheelZoomFactor(wheel(-100))).toBeCloseTo(1.15);
    expect(wheelZoomFactor(wheel(100))).toBeCloseTo(1 / 1.15);
  });

  it('treats line and page deltas like pixel ones', () => {
    // Firefox reports 3 lines per notch.
    expect(wheelZoomFactor(wheel(-3, { deltaMode: 1 }))).toBeCloseTo(wheelZoomFactor(wheel(-48)));
    expect(wheelZoomFactor(wheel(1, { deltaMode: 2 }))).toBeCloseTo(wheelZoomFactor(wheel(120)));
  });

  it('caps big jumps', () => {
    expect(wheelZoomFactor(wheel(-1000))).toBeCloseTo(wheelZoomFactor(wheel(-120)));
  });

  it('zooms faster per pixel for a trackpad pinch than for a wheel', () => {
    const pinch = wheelZoomFactor(wheel(-10, { ctrlKey: true }));
    expect(pinch).toBeGreaterThan(wheelZoomFactor(wheel(-10)));
    expect(pinch).toBeCloseTo(Math.exp(0.1));
    // Ctrl + a real mouse wheel notch zooms like the plain wheel.
    expect(wheelZoomFactor(wheel(-100, { ctrlKey: true }))).toBeCloseTo(1.15);
  });
});

describe('shift+wheel pan', () => {
  it('pans horizontally whichever axis the browser reports', () => {
    expect(wheelPan(wheel(100))).toEqual({ dx: 100, dy: 0 });
    expect(wheelPan({ ...wheel(0), deltaX: -50 })).toEqual({ dx: -50, dy: 0 });
  });

  it('pans freely for a two-axis trackpad scroll', () => {
    expect(wheelPan({ ...wheel(20), deltaX: 5 })).toEqual({ dx: 5, dy: 20 });
  });
});
