import { cssFont, measureText } from '../canvas/text';
import type { Connector, Point } from '../model/types';
import { pointAlong, pointAtDepth, polylineMidpoint, type EndStack } from './routing';

// Where a line's labels go. Shared by the canvas (ConnectorView) and the Visio export, so
// both put labels in the same places. Pure.

export const LABEL_SIZE = 12;
export const LABEL_HEIGHT = 18;
export const END_LABEL_SIZE = 11;
export const END_LABEL_HEIGHT = 16;
/** Distance from a line's end to the near edge of its end label. */
const END_LABEL_GAP = 14;
/** Extra distance per stacked end label (see `endLabelStacks`). */
const END_LABEL_STEP = 19;
/** How far end labels move off a line that's too short to hold both side by side. */
const END_LABEL_SIDESTEP = 11;

export interface PlacedLabel {
  text: string;
  /** Center of the label. */
  at: Point;
  /** Size of its background patch. */
  w: number;
  h: number;
}

/** The middle label, centered halfway along the line; null without a label. */
export function middleLabel(c: Connector, points: Point[]): PlacedLabel | null {
  if (!c.label) return null;
  return {
    text: c.label,
    at: polylineMidpoint(points),
    w: measureText(c.label, cssFont(LABEL_SIZE), LABEL_SIZE) + 8,
    h: LABEL_HEIGHT,
  };
}

/**
 * The start and end labels (e.g. interface names), just off each end along the line. Lines
 * sharing a side of a shape (`stacks`, from `endLabelStacks`) stack their labels outward from
 * that side, one band per rank; on a line too short for both, they go on opposite sides of it.
 */
export function endLabels(c: Connector, points: Point[], stacks?: [EndStack | null, EndStack | null]): PlacedLabel[] {
  const n = points.length;
  if (n < 2) return [];
  const ends = (
    [
      [c.startLabel, false],
      [c.endLabel, true],
    ] as const
  ).flatMap(([text, fromEnd]) => {
    if (!text) return [];
    const w = measureText(text, cssFont(END_LABEL_SIZE), END_LABEL_SIZE) + 6;
    let reach = END_LABEL_GAP + w / 2;
    let at = pointAlong(points, reach, fromEnd);
    const stack = stacks?.[fromEnd ? 1 : 0];
    if (stack) {
      const half = stack.dir.y !== 0 ? END_LABEL_HEIGHT / 2 : w / 2;
      const depth = END_LABEL_GAP + stack.rank * END_LABEL_STEP + half;
      const hit = pointAtDepth(points, stack.dir, depth, fromEnd);
      // A line that runs nearly along the side would put its label far away; keep the plain spot.
      if (hit && hit.walked <= depth * 3) {
        at = hit.p;
        reach = hit.walked;
      }
    }
    return [{ text, w, h: END_LABEL_HEIGHT, at, reach }];
  });
  if (ends.length === 2) {
    const length = points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - points[i].x, p.y - points[i].y), 0);
    if (ends[0].reach + ends[0].w / 2 + ends[1].reach + ends[1].w / 2 > length) {
      const dx = points[n - 1].x - points[0].x;
      const dy = points[n - 1].y - points[0].y;
      const len = Math.hypot(dx, dy) || 1;
      const normal = { x: -dy / len, y: dx / len };
      ends.forEach((e, i) => {
        const s = (i === 0 ? 1 : -1) * END_LABEL_SIDESTEP;
        e.at = { x: e.at.x + normal.x * s, y: e.at.y + normal.y * s };
      });
    }
  }
  return ends.map(({ text, w, h, at }) => ({ text, w, h, at }));
}
