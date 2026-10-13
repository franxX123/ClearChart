import { canvasRefs } from '../canvas/Canvas';
import { docBounds } from '../canvas/geometry';
import { shapeImageSrc } from '../model/doc';
import type { Doc, Page } from '../model/types';
import { buildVsdx, decodeDataUrl, visioImageExt, type VsdxImage } from './vsdx';
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

/** Loads an image (via the load event: `decode()` never settles while the page is hidden). */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load a picture'));
    img.src = src;
  });
}

/**
 * A picture's bytes in a format Visio embeds: PNG/JPEG/GIF as they are; anything else (SVG,
 * WebP) drawn onto a canvas and saved as PNG. Null if the picture can't be read.
 */
async function visioImage(src: string, w: number, h: number): Promise<VsdxImage | null> {
  const decoded = decodeDataUrl(src);
  if (!decoded) return null;
  const ext = visioImageExt(decoded.mime);
  if (ext) return { bytes: decoded.bytes, ext };
  try {
    const img = await loadImage(src);
    const canvas = document.createElement('canvas');
    // Vector pictures have no natural pixel size worth trusting; render them at 4× the shape size.
    const vector = decoded.mime === 'image/svg+xml';
    canvas.width = Math.max(1, Math.round(vector || !img.naturalWidth ? w * 4 : img.naturalWidth));
    canvas.height = Math.max(1, Math.round(vector || !img.naturalHeight ? h * 4 : img.naturalHeight));
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
    return blob ? { bytes: new Uint8Array(await blob.arrayBuffer()), ext: 'png' } : null;
  } catch {
    return null;
  }
}

/** Downloads the whole document (every page) as an editable Visio file, `<title>.vsdx`. */
export async function exportVisio(doc: Doc): Promise<void> {
  const images = new Map<string, VsdxImage>();
  // Decoded once per distinct picture; shapes showing the same one share it (stored once in the file).
  const bySrc = new Map<string, VsdxImage | null>();
  for (const page of doc.pages) {
    for (const id of page.order) {
      const it = page.items[id];
      if (it.type !== 'shape' || it.kind !== 'image') continue;
      const src = shapeImageSrc(it, doc.assets);
      if (!src) continue;
      if (!bySrc.has(src)) bySrc.set(src, await visioImage(src, it.w, it.h));
      const img = bySrc.get(src);
      if (img) images.set(it.id, img);
    }
  }
  const bytes = buildVsdx(doc, images);
  downloadBlob(new Blob([bytes], { type: 'application/vnd.ms-visio.drawing' }), `${fileSafe(doc.title)}.vsdx`);
}
