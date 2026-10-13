import { memo } from 'react';
import type { Shape } from '../model/types';
import { SHAPES } from '../shapes/library';
import { cssFont, FONT_FAMILY, LINE_HEIGHT, wrapText } from './text';

/**
 * The lines `text` is drawn as in `shape`: one per `\n` for auto-sized boxes (they're fitted
 * to it), otherwise word-wrapped to the shape's text box.
 */
export function textLines(shape: Shape, text: string): string[] {
  const st = shape.style;
  if (shape.autoSize) return text.split('\n');
  const box = SHAPES[shape.kind].textBox(shape.w, shape.h);
  return wrapText(text, box.w, cssFont(st.fontSize, st.bold, st.italic), st.fontSize);
}

/** SVG transform placing a shape: translate to its corner, then rotate about its center. */
export const shapeTransform = (s: Shape) =>
  `translate(${s.x} ${s.y})${s.rotation ? ` rotate(${s.rotation} ${s.w / 2} ${s.h / 2})` : ''}`;

export const ShapeView = memo(function ShapeView({
  shape,
  hideText,
  locked,
}: {
  shape: Shape;
  hideText?: boolean;
  /** On a locked layer: drawn, but not hit-testable (inherits pointer-events="none"). */
  locked?: boolean;
}) {
  const def = SHAPES[shape.kind];
  const st = shape.style;
  const opacity = st.opacity != null && st.opacity < 1 ? st.opacity : undefined;

  if (shape.kind === 'image') {
    // The picture, then its (optional) border on top; the border path also takes the clicks.
    return (
      <g data-hit="shape" data-id={shape.id} transform={shapeTransform(shape)} opacity={opacity}>
        {shape.image && (
          <image href={shape.image.src} width={shape.w} height={shape.h} preserveAspectRatio="none" />
        )}
        <path
          d={def.path(shape.w, shape.h)}
          fill="none"
          stroke={st.stroke}
          strokeWidth={st.strokeWidth}
          pointerEvents={locked ? undefined : 'all'}
        />
      </g>
    );
  }

  const box = def.textBox(shape.w, shape.h);
  const lines = hideText || !shape.text ? [] : textLines(shape, shape.text);
  const lh = st.fontSize * LINE_HEIGHT;
  const firstY = box.y + box.h / 2 - ((lines.length - 1) * lh) / 2;
  const left = st.textAlign === 'left';
  const tx = left ? box.x : box.x + box.w / 2;

  return (
    <g data-hit="shape" data-id={shape.id} transform={shapeTransform(shape)} opacity={opacity}>
      <path
        d={def.path(shape.w, shape.h)}
        fill={st.fill}
        stroke={st.stroke}
        strokeWidth={st.strokeWidth}
        strokeLinejoin="round"
        pointerEvents={locked ? undefined : 'all'}
      />
      {lines.length > 0 && (
        <text
          fill={st.textColor}
          fontFamily={FONT_FAMILY}
          fontSize={st.fontSize}
          fontWeight={st.bold ? 'bold' : 'normal'}
          fontStyle={st.italic ? 'italic' : 'normal'}
          textAnchor={left ? 'start' : 'middle'}
          dominantBaseline="central"
          // Auto-sized boxes keep the spaces you typed, as the editor showed them.
          xmlSpace={shape.autoSize ? 'preserve' : undefined}
        >
          {lines.map((line, i) => (
            <tspan key={i} x={tx} y={firstY + i * lh}>
              {line}
            </tspan>
          ))}
        </text>
      )}
    </g>
  );
});
