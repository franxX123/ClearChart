import { useEffect, useRef, useState } from 'react';
import { connectorPoints, polylineMidpoint } from '../connectors/routing';
import { isConnector, isShape } from '../model/doc';
import { currentPage, useStore } from '../model/store';
import { SHAPES } from '../shapes/library';
import { textLines } from './ShapeView';
import { FONT_FAMILY, fitText, LINE_HEIGHT, TEXT_PAD } from './text';
import { rotationOf, SIDE_GAP, SIDE_PAD } from './transform';

/**
 * Textarea laid over a shape (or a connector's label) while its text is edited. It has no
 * background, so the shape shows through, and is laid out so the text sits where it will render.
 */
export function TextEditor({ id }: { id: string }) {
  const page = useStore(currentPage);
  const item = page.items[id];
  const vp = useStore((s) => s.viewport);
  const [value, setValue] = useState(() => (isShape(item) ? item.text : isConnector(item) ? item.label : ''));
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  if (!item) return null;

  const commit = () => {
    if (done.current) return;
    done.current = true;
    useStore.getState().commitText(id, value);
  };

  const z = vp.zoom;
  let style: React.CSSProperties;
  if (isShape(item)) {
    const st = item.style;
    const rot = rotationOf(item);
    // Where the textarea's top-left sits in the shape's local frame.
    let origin: { x: number; y: number };
    if (item.textPosition === 'right') {
      // Right of the shape, vertically centered, where the text renders; grows as you type.
      const size = fitText(value || ' ', st, 0);
      const h = Math.max(1, value.split('\n').length) * st.fontSize * LINE_HEIGHT;
      origin = { x: item.w + SIDE_GAP, y: item.h / 2 - h / 2 };
      style = {
        width: (size.w + 8 + SIDE_PAD * 2) * z,
        height: h * z,
        padding: 0,
        paddingLeft: SIDE_PAD * z,
        whiteSpace: 'pre',
      };
    } else if (item.autoSize) {
      // Grows with the text as you type; anchored at the box's top-left.
      const size = fitText(value, st);
      origin = { x: 0, y: 0 };
      style = {
        width: size.w * z,
        height: size.h * z,
        padding: TEXT_PAD * z,
        whiteSpace: 'pre',
      };
    } else {
      // Covers the shape's text box, with the wrapped lines vertically centered like the render.
      const box = SHAPES[item.kind].textBox(item.w, item.h);
      const lines = Math.max(1, textLines(item, value).length);
      origin = { x: box.x, y: box.y };
      style = {
        width: box.w * z,
        height: box.h * z,
        padding: 0,
        paddingTop: Math.max(0, (box.h - lines * st.fontSize * LINE_HEIGHT) / 2) * z,
      };
    }
    style = {
      ...style,
      left: vp.x + (item.x + origin.x) * z,
      top: vp.y + (item.y + origin.y) * z,
      fontSize: st.fontSize * z,
      fontWeight: st.bold ? 'bold' : 'normal',
      fontStyle: st.italic ? 'italic' : 'normal',
      color: st.textColor,
      textAlign: item.textPosition === 'right' ? 'left' : (st.textAlign ?? 'center'),
      // Rotate with the shape, about the shape's center.
      transform: rot ? `rotate(${rot}deg)` : undefined,
      transformOrigin: `${(item.w / 2 - origin.x) * z}px ${(item.h / 2 - origin.y) * z}px`,
    };
  } else {
    const mid = polylineMidpoint(connectorPoints(page, item));
    style = {
      left: vp.x + mid.x * z - 80,
      top: vp.y + mid.y * z - 14,
      width: 160,
      height: 28,
      padding: 2,
      fontSize: 12 * z,
      textAlign: 'center',
    };
  }

  return (
    <textarea
      ref={ref}
      className="text-editor"
      style={{ ...style, fontFamily: FONT_FAMILY }}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        // Esc or Ctrl/Cmd+Enter finishes; a connector label is one line, so Enter finishes it too.
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey || isConnector(item)))) {
          e.preventDefault();
          commit();
        }
      }}
    />
  );
}
