import { memo } from 'react';
import { cssFont, FONT_FAMILY, measureText } from '../canvas/text';
import type { ArrowHead, Connector, Point } from '../model/types';
import { pointAlong, pointAtDepth, polylineMidpoint, type EndStack } from './routing';

const LABEL_SIZE = 12;
const END_LABEL_SIZE = 11;
/** Distance from a line's end to the near edge of its end label. */
const END_LABEL_GAP = 14;
/** Height of an end label's background patch. */
const END_LABEL_HEIGHT = 16;
/** Extra distance per stacked end label (see `endLabelStacks`). */
const END_LABEL_STEP = 19;
/** How far end labels move off a line that's too short to hold both side by side. */
const END_LABEL_SIDESTEP = 11;

const dashArray = (dash: Connector['style']['dash'], w: number) =>
  dash === 'dashed' ? `${w * 4} ${w * 3}` : dash === 'dotted' ? `0 ${w * 2.5}` : undefined;

/** Arrowhead at `tip`, pointing away from `from`. */
function arrowPath(tip: Point, from: Point, size: number, kind: ArrowHead): string {
  const len = Math.hypot(tip.x - from.x, tip.y - from.y) || 1;
  const ux = (tip.x - from.x) / len;
  const uy = (tip.y - from.y) / len;
  const bx = tip.x - ux * size;
  const by = tip.y - uy * size;
  const px = -uy * size * 0.45;
  const py = ux * size * 0.45;
  const l = `${bx + px} ${by + py}`;
  const r = `${bx - px} ${by - py}`;
  return kind === 'arrow' ? `M${tip.x} ${tip.y}L${l}L${r}Z` : `M${l}L${tip.x} ${tip.y}L${r}`;
}

/** Pulls a line end back so its butt doesn't poke past a filled arrow tip. */
function retract(tip: Point, from: Point, by: number): Point {
  const len = Math.hypot(tip.x - from.x, tip.y - from.y);
  if (len <= by) return tip;
  return { x: tip.x - ((tip.x - from.x) / len) * by, y: tip.y - ((tip.y - from.y) / len) * by };
}

export const ConnectorView = memo(function ConnectorView({
  connector,
  points,
  hideLabel,
  labelStacks,
}: {
  connector: Connector;
  points: Point[];
  hideLabel?: boolean;
  /** Where the start / end label stacks among lines leaving the same side of a shape. */
  labelStacks?: [EndStack | null, EndStack | null];
}) {
  const { style: st, label } = connector;
  const size = 8 + st.strokeWidth * 2;
  const n = points.length;
  const line = [...points];
  if (n >= 2 && st.endArrow === 'arrow') line[n - 1] = retract(points[n - 1], points[n - 2], size * 0.6);
  if (n >= 2 && st.startArrow === 'arrow') line[0] = retract(points[0], points[1], size * 0.6);
  const d = line.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join('');

  const heads: { d: string; kind: ArrowHead }[] = [];
  if (n >= 2 && st.endArrow !== 'none') heads.push({ d: arrowPath(points[n - 1], points[n - 2], size, st.endArrow), kind: st.endArrow });
  if (n >= 2 && st.startArrow !== 'none') heads.push({ d: arrowPath(points[0], points[1], size, st.startArrow), kind: st.startArrow });

  const mid = polylineMidpoint(points);
  const labelW = label ? measureText(label, cssFont(LABEL_SIZE), LABEL_SIZE) + 8 : 0;
  // End labels (e.g. interface names) sit just off each end, along the line, clear of arrowheads.
  const ends = (
    [
      [connector.startLabel, false],
      [connector.endLabel, true],
    ] as const
  ).flatMap(([text, fromEnd]) => {
    if (!text || n < 2) return [];
    const w = measureText(text, cssFont(END_LABEL_SIZE), END_LABEL_SIZE) + 6;
    let reach = END_LABEL_GAP + w / 2;
    let at = pointAlong(points, reach, fromEnd);
    // Lines sharing a side of a shape stack their labels outward from that side, one band per
    // rank, so labels on nearly parallel lines don't land on each other.
    const stack = labelStacks?.[fromEnd ? 1 : 0];
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
    return [{ text, w, reach, fromEnd, at }];
  });
  // On a line too short for both, push the two labels to opposite sides of it.
  if (ends.length === 2 && n >= 2) {
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

  return (
    <g data-hit="connector" data-id={connector.id}>
      <path d={d} fill="none" stroke="transparent" strokeWidth={Math.max(10, st.strokeWidth + 8)} />
      <path
        d={d}
        fill="none"
        stroke={st.stroke}
        strokeWidth={st.strokeWidth}
        strokeDasharray={dashArray(st.dash, st.strokeWidth)}
        strokeLinecap={st.dash === 'dotted' ? 'round' : 'butt'}
        strokeLinejoin="round"
      />
      {heads.map((h, i) => (
        <path
          key={i}
          d={h.d}
          fill={h.kind === 'arrow' ? st.stroke : 'none'}
          stroke={st.stroke}
          strokeWidth={st.strokeWidth}
          strokeLinejoin="round"
        />
      ))}
      {ends.map((e, i) => (
        <g key={i}>
          <rect x={e.at.x - e.w / 2} y={e.at.y - END_LABEL_HEIGHT / 2} width={e.w} height={END_LABEL_HEIGHT} rx={3} fill="#ffffff" />
          <text
            x={e.at.x}
            y={e.at.y}
            fill={st.stroke}
            fontFamily={FONT_FAMILY}
            fontSize={END_LABEL_SIZE}
            textAnchor="middle"
            dominantBaseline="central"
          >
            {e.text}
          </text>
        </g>
      ))}
      {label && !hideLabel && (
        <g>
          <rect x={mid.x - labelW / 2} y={mid.y - 9} width={labelW} height={18} rx={3} fill="#ffffff" />
          <text
            x={mid.x}
            y={mid.y}
            fill={st.stroke}
            fontFamily={FONT_FAMILY}
            fontSize={LABEL_SIZE}
            textAnchor="middle"
            dominantBaseline="central"
          >
            {label}
          </text>
        </g>
      )}
    </g>
  );
});
