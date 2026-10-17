/** The parts of a WheelEvent the canvas uses. */
export interface WheelInput {
  deltaX: number;
  deltaY: number;
  /** 0 = pixels, 1 = lines, 2 = pages (`WheelEvent.DOM_DELTA_*`). */
  deltaMode: number;
  ctrlKey: boolean;
}

const LINE_PX = 16;
const PAGE_PX = 800;
/** One mouse-wheel notch is about 100 px; cap bigger jumps so a fast flick doesn't leap. */
const MAX_STEP_PX = 120;
/** ≈1.15× per 100 px notch. */
const WHEEL_RATE = Math.log(1.15) / 100;
/** Trackpad pinch arrives as ctrl+wheel with small deltas, many per gesture. */
const PINCH_RATE = 0.01;

const toPixels = (delta: number, mode: number) => delta * (mode === 1 ? LINE_PX : mode === 2 ? PAGE_PX : 1);

/** Zoom factor for one wheel event: > 1 zooms in (scrolling up), < 1 zooms out. */
export function wheelZoomFactor(e: WheelInput): number {
  const dy = toPixels(e.deltaY, e.deltaMode);
  const pinch = e.ctrlKey && e.deltaMode === 0 && Math.abs(dy) < 50;
  const step = Math.max(-MAX_STEP_PX, Math.min(MAX_STEP_PX, dy));
  return Math.exp(-step * (pinch ? PINCH_RATE : WHEEL_RATE));
}

/**
 * Screen-pixel pan for Shift+wheel. Browsers report a shifted mouse wheel as deltaX or as
 * deltaY depending on platform, so a single-axis delta always pans horizontally; a trackpad
 * (both axes at once) pans freely.
 */
export function wheelPan(e: WheelInput): { dx: number; dy: number } {
  const x = toPixels(e.deltaX, e.deltaMode);
  const y = toPixels(e.deltaY, e.deltaMode);
  return x !== 0 && y !== 0 ? { dx: x, dy: y } : { dx: x || y, dy: 0 };
}
