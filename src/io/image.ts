import { useStore, viewCenter } from '../model/store';
import type { Point } from '../model/types';

/** Longest side, in pixels, images are reduced to before being embedded in a diagram. */
const MAX_IMAGE_SIZE = 512;
/** Longest side of the shape an image is placed as. */
const PLACED_SIZE = 96;

export const IMAGE_FILES = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml';

const readDataUrl = (file: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });

/**
 * Reads an image file as a data URL for embedding. Raster images larger than 512px are
 * downscaled so documents (and localStorage) stay small; SVGs are kept as they are.
 * Returns the URL and a placement size that keeps the aspect ratio.
 */
export async function readImageFile(file: File): Promise<{ src: string; w: number; h: number }> {
  const original = await readDataUrl(file);
  const img = new Image();
  img.src = original;
  await img.decode();
  const iw = img.naturalWidth || PLACED_SIZE;
  const ih = img.naturalHeight || PLACED_SIZE;
  const fit = (max: number) => Math.min(1, max / Math.max(iw, ih));

  let src = original;
  if (file.type !== 'image/svg+xml' && Math.max(iw, ih) > MAX_IMAGE_SIZE) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(iw * fit(MAX_IMAGE_SIZE));
    canvas.height = Math.round(ih * fit(MAX_IMAGE_SIZE));
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    src = canvas.toDataURL(file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.9);
  }
  const s = PLACED_SIZE / Math.max(iw, ih);
  return { src, w: Math.max(10, Math.round(iw * s)), h: Math.max(10, Math.round(ih * s)) };
}

/** Reads an image file and places it on the canvas centered at `center`. */
export async function addImageFromFile(file: File, center: Point = viewCenter()): Promise<void> {
  try {
    const { src, w, h } = await readImageFile(file);
    useStore.getState().addImage(src, { w, h }, center);
  } catch {
    alert(`Couldn't read "${file.name}" as an image.`);
  }
}
