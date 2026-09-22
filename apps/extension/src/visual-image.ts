import { VISUAL_LIMITS, type VisualRegion } from '@adc/contracts';
import type { VisualGeometry } from './visual-dom.ts';

export const VISUAL_JPEG_QUALITY = 0.85;
const MASK_MARGIN_CSS = 6;

export interface NormalizedVisualImage {
  bytes: Uint8Array;
  width: number;
  height: number;
  redactions: VisualRegion[];
}

export interface VisualImageRuntime {
  decode: (blob: Blob) => Promise<ImageBitmap>;
  canvas: (width: number, height: number) => OffscreenCanvas;
}

const runtime: VisualImageRuntime = {
  decode: (blob) => createImageBitmap(blob),
  canvas: (width, height) => new OffscreenCanvas(width, height),
};

/** captureVisibleTab is requested as PNG; inspect IHDR before allocating pixels. */
export function screenshotPng(value: string): {
  bytes: Uint8Array;
  width: number;
  height: number;
} {
  if (
    !value.startsWith('data:image/png;base64,') ||
    value.length > VISUAL_LIMITS.rawPixels * 6
  )
    throw new Error('VISUAL_TOO_LARGE');
  const base64 = value.slice('data:image/png;base64,'.length);
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(base64))
    throw new Error('VISUAL_UNSUPPORTED');
  const decoded = atob(base64);
  const bytes = Uint8Array.from(decoded, (char) => char.charCodeAt(0));
  if (
    bytes.length < 33 ||
    ![137, 80, 78, 71, 13, 10, 26, 10].every(
      (byte, index) => bytes[index] === byte,
    ) ||
    String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR'
  )
    throw new Error('VISUAL_UNSUPPORTED');
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = header.getUint32(16);
  const height = header.getUint32(20);
  if (!width || !height || width * height > VISUAL_LIMITS.rawPixels)
    throw new Error('VISUAL_TOO_LARGE');
  return { bytes, width, height };
}

export function normalizedDimensions(width: number, height: number) {
  const ratio = Math.min(
    1,
    VISUAL_LIMITS.longestSide / Math.max(width, height),
    Math.sqrt(VISUAL_LIMITS.imagePixels / (width * height)),
  );
  return {
    width: Math.max(1, Math.floor(width * ratio)),
    height: Math.max(1, Math.floor(height * ratio)),
  };
}

/** Margins are rounded outward at the final pixel scale, never inward. */
export function visualMaskPixels(
  geometry: Pick<VisualGeometry, 'width' | 'height' | 'masks'>,
  width: number,
  height: number,
) {
  return geometry.masks
    .map((rect) => {
      const x = Math.max(
        0,
        Math.floor(((rect.x - MASK_MARGIN_CSS) * width) / geometry.width),
      );
      const y = Math.max(
        0,
        Math.floor(((rect.y - MASK_MARGIN_CSS) * height) / geometry.height),
      );
      const right = Math.min(
        width,
        Math.ceil(
          ((rect.x + rect.width + MASK_MARGIN_CSS) * width) / geometry.width,
        ),
      );
      const bottom = Math.min(
        height,
        Math.ceil(
          ((rect.y + rect.height + MASK_MARGIN_CSS) * height) / geometry.height,
        ),
      );
      return { x, y, width: right - x, height: bottom - y };
    })
    .filter((rect) => rect.width > 0 && rect.height > 0);
}

export async function normalizeVisualImage(
  dataUrl: string,
  geometry: VisualGeometry,
  signal: AbortSignal,
  dependencies: VisualImageRuntime = runtime,
): Promise<NormalizedVisualImage> {
  signal.throwIfAborted();
  const raw = screenshotPng(dataUrl);
  // Measured bitmap scale handles DPR and desktop zoom. Pinch-zoom and changed
  // viewport geometry are rejected before this function is called.
  const scaleX = raw.width / geometry.width;
  const scaleY = raw.height / geometry.height;
  if (
    scaleX <= 0 ||
    scaleY <= 0 ||
    scaleX > 8 ||
    scaleY > 8 ||
    Math.abs(scaleX - scaleY) > 0.05
  )
    throw new Error('VISUAL_UNSTABLE');
  let source: ImageBitmap | null = null;
  try {
    source = await dependencies.decode(
      new Blob([raw.bytes as BlobPart], { type: 'image/png' }),
    );
    signal.throwIfAborted();
    if (source.width !== raw.width || source.height !== raw.height)
      throw new Error('VISUAL_UNSUPPORTED');
    const { width, height } = normalizedDimensions(source.width, source.height);
    const canvas = dependencies.canvas(width, height);
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('VISUAL_UNSUPPORTED');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(source, 0, 0, width, height);
    const masks = visualMaskPixels(geometry, width, height);
    context.fillStyle = '#000000';
    for (const rect of masks)
      context.fillRect(rect.x, rect.y, rect.width, rect.height);
    signal.throwIfAborted();
    const blob = await canvas.convertToBlob({
      type: 'image/jpeg',
      quality: VISUAL_JPEG_QUALITY,
    });
    signal.throwIfAborted();
    if (blob.type !== 'image/jpeg') throw new Error('VISUAL_UNSUPPORTED');
    if (blob.size > VISUAL_LIMITS.imageBytes)
      throw new Error('VISUAL_TOO_LARGE');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    signal.throwIfAborted();
    return {
      bytes,
      width,
      height,
      redactions: masks.map((rect) => ({
        x: rect.x / width,
        y: rect.y / height,
        width: rect.width / width,
        height: rect.height / height,
      })),
    };
  } finally {
    source?.close();
    raw.bytes.fill(0);
  }
}
