import { useEffect, useRef, useState } from 'react';
import { connectorPoints, polylineMidpoint } from '../connectors/routing';
import { isConnector, isShape } from '../model/doc';
import { useStore } from '../model/store';
import { SHAPES } from '../shapes/library';
import { FONT_FAMILY } from './text';

/** Textarea laid over a shape (or a connector's label) while its text is edited. */
export function TextEditor({ id }: { id: string }) {
  const item = useStore((s) => s.doc.items[id]);
  const vp = useStore((s) => s.viewport);
  const doc = useStore((s) => s.doc);
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
    const st = useStore.getState();
    st.update((d) => {
      const it = d.items[id];
      if (isShape(it)) it.text = value;
      else if (isConnector(it)) it.label = value.replace(/\n/g, ' ');
    });
    st.setEditing(null);
  };

  let style: React.CSSProperties;
  if (isShape(item)) {
    const box = SHAPES[item.kind].textBox(item.w, item.h);
    const st = item.style;
    style = {
      left: vp.x + (item.x + box.x) * vp.zoom,
      top: vp.y + (item.y + box.y) * vp.zoom,
      width: box.w * vp.zoom,
      height: box.h * vp.zoom,
      fontSize: st.fontSize * vp.zoom,
      fontWeight: st.bold ? 'bold' : 'normal',
      fontStyle: st.italic ? 'italic' : 'normal',
      color: st.textColor,
    };
  } else {
    const mid = polylineMidpoint(connectorPoints(doc, item));
    style = {
      left: vp.x + mid.x * vp.zoom - 80,
      top: vp.y + mid.y * vp.zoom - 14,
      width: 160,
      height: 28,
      fontSize: 12 * vp.zoom,
      background: '#ffffff',
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
