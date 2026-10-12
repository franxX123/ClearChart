export const FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

export const LINE_HEIGHT = 1.25;

export const cssFont = (size: number, bold = false, italic = false) =>
  `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${size}px ${FONT_FAMILY}`;

let ctx: CanvasRenderingContext2D | null | undefined;

export function measureText(text: string, font: string, fontSize: number): number {
  if (ctx === undefined) {
    try {
      ctx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
    } catch {
      ctx = null;
    }
  }
  if (!ctx) return text.length * fontSize * 0.55;
  ctx.font = font;
  return ctx.measureText(text).width;
}

/** Word-wraps text to `maxWidth`, keeping explicit line breaks and splitting words that don't fit. */
export function wrapText(text: string, maxWidth: number, font: string, fontSize: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (measureText(candidate, font, fontSize) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) out.push(line);
      line = '';
      // Break a single word that is wider than the box.
      let chunk = '';
      for (const ch of word) {
        if (chunk && measureText(chunk + ch, font, fontSize) > maxWidth) {
          out.push(chunk);
          chunk = ch;
        } else {
          chunk += ch;
        }
      }
      line = chunk;
    }
    out.push(line);
  }
  // Drop trailing empty lines so an empty shape renders no text.
  while (out.length && out[out.length - 1] === '') out.pop();
  return out;
}
