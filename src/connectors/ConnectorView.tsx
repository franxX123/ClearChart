import { memo } from 'react';
import { cssFont, FONT_FAMILY, measureText } from '../canvas/text';
import type { ArrowHead, Connector, Point } from '../model/types';
import { polylineMidpoint } from './routing';

const LABEL_SIZE = 12;

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
}: {
  connector: Connector;
  points: Point[];
  hideLabel?: boolean;
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
