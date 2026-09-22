/// <reference types="chrome" />
// This integration test compiles the real extension capture modules too.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import sharp from 'sharp';
import type { VisualRequest } from '@adc/contracts';
import { GroundedController } from '../../../extension/src/grounded-controller.ts';
import { createGroundedTransport } from '../../../extension/src/grounded-transport.ts';
import {
  createVisualCapture,
  type VisualCaptureBrowser,
} from '../../../extension/src/visual-capture.ts';
import {
  normalizeVisualImage,
  type VisualImageRuntime,
} from '../../../extension/src/visual-image.ts';
import type {
  visualDomCommand,
  VisualDomRequest,
  VisualRect,
} from '../../../extension/src/visual-dom.ts';
import { createVisualHandler } from './visual-http.ts';
import {
  answerVisualPage,
  prepareVisualInput,
  validateVisualImages,
  visualRouteVerification,
} from './visual-server.ts';
import { requireGroundedConfiguration } from './server.ts';

const sourceUrl = 'https://fixture.example/document?view=one#page-1';
const backend = 'https://backend.example.test';
const provider = 'https://api.avis.xyz/api/openai/v1';
const publicText = 'PUBLIC DOCUMENT ORBIT 29';
const privateText = ['FAKE PRIVATE PINE 42', 'FAKE COMPANION CEDAR 73'];
const field = { x: 50, y: 500, width: 420, height: 70 };
const companion = { x: 700, y: 30, width: 260, height: 300 };
const documentArea = { x: 80, y: 80, width: 490, height: 150 };
const events = () => ({ addListener() {}, removeListener() {} });

/** Browser interfaces are mocked, but resize, masking and JPEG bytes are real.
 * The assertion below inspects the exact image in the SDK's outbound request. */
function rasterRuntime(): VisualImageRuntime {
  let source: Buffer;
  return {
    decode: async (blob) => {
      source = Buffer.from(await blob.arrayBuffer());
      const size = await sharp(source).metadata();
      return {
        width: size.width,
        height: size.height,
        close() {
          source = Buffer.alloc(0);
        },
      } as ImageBitmap;
    },
    canvas: (width, height) => {
      const masks: VisualRect[] = [];
      const context = {
        fillStyle: '#ffffff',
        drawImage() {},
        fillRect(x: number, y: number, w: number, h: number) {
          if (context.fillStyle === '#000000')
            masks.push({ x, y, width: w, height: h });
        },
      };
      return {
        getContext: () => context,
        convertToBlob: async (options: ImageEncodeOptions) => {
          assert.equal(options.type, 'image/jpeg');
          assert.equal(options.quality, 0.85);
          const pixels = await sharp(source)
            .resize(width, height)
            .removeAlpha()
            .raw()
            .toBuffer();
          for (const mask of masks) {
            for (let y = mask.y; y < mask.y + mask.height; y++) {
              pixels.fill(
                0,
                (y * width + mask.x) * 3,
                (y * width + mask.x + mask.width) * 3,
              );
            }
          }
          const jpeg = await sharp(pixels, {
            raw: { width, height, channels: 3 },
          })
            .jpeg({ quality: 85 })
            .toBuffer();
          return new Blob([jpeg as BlobPart], { type: 'image/jpeg' });
        },
      } as unknown as OffscreenCanvas;
    },
  };
}

for (const dpr of [2, 4])
  test(`provider-bound image masks fake private content after actual resizing at ${dpr}x pixel scale${dpr === 4 ? ' (2x display at 200% desktop zoom)' : ''}`, async (t) => {
    const envNames = [
      'AVIS_API_KEY',
      'AVIS_API_BASE_URL',
      'AVIS_AI_MODEL',
      'AVIS_VISUAL_VERIFIED_ROUTE',
      'OPENAI_LOG',
    ];
    const previous = new Map(envNames.map((name) => [name, process.env[name]]));
    process.env.AVIS_API_KEY = 'synthetic-provider-never-valid';
    process.env.AVIS_API_BASE_URL = provider;
    process.env.AVIS_AI_MODEL = 'gpt-6-astra';
    process.env.AVIS_VISUAL_VERIFIED_ROUTE = visualRouteVerification(
      requireGroundedConfiguration(),
    );
    process.env.OPENAI_LOG = 'debug'; // Production adapter must still disable payload logging.
    const dom = new JSDOM(
      `<title>Synthetic document</title><main><article id="document" contenteditable="true" role="document" aria-label="Intended document"><h1>${publicText}</h1><p>Readable source paragraph.</p></article></main><input id="private" type="password" value="${privateText[0]}"><div id="companion" data-vsual-floating-host>${privateText[1]}</div>`,
      { url: sourceUrl, runScripts: 'outside-only' },
    );
    const w = dom.window;
    Object.defineProperty(w, 'chrome', {
      value: {
        dom: {
          openOrClosedShadowRoot: (element: Element) => element.shadowRoot,
        },
      },
    });
    Object.defineProperty(w.document, 'scrollingElement', {
      value: w.document.documentElement,
    });
    Object.defineProperties(w.document.documentElement, {
      scrollWidth: { value: 1000 },
      scrollHeight: { value: 700 },
    });
    Object.defineProperties(w, {
      innerWidth: { value: 1000 },
      innerHeight: { value: 700 },
      devicePixelRatio: { value: dpr },
      scrollX: { value: 0 },
      scrollY: { value: 0 },
    });
    w.scrollTo = () =>
      assert.fail('Current-view reading must not scroll the source');
    const boxes: Record<string, VisualRect> = {
      private: field,
      companion,
      document: documentArea,
    };
    for (const element of w.document.querySelectorAll('*'))
      element.getBoundingClientRect = () => {
        const r = boxes[element.id] ?? { x: 0, y: 0, width: 0, height: 0 };
        return {
          ...r,
          left: r.x,
          top: r.y,
          right: r.x + r.width,
          bottom: r.y + r.height,
          toJSON: () => ({}),
        };
      };
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${1000 * dpr}" height="${700 * dpr}" viewBox="0 0 1000 700"><rect width="1000" height="700" fill="white"/><rect x="80" y="80" width="490" height="150" fill="#155fbb"/><text x="95" y="145" font-size="22" fill="white">${publicText}</text><rect x="50" y="500" width="420" height="70" fill="#d12b65"/><text x="65" y="540" font-size="20" fill="white">${privateText[0]}</text><rect x="700" y="30" width="260" height="300" fill="#b84611"/><text x="710" y="85" font-size="15" fill="white">${privateText[1]}</text></svg>`;
    const rawPng = await sharp(Buffer.from(svg)).png().toBuffer();
    const rawUrl = `data:image/png;base64,${rawPng.toString('base64')}`;
    let captures = 0,
      reservations = 0,
      providerCalls = 0,
      authorised = 0;
    let received: VisualRequest | null = null;
    let providerBytes: Buffer | null = null;
    const logs: unknown[][] = [];
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const)
      t.mock.method(console, method, (...values: unknown[]) => {
        logs.push(values);
      });
    const api = {
      tabs: {
        get: async () => ({ id: 1, windowId: 2, active: true, url: sourceUrl }),
        captureVisibleTab: async () => {
          captures++;
          return rawUrl;
        },
        onActivated: events(),
        onUpdated: events(),
        onRemoved: events(),
      },
      windows: {
        get: async () => ({ focused: true }),
        onFocusChanged: events(),
      },
      scripting: {
        executeScript: async (options: {
          func: typeof visualDomCommand;
          args: [VisualDomRequest];
        }) => [
          {
            documentId: 'synthetic-browser-document',
            result: w.eval(
              `(${options.func.toString()})(${JSON.stringify(options.args[0])})`,
            ),
          },
        ],
      },
    };
    const imageRuntime = rasterRuntime();
    const capture = createVisualCapture(
      api as unknown as VisualCaptureBrowser,
      {
        normalize: (raw, geometry, signal) =>
          normalizeVisualImage(raw, geometry, signal, imageRuntime),
      },
    );
    const handler = createVisualHandler({
      verifyVoiceUser: async (request) => {
        assert.equal(
          request.headers.get('authorization'),
          'Bearer synthetic-extension-session',
        );
        authorised++;
        return {
          subject: 'synthetic-subject',
          userId: 'synthetic-user',
          workspaceId: 'synthetic-workspace',
        };
      },
      reserveVoiceRequest: async () => {
        reservations++;
      },
      prepareVisualInput,
      validateVisualImages,
      answerVisualPage,
    });
    t.mock.method(
      globalThis,
      'fetch',
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        if (request.url === `${backend}/api/visual-read`) {
          received = (await request.clone().json()) as VisualRequest;
          return handler(request);
        }
        assert.equal(
          request.url,
          `${provider}/responses`,
          'No remote images, alternate models or arbitrary URLs may be fetched',
        );
        providerCalls++;
        const body = (await request.json()) as {
          input: {
            content: (
              | { type: 'input_image'; image_url: string }
              | { type: 'input_text'; text: string }
            )[];
          }[];
          store: boolean;
        };
        assert.equal(body.store, false);
        const image = body.input[0]!.content.find(
          (part) => part.type === 'input_image',
        );
        assert.ok(image?.type === 'input_image');
        assert.ok(image.image_url.startsWith('data:image/jpeg;base64,'));
        providerBytes = Buffer.from(image.image_url.split(',')[1]!, 'base64');
        for (const marker of [...privateText, 'synthetic-extension-session'])
          assert.ok(!JSON.stringify(body).includes(marker));
        return Response.json({
          id: 'resp_synthetic',
          object: 'response',
          status: 'completed',
          output: [
            {
              type: 'message',
              role: 'assistant',
              content: [
                {
                  type: 'output_text',
                  annotations: [],
                  text: JSON.stringify({
                    status: 'answer',
                    answer_language: 'en',
                    text: publicText,
                    evidence: [
                      {
                        image_id: 'image-1',
                        region: { x: 0.08, y: 0.115, width: 0.48, height: 0.2 },
                        description: publicText,
                      },
                    ],
                  }),
                },
              ],
            },
          ],
        });
      },
    );
    const context = {
      supported: false,
      sourceKind: 'structured_page' as const,
      permission: 'granted' as const,
      capability: 'unsupported' as const,
      tabId: 1,
      windowId: 2,
      origin: new URL(sourceUrl).origin,
      pathname: '/document',
      resourceKey: createHash('sha256').update(sourceUrl).digest('hex'),
      reason: 'unsupported' as const,
      visual: { eligible: true, permission: 'granted' as const },
    };
    const controller = new GroundedController(
      {
        getContext: async () => context,
        capture: async () => {
          throw new Error('No prose extraction for this question');
        },
        captureVisual: (scope, signal) =>
          capture.capture(
            {
              tabId: 1,
              windowId: 2,
              url: sourceUrl,
              documentId: 'synthetic-browser-document',
              requestId: crypto.randomUUID(),
              contextGeneration: 1,
              scope,
            },
            signal,
          ),
        verify: async () => false,
        verifyVisual: (snapshot) => capture.verify(snapshot),
        subscribe: () => () => {},
        returnToPage: async () => ({ restored: true }),
        reset() {},
        dispose() {
          capture.dispose();
        },
      },
      createGroundedTransport({
        baseUrl: backend,
        getHeaders: async () => ({
          Authorization: 'Bearer synthetic-extension-session',
        }),
        onUnauthenticated: () => assert.fail('Mocked authorised account'),
      }),
      () => {},
    );
    try {
      await controller.refreshContext();
      controller.setQuestion('Read the document label in this screen.');
      assert.equal(captures, 0);
      await controller.ask();
      assert.equal(
        controller.getSnapshot().phase,
        'ready',
        controller.getSnapshot().error ?? 'Expected accepted answer',
      );
      assert.equal(controller.getSnapshot().result?.text, publicText);
      assert.equal(captures, 1);
      assert.equal(authorised, 1);
      assert.equal(reservations, 1);
      assert.equal(providerCalls, 1);
      assert.ok(providerBytes);
      assert.ok(received);
      const actualRequest = received as VisualRequest;
      assert.ok(
        actualRequest.snapshot.coverage.limitations.includes(
          'redacted_regions',
        ),
      );
      assert.ok(actualRequest.snapshot.images[0]!.redactions.length >= 2);
      const decoded = await sharp(providerBytes)
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const { width, height } = decoded.info;
      assert.ok(
        width < 1000 * dpr,
        'Real resampling occurred before provider upload',
      );
      assert.ok(height < 700 * dpr);
      // Check ALL original private rectangles, including their visible fake letters.
      for (const box of [field, companion]) {
        for (
          let y = Math.ceil((box.y * height) / 700);
          y < Math.floor(((box.y + box.height) * height) / 700);
          y++
        ) {
          for (
            let x = Math.ceil((box.x * width) / 1000);
            x < Math.floor(((box.x + box.width) * width) / 1000);
            x++
          ) {
            const index = (y * width + x) * 3;
            assert.ok(
              decoded.data[index]! < 10 &&
                decoded.data[index + 1]! < 10 &&
                decoded.data[index + 2]! < 10,
              'Provider-bound private pixels must be black',
            );
          }
        }
      }
      // The deliberately selected document editor stays readable after resampling.
      const publicCrop = {
        left: Math.ceil((95 * width) / 1000),
        top: Math.ceil((115 * height) / 700),
        width: Math.floor((450 * width) / 1000),
        height: Math.floor((40 * height) / 700),
      };
      const visible = await sharp(providerBytes)
        .extract(publicCrop)
        .removeAlpha()
        .raw()
        .toBuffer();
      let whiteLetters = 0,
        blueBackground = 0;
      for (let i = 0; i < visible.length; i += 3) {
        if (visible[i]! > 200 && visible[i + 1]! > 200 && visible[i + 2]! > 200)
          whiteLetters++;
        if (visible[i]! < 80 && visible[i + 2]! > 130) blueBackground++;
      }
      assert.ok(whiteLetters > 100, 'Public source letters survive');
      assert.ok(
        blueBackground > 1000,
        'Public source region is not blindly masked',
      );
      assert.deepEqual(
        logs,
        [],
        'No source, image, answer or token payload logging even under SDK debug environment',
      );
      assert.equal('images' in controller.getSnapshot(), false);
      assert.equal(controller.claimAutomaticSpeech()?.text, publicText);
      assert.equal(controller.claimAutomaticSpeech(), null);
    } finally {
      controller.dispose();
      dom.window.close();
      for (const [name, value] of previous) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
