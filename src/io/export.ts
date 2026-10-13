import { canvasRefs } from '../canvas/Canvas';
import { docBounds } from '../canvas/geometry';
import type { Page } from '../model/types';
import { downloadBlob, fileSafe } from './persist';

const PADDING = 20;
const SVG_NS = 'http://www.w3.org/2000/svg';

/** Builds a standalone SVG of the page shown on the canvas, from the live content layer. */
export function buildSvg(page: Page): { svg: string; width: number; height: number } | null {
  const content = canvasRefs.content;
  const b = docBounds(page);
  if (!content || !b) return null;
  const width = Math.ceil(b.w + PADDING * 2);
  const height = Math.ceil(b.h + PADDING * 2);

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('xmlns', SVG_NS);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('viewBox', `${b.x - PADDING} ${b.y - PADDING} ${width} ${height}`);
  const g = content.cloneNode(true) as SVGGElement;
  // Strip editor-only attributes and the invisible hit-area paths.
  g.querySelectorAll('path[stroke="transparent"]').forEach((el) => el.remove());
  g.querySelectorAll('[data-hit], [data-id]').forEach((el) => {
    el.removeAttribute('data-hit');
    el.removeAttribute('data-id');
  });
  g.querySelectorAll('[pointer-events]').forEach((el) => el.removeAttribute('pointer-events'));
  svg.appendChild(g);
  return { svg: new XMLSerializer().serializeToString(svg), width, height };
}

/** Downloads the active `page` as `<name>.svg`; it must be the page currently on the canvas. */
export function exportSvg(page: Page, name: string): boolean {
  const out = buildSvg(page);
  if (!out) return false;
  downloadBlob(new Blob([out.svg], { type: 'image/svg+xml' }), `${fileSafe(name)}.svg`);
  return true;
}

export async function exportPng(page: Page, name: string, scale = 2): Promise<boolean> {
  const out = buildSvg(page);
  if (!out) return false;
  const url = URL.createObjectURL(new Blob([out.svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = out.width * scale;
    canvas.height = out.height * scale;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
    if (!blob) return false;
    downloadBlob(blob, `${fileSafe(name)}.png`);
    return true;
  } finally {
    URL.revokeObjectURL(url);
  }
}
