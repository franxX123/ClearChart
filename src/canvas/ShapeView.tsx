import { memo } from 'react';
import type { NodeComponent, Part, Shape } from '../model/types';
import { SHAPES } from '../shapes/library';
import { fillPlaceholders, placePart } from '../templates/rules';
import { cssFont, FONT_FAMILY, LINE_HEIGHT, wrapText } from './text';

/** An opacity style value as an SVG attribute: clamped to 0–1, omitted when fully opaque. */
export const opacityAttr = (v: number | undefined) => (v == null || v >= 1 ? undefined : Math.max(0, v));

/** Draws a shape or component part in its local coordinates, (0,0)–(w,h). */
function PartBody({ part, text, hit }: { part: Part; text: string; hit?: boolean }) {
  const def = SHAPES[part.kind] ?? SHAPES.rect;
  const st = part.style;
  const box = def.textBox(part.w, part.h);
  const lines = part.kind === 'image' ? [] : wrapText(text, box.w, cssFont(st.fontSize, st.bold, st.italic), st.fontSize);
  const lh = st.fontSize * LINE_HEIGHT;
  const firstY = box.y + box.h / 2 - ((lines.length - 1) * lh) / 2;
  const cx = box.x + box.w / 2;

  return (
    <>
      <path
        d={def.path(part.w, part.h)}
        fill={st.fill}
        fillOpacity={opacityAttr(st.fillOpacity)}
        stroke={st.stroke}
        strokeWidth={st.strokeWidth}
        strokeLinejoin="round"
        pointerEvents={hit ? 'all' : undefined}
      />
      {part.kind === 'image' && part.src && (
        <image href={part.src} width={part.w} height={part.h} preserveAspectRatio="xMidYMid meet" />
      )}
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
    </>
  );
}

/**
 * A component's parts, stretched to `w`×`h`. Part boxes scale; stroke widths and font sizes
 * don't, so text stays readable when a component is resized.
 */
export function ComponentParts({ component, w, h, data }: { component: NodeComponent; w: number; h: number; data?: Record<string, string> }) {
  const sx = w / component.w;
  const sy = h / component.h;
  return component.parts.map((p, i) => {
    const part = placePart(p, 0, 0, sx, sy);
    return (
      <g key={i} transform={`translate(${part.x} ${part.y})`} opacity={opacityAttr(part.style.opacity)}>
        <PartBody part={part} text={fillPlaceholders(part.text, data)} />
      </g>
    );
  });
}

export const ShapeView = memo(function ShapeView({
  shape,
  component,
  hideText,
}: {
  shape: Shape;
  /** Definition for a `component` shape, from `doc.components`. */
  component?: NodeComponent;
  hideText?: boolean;
}) {
  if (shape.kind === 'component') {
    return (
      <g
        data-hit="shape"
        data-id={shape.id}
        transform={`translate(${shape.x} ${shape.y})`}
        opacity={opacityAttr(shape.style.opacity)}
      >
        {component ? (
          <>
            <rect width={shape.w} height={shape.h} fill="none" pointerEvents="all" />
            <ComponentParts component={component} w={shape.w} h={shape.h} data={shape.data} />
          </>
        ) : (
          // Definition missing (e.g. pasted from another diagram): show a placeholder box.
          <rect width={shape.w} height={shape.h} fill="#f6f7f9" stroke="#9aa3ad" strokeDasharray="4 3" pointerEvents="all" />
        )}
      </g>
    );
  }
  return (
    <g
      data-hit="shape"
      data-id={shape.id}
      transform={`translate(${shape.x} ${shape.y})`}
      opacity={opacityAttr(shape.style.opacity)}
    >
      <PartBody part={shape} text={hideText ? '' : shape.text} hit />
    </g>
  );
});
