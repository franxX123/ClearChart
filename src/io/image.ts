// Loading pictures from the user's device into data URLs that can be embedded in the document.

/** Largest side of an embedded raster image; bigger ones are downscaled to keep documents small. */
export const MAX_IMAGE_SIDE = 2000;
/** Size an SVG without intrinsic dimensions is given. */
const SVG_FALLBACK = { w: 300, h: 200 };

export interface LoadedImage {
  src: string;
  w: number;
  h: number;
}

/** Scales (w, h) down, keeping the aspect ratio, so neither side exceeds `max`. Never scales up. */
export function fitWithin(w: number, h: number, max: number): { w: number; h: number } {
  const f = Math.min(1, max / Math.max(w, h, 1));
  return { w: Math.max(1, Math.round(w * f)), h: Math.max(1, Math.round(h * f)) };
}

const readAsDataUrl = (file: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });

/** Loads an image. Uses the load event, not `img.decode()`, which never settles while the page is hidden. */
function decode(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The file could not be read as an image'));
    img.src = src;
  });
}

/** Files above this are re-encoded even when small enough in pixels (browser autosave holds ~5 MB). */
const REENCODE_BYTES = 400_000;

function hasTransparency(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const data = ctx.getImageData(0, 0, w, h).data;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  return false;
}

/**
 * Reads an image file into an embeddable data URL plus its pixel size. SVGs are kept as-is.
 * Rasters larger than MAX_IMAGE_SIDE, or heavy files, are redrawn (downscaled if needed) and
 * re-encoded: JPEG when fully opaque, PNG otherwise — keeping the original if that's smaller.
 * Small GIFs are never redrawn, so animation survives.
 */
export async function readImageFile(file: File): Promise<LoadedImage> {
  if (!file.type.startsWith('image/')) throw new Error(`"${file.name}" is not an image`);
  const src = await readAsDataUrl(file);
  const img = await decode(src);
  if (file.type === 'image/svg+xml') {
    const w = img.naturalWidth || SVG_FALLBACK.w;
    const h = img.naturalHeight || SVG_FALLBACK.h;
    return { src, w, h };
  }
  const { naturalWidth: w, naturalHeight: h } = img;
  const tooBig = Math.max(w, h) > MAX_IMAGE_SIDE;
  if (!tooBig && (file.size <= REENCODE_BYTES || file.type === 'image/gif')) return { src, w, h };
  const size = fitWithin(w, h, MAX_IMAGE_SIDE);
  const canvas = document.createElement('canvas');
  canvas.width = size.w;
  canvas.height = size.h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, size.w, size.h);
  const opaque = !hasTransparency(ctx, size.w, size.h);
  const encoded = canvas.toDataURL(opaque ? 'image/jpeg' : 'image/png', 0.88);
  if (!tooBig && encoded.length >= src.length) return { src, w, h };
  return { src: encoded, ...size };
}

/** Opens the system file picker for one image. Resolves null if the user cancels. */
export function pickImageFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}
