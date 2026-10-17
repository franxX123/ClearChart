import { memo } from 'react';
import { opacityAttr } from '../canvas/ShapeView';
import { cssFont, FONT_FAMILY, measureText } from '../canvas/text';
import type { ArrowHead, Connector, Point, Rect } from '../model/types';
import { pointAlong, polylineMidpoint } from './routing';

const LABEL_SIZE = 12;
const END_LABEL_SIZE = 10;

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

const inside = (p: Point, r: Rect) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;

/**
 * Places a label of `w`×`h` along the line, `fromEnd` or from the start, rotated to run with
 * the line (kept upright). Labels on lines that fan out from one shape then sit on their own
 * lines instead of piling up. Slides outward until it clears `shape`, but stays in its own
 * half of the line so the labels at the two ends of a short line don't collide.
 */
function endLabelPlacement(points: Point[], w: number, h: number, fromEnd: boolean, shape: Rect | undefined) {
  const pad = shape && { x: shape.x - 2, y: shape.y - 2, w: shape.w + 4, h: shape.h + 4 };
  const length = points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - points[i].x, p.y - points[i].y), 0);
  const maxD = Math.max(0, length / 2 - w / 2 - 2);
  let d = Math.min(w / 2 + 5, maxD);
  for (;;) {
    const { p, dir } = pointAlong(points, d, fromEnd);
    const nx = -dir.y;
    const ny = dir.x;
    const corners = [-1, 1].flatMap((a) =>
      [-1, 1].map((b) => ({ x: p.x + (dir.x * w * a + nx * h * b) / 2, y: p.y + (dir.y * w * a + ny * h * b) / 2 })),
    );
    if (!pad || d >= Math.min(120, maxD) || !corners.some((c) => inside(c, pad))) {
      let angle = (Math.atan2(dir.y, dir.x) * 180) / Math.PI;
      if (angle > 90) angle -= 180;
      else if (angle < -90) angle += 180;
      return { p, angle };
    }
    d += 3;
  }
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
  endShapes,
}: {
  connector: Connector;
  points: Point[];
  hideLabel?: boolean;
  /** Boxes of the shapes each end is attached to, which end labels keep clear of. */
  endShapes?: [Rect | undefined, Rect | undefined];
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
  const ends = [
    { text: connector.sourceLabel, fromEnd: false, shape: endShapes?.[0] },
    { text: connector.targetLabel, fromEnd: true, shape: endShapes?.[1] },
  ].flatMap(({ text, fromEnd, shape }) => {
    if (!text || n < 2) return [];
    const w = measureText(text, cssFont(END_LABEL_SIZE), END_LABEL_SIZE) + 6;
    const h = END_LABEL_SIZE + 4;
    return [{ text, w, h, ...endLabelPlacement(points, w, h, fromEnd, shape) }];
  });

  return (
    <g data-hit="connector" data-id={connector.id} opacity={opacityAttr(st.opacity)}>
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
      {ends.map((e, i) => (
        <g key={i} transform={`translate(${e.p.x} ${e.p.y}) rotate(${e.angle})`}>
          <rect x={-e.w / 2} y={-e.h / 2} width={e.w} height={e.h} rx={2} fill="#ffffff" />
          <text
            x={0}
            y={0}
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
    </g>
  );
});
