import { memo } from 'react';
import type { Shape } from '../model/types';
import { SHAPES } from '../shapes/library';
import { cssFont, FONT_FAMILY, LINE_HEIGHT, wrapText } from './text';
import { SIDE_PAD, sideLabelBox } from './transform';

/**
 * The lines `text` is drawn as in `shape`: one per `\n` for auto-sized boxes (they're fitted
 * to it) and text beside a shape, otherwise word-wrapped to the shape's text box.
 */
export function textLines(shape: Shape, text: string): string[] {
  const st = shape.style;
  if (shape.autoSize || shape.textPosition === 'right') return text.split('\n');
  const box = SHAPES[shape.kind].textBox(shape.w, shape.h);
  return wrapText(text, box.w, cssFont(st.fontSize, st.bold, st.italic), st.fontSize);
}

/** SVG transform placing a shape: translate to its corner, then rotate about its center. */
export const shapeTransform = (s: Shape) =>
  `translate(${s.x} ${s.y})${s.rotation ? ` rotate(${s.rotation} ${s.w / 2} ${s.h / 2})` : ''}`;

/**
 * Text drawn to the right of a shape (`textPosition: 'right'`), left-aligned and vertically
 * centered on it. Clicking it selects the shape (it's inside the shape's group); arrows attach
 * to it as part of the shape (see `attachFrame`).
 */
function SideText({ shape, locked }: { shape: Shape; locked?: boolean }) {
  const box = sideLabelBox(shape);
  if (!box) return null;
  const st = shape.style;
  const lh = st.fontSize * LINE_HEIGHT;
  return (
    <g>
      {/* Takes clicks on the text and the gap before it. */}
      <rect
        x={shape.w}
        y={box.y}
        width={box.x + box.w - shape.w}
        height={box.h}
        fill="none"
        pointerEvents={locked ? undefined : 'all'}
      />
      <text
        fill={st.textColor}
        fontFamily={FONT_FAMILY}
        fontSize={st.fontSize}
        fontWeight={st.bold ? 'bold' : 'normal'}
        fontStyle={st.italic ? 'italic' : 'normal'}
        textAnchor="start"
        dominantBaseline="central"
      >
        {shape.text.split('\n').map((line, i) => (
          <tspan key={i} x={box.x + SIDE_PAD} y={box.y + lh / 2 + i * lh}>
            {line}
          </tspan>
        ))}
      </text>
    </g>
  );
}

export const ShapeView = memo(function ShapeView({
  shape,
  hideText,
  locked,
  imageSrc,
}: {
  shape: Shape;
  hideText?: boolean;
  /** On a locked layer: drawn, but not hit-testable (inherits pointer-events="none"). */
  locked?: boolean;
  /** The picture to show for an image shape (resolved from `Doc.assets` by the canvas). */
  imageSrc?: string;
}) {
  const def = SHAPES[shape.kind];
  const st = shape.style;
  const opacity = st.opacity != null && st.opacity < 1 ? st.opacity : undefined;
  const beside = shape.textPosition === 'right';

  if (shape.kind === 'image') {
    const src = imageSrc ?? shape.image?.src;
    // The picture, then its (optional) border on top; the border path also takes the clicks.
    return (
      <g data-hit="shape" data-id={shape.id} transform={shapeTransform(shape)} opacity={opacity}>
        {src && <image href={src} width={shape.w} height={shape.h} preserveAspectRatio="none" />}
        <path
          d={def.path(shape.w, shape.h)}
          fill="none"
          stroke={st.stroke}
          strokeWidth={st.strokeWidth}
          pointerEvents={locked ? undefined : 'all'}
        />
        {beside && !hideText && <SideText shape={shape} locked={locked} />}
      </g>
    );
  }

  const box = def.textBox(shape.w, shape.h);
  const lines = hideText || beside || !shape.text ? [] : textLines(shape, shape.text);
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
      {beside && !hideText && <SideText shape={shape} locked={locked} />}
    </g>
  );
});
