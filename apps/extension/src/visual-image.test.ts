import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import {
  normalizeVisualImage,
  normalizedDimensions,
  screenshotPng,
  visualMaskPixels,
  VISUAL_JPEG_QUALITY,
  type VisualImageRuntime,
} from './visual-image.ts';
import type { VisualGeometry } from './visual-dom.ts';
import { VISUAL_LIMITS } from '@adc/contracts';

const geometry = (width: number, height: number): VisualGeometry => ({
  documentKey: '4c99a52e-a083-4639-9f21-8f8c27b3b2a7',
  url: 'https://example.test',
  title: 'Raster fixture',
  width,
  height,
  scrollX: 0,
  scrollY: 0,
  scrollWidth: width,
  scrollHeight: height,
  dpr: 2,
  masks: [],
  nested: false,
  horizontal: false,
  occlusions: false,
  frames: false,
  editable: true,
  video: false,
  eligible: false,
  takeover: false,
});

/** Actual RGBA painting and JPEG encoding, while browser canvas APIs are injected.
 * This verifies provider-bound pixels, not actual Chrome capture permissions. */
function rasterRuntime() {
  let pixels: Buffer;
  let sourceWidth = 0;
  let sourceHeight = 0;
  let closed = 0;
  const dependencies: VisualImageRuntime = {
    decode: async (blob) => {
      const result = await sharp(Buffer.from(await blob.arrayBuffer()))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      pixels = result.data;
      sourceWidth = result.info.width;
      sourceHeight = result.info.height;
      return {
        width: sourceWidth,
        height: sourceHeight,
        close: () => {
          closed++;
        },
      } as ImageBitmap;
    },
    canvas: (width, height) => {
      let output = Buffer.alloc(width * height * 4, 255);
      const context = {
        fillStyle: '#ffffff',
        drawImage: () => {
          // Pixel fixture uses 1:1 normalisation; separate limits tests exercise
          // resampling dimensions and DPR/zoom transforms.
          assert.equal(width, sourceWidth);
          assert.equal(height, sourceHeight);
          output = Buffer.from(pixels);
        },
        fillRect: (x: number, y: number, w: number, h: number) => {
          const color = context.fillStyle === '#000000' ? 0 : 255;
          for (let py = y; py < y + h; py++)
            for (let px = x; px < x + w; px++) {
              const offset = (py * width + px) * 4;
              output[offset] = color;
              output[offset + 1] = color;
              output[offset + 2] = color;
              output[offset + 3] = 255;
            }
        },
      };
      return {
        getContext: () => context,
        convertToBlob: async (options: ImageEncodeOptions) => {
          assert.equal(options.quality, VISUAL_JPEG_QUALITY);
          const jpeg = await sharp(output, {
            raw: { width, height, channels: 4 },
          })
            .jpeg({ quality: 85 })
            .toBuffer();
          return new Blob([jpeg as BlobPart], { type: 'image/jpeg' });
        },
      } as unknown as OffscreenCanvas;
    },
  };
  return { dependencies, closed: () => closed };
}

test('actual encoded output removes synthetic private field and VSual pixels at 2x DPR', async () => {
  const width = 240;
  const height = 160;
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const password = x >= 20 && x < 70 && y >= 20 && y < 50;
      const companion = x >= 130 && x < 210 && y >= 80 && y < 140;
      rgba[offset] = password || companion ? 255 : 0;
      rgba[offset + 1] = password ? 0 : 170;
      rgba[offset + 2] = 0;
      rgba[offset + 3] = 255;
    }
  const png = await sharp(rgba, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
  const geo = geometry(120, 80);
  geo.masks = [
    { x: 10, y: 10, width: 25, height: 15 },
    { x: 65, y: 40, width: 40, height: 30 },
  ];
  const runtime = rasterRuntime();
  const result = await normalizeVisualImage(
    `data:image/png;base64,${png.toString('base64')}`,
    geo,
    new AbortController().signal,
    runtime.dependencies,
  );
  const decoded = await sharp(result.bytes).removeAlpha().raw().toBuffer();
  for (const [x, y] of [
    [30, 30],
    [60, 40],
    [150, 100],
    [200, 130],
  ]) {
    const offset = (y! * width + x!) * 3;
    assert.ok(
      decoded[offset]! < 8 &&
        decoded[offset + 1]! < 8 &&
        decoded[offset + 2]! < 8,
      'private pixels were replaced by black',
    );
  }
  const publicPixel = (10 * width + 110) * 3;
  assert.ok(
    decoded[publicPixel + 1]! > 150,
    'surrounding source remains readable',
  );
  assert.equal(result.redactions.length, 2);
  assert.equal(runtime.closed(), 1);
  assert.ok(result.bytes.length <= VISUAL_LIMITS.imageBytes);
});

test('dimension caps preserve aspect ratio; mask rounding is outward at enlarged/zoomed geometry', () => {
  for (const [w, h] of [
    [6000, 4000],
    [5000, 800],
    [1600, 2000],
  ]) {
    const result = normalizedDimensions(w!, h!);
    assert.ok(result.width * result.height <= VISUAL_LIMITS.imagePixels);
    assert.ok(
      Math.max(result.width, result.height) <= VISUAL_LIMITS.longestSide,
    );
    assert.ok(Math.abs(result.width / result.height - w! / h!) < 0.02);
  }
  const masks = visualMaskPixels(
    {
      width: 500,
      height: 400,
      masks: [{ x: 3, y: 3, width: 11.5, height: 10.5 }],
    },
    1000,
    800,
  );
  assert.deepEqual(masks, [{ x: 0, y: 0, width: 41, height: 39 }]);
});

test('raw raster bombs are rejected from header before the expensive decoder runs', async () => {
  const png = await sharp({
    create: { width: 1, height: 1, channels: 3, background: '#fff' },
  })
    .png()
    .toBuffer();
  png.writeUInt32BE(6000, 16);
  png.writeUInt32BE(5000, 20);
  let decoded = false;
  await assert.rejects(
    normalizeVisualImage(
      `data:image/png;base64,${png.toString('base64')}`,
      geometry(1000, 800),
      new AbortController().signal,
      {
        decode: async () => {
          decoded = true;
          throw new Error('must not decode');
        },
        canvas: () => {
          throw new Error('must not allocate');
        },
      },
    ),
    /VISUAL_TOO_LARGE/u,
  );
  assert.equal(decoded, false);
  assert.throws(
    () => screenshotPng('data:image/svg+xml;base64,PHN2Zz4='),
    /VISUAL_TOO_LARGE/u,
  );
});

test('cancellation while decoding releases the later bitmap without encoding', async () => {
  const png = await sharp({
    create: { width: 20, height: 20, channels: 3, background: '#fff' },
  })
    .png()
    .toBuffer();
  const abort = new AbortController();
  let released = 0;
  let encoded = false;
  await assert.rejects(
    normalizeVisualImage(
      `data:image/png;base64,${png.toString('base64')}`,
      geometry(20, 20),
      abort.signal,
      {
        decode: async () => {
          abort.abort();
          return {
            width: 20,
            height: 20,
            close: () => {
              released++;
            },
          } as ImageBitmap;
        },
        canvas: () => {
          encoded = true;
          throw new Error('must not encode');
        },
      },
    ),
  );
  assert.equal(released, 1);
  assert.equal(encoded, false);
});
