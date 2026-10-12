import { memo } from 'react';
import type { Shape } from '../model/types';
import { SHAPES } from '../shapes/library';
import { cssFont, FONT_FAMILY, LINE_HEIGHT, wrapText } from './text';

export const ShapeView = memo(function ShapeView({ shape, hideText }: { shape: Shape; hideText?: boolean }) {
  const def = SHAPES[shape.kind];
  const st = shape.style;
  const box = def.textBox(shape.w, shape.h);
  const lines = hideText ? [] : wrapText(shape.text, box.w, cssFont(st.fontSize, st.bold, st.italic), st.fontSize);
  const lh = st.fontSize * LINE_HEIGHT;
  const firstY = box.y + box.h / 2 - ((lines.length - 1) * lh) / 2;
  const cx = box.x + box.w / 2;

  return (
    <g data-hit="shape" data-id={shape.id} transform={`translate(${shape.x} ${shape.y})`}>
      <path
        d={def.path(shape.w, shape.h)}
        fill={st.fill}
        stroke={st.stroke}
        strokeWidth={st.strokeWidth}
        strokeLinejoin="round"
        pointerEvents="all"
      />
      {lines.length > 0 && (
        <text
          fill={st.textColor}
          fontFamily={FONT_FAMILY}
          fontSize={st.fontSize}
          fontWeight={st.bold ? 'bold' : 'normal'}
          fontStyle={st.italic ? 'italic' : 'normal'}
          textAnchor="middle"
          dominantBaseline="central"
        >
          {lines.map((line, i) => (
            <tspan key={i} x={cx} y={firstY + i * lh}>
              {line}
            </tspan>
          ))}
        </text>
      )}
    </g>
  );
});
