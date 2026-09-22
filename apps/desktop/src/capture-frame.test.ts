import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { JSDOM } from 'jsdom';
import { VISUAL_LIMITS } from '@adc/contracts';
import { captureWindowFrame } from './capture-frame.ts';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

type FixtureOptions = {
  width?: number;
  height?: number;
  blank?: boolean;
  display?: Promise<MediaStream>;
  displayFailure?: { error: unknown; synchronous?: boolean };
  encoding?: 'pending' | 'empty' | 'oversized' | 'failed';
  failure?: 'play' | 'context' | 'draw' | 'pixels';
  stageError?: unknown;
};

function fixture(t: TestContext, options: FixtureOptions = {}) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const originalDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    'document',
  );
  const originalNavigator = Object.getOwnPropertyDescriptor(
    globalThis,
    'navigator',
  );
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: dom.window.document,
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: dom.window.navigator,
  });
  t.after(() => {
    for (const [key, original] of [
      ['document', originalDocument],
      ['navigator', originalNavigator],
    ] as const) {
      if (original) Object.defineProperty(globalThis, key, original);
      else Reflect.deleteProperty(globalThis, key);
    }
    dom.window.close();
  });

  const events: string[] = [];
  const trackStates = [{ stopped: false }, { stopped: false }];
  const tracks = trackStates.map((state, index) => ({
    stop() {
      state.stopped = true;
      events.push(`stop:${index}`);
    },
  }));
  const stream = { getTracks: () => tracks } as unknown as MediaStream;
  let displayCalls = 0;
  const displayStarted = deferred<void>();
  Object.defineProperty(dom.window.navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getDisplayMedia(constraints: DisplayMediaStreamOptions) {
        displayCalls++;
        events.push('display');
        assert.deepEqual(constraints, {
          video: { frameRate: 1 },
          audio: false,
        });
        displayStarted.resolve();
        if (options.displayFailure) {
          if (options.displayFailure.synchronous)
            throw options.displayFailure.error;
          return Promise.reject(options.displayFailure.error);
        }
        return options.display ?? Promise.resolve(stream);
      },
    },
  });

  const video = dom.window.document.createElement('video');
  Object.defineProperty(video, 'videoWidth', { value: options.width ?? 1000 });
  Object.defineProperty(video, 'videoHeight', { value: options.height ?? 600 });
  video.play = async () => {
    events.push('play');
    assert.equal(video.srcObject, stream);
    if (options.failure === 'play')
      throw options.stageError ?? new Error('Playback failed');
  };
  video.pause = () => {
    events.push('pause');
  };

  const canvas = dom.window.document.createElement('canvas');
  const draws: unknown[][] = [];
  const pixels: unknown[][] = [];
  const context = {
    drawImage(...args: unknown[]) {
      events.push('draw');
      assert.ok(trackStates.every((track) => !track.stopped));
      draws.push(args);
      if (options.failure === 'draw')
        throw options.stageError ?? new Error('Draw failed');
    },
    getImageData(...args: unknown[]) {
      events.push('pixels');
      assert.ok(trackStates.every((track) => track.stopped));
      pixels.push(args);
      if (options.failure === 'pixels') throw new Error('Pixel read failed');
      return {
        data: new Uint8ClampedArray(
          options.blank
            ? [0, 0, 0, 255, 0, 0, 0, 255]
            : [0, 0, 0, 255, 255, 255, 255, 255],
        ),
      };
    },
  };
  canvas.getContext = ((kind: string) => {
    assert.equal(kind, '2d');
    return options.failure === 'context' ? null : context;
  }) as typeof canvas.getContext;
  const encoded = deferred<void>();
  let encodeCallback: BlobCallback | undefined;
  let encodeDimensions: [number, number] | undefined;
  const imageBytes = new Uint8Array([255, 216, 1, 2, 3, 255, 217]);
  canvas.toBlob = (callback, type, quality) => {
    events.push('encode');
    assert.ok(trackStates.every((track) => track.stopped));
    assert.equal(type, 'image/jpeg');
    assert.equal(quality, 0.82);
    encodeDimensions = [canvas.width, canvas.height];
    encodeCallback = callback;
    encoded.resolve();
    if (options.encoding === 'pending') return;
    if (options.encoding === 'failed') return callback(null);
    const bytes =
      options.encoding === 'oversized'
        ? new Uint8Array(VISUAL_LIMITS.imageBytes + 1)
        : options.encoding === 'empty'
          ? new Uint8Array()
          : imageBytes;
    callback(new Blob([bytes], { type: 'image/jpeg' }));
  };
  const createElement = dom.window.document.createElement.bind(
    dom.window.document,
  );
  t.mock.method(dom.window.document, 'createElement', (tag: string) => {
    if (tag === 'video') return video;
    if (tag === 'canvas') return canvas;
    return createElement(tag);
  });

  return {
    dom,
    video,
    canvas,
    stream,
    events,
    draws,
    pixels,
    imageBytes,
    trackStates,
    displayCalls: () => displayCalls,
    displayStarted: displayStarted.promise,
    encoded: encoded.promise,
    encodeDimensions: () => encodeDimensions,
    completeEncoding(blob: Blob | null) {
      assert.ok(encodeCallback);
      encodeCallback(blob);
    },
  };
}

test('capture is idle until invoked and produces one frame after stopping every track', async (t) => {
  const f = fixture(t);
  assert.equal(f.displayCalls(), 0);
  assert.equal(f.events.length, 0);
  const before = Date.now();
  const frame = await captureWindowFrame(new AbortController().signal);
  assert.equal(f.displayCalls(), 1);
  assert.deepEqual([frame.width, frame.height], [1000, 600]);
  assert.deepEqual(f.encodeDimensions(), [frame.width, frame.height]);
  assert.deepEqual(f.draws, [[f.video, 0, 0, frame.width, frame.height]]);
  assert.deepEqual(f.pixels, [[0, 0, frame.width, frame.height]]);
  assert.deepEqual(new Uint8Array(frame.bytes), f.imageBytes);
  assert.ok(
    Date.parse(frame.capturedAt) >= before &&
      Date.parse(frame.capturedAt) <= Date.now(),
  );
  assert.ok(f.events.indexOf('draw') < f.events.indexOf('stop:0'));
  assert.ok(f.events.indexOf('stop:0') < f.events.indexOf('encode'));
  assert.ok(f.events.indexOf('stop:1') < f.events.indexOf('encode'));
  assert.ok(f.trackStates.every((track) => track.stopped));
  assert.equal(f.video.srcObject, null);
  assert.equal(f.video.onloadeddata, null);
  assert.equal(f.video.onerror, null);
  assert.equal(f.canvas.width, 0);
  assert.equal(f.canvas.height, 0);
});

test('large permitted frames encode at the returned dimensions within image limits', async (t) => {
  const f = fixture(t, { width: 6000, height: 4000 });
  const frame = await captureWindowFrame(new AbortController().signal);
  assert.ok(frame.width <= VISUAL_LIMITS.longestSide);
  assert.ok(frame.height <= VISUAL_LIMITS.longestSide);
  assert.ok(frame.width * frame.height <= VISUAL_LIMITS.imagePixels);
  assert.ok(Math.abs(frame.width / frame.height - 1.5) < 0.002);
  assert.deepEqual(f.encodeDimensions(), [frame.width, frame.height]);
  assert.deepEqual(f.draws[0], [f.video, 0, 0, frame.width, frame.height]);
});

test('cancelling a pending display request stops a late stream and never draws or encodes', async (t) => {
  const pending = deferred<MediaStream>();
  const f = fixture(t, { display: pending.promise });
  const abort = new AbortController();
  const capture = captureWindowFrame(abort.signal);
  await f.displayStarted;
  abort.abort();
  await assert.rejects(capture, { code: 'CANCELLED' });
  assert.ok(f.trackStates.every((track) => !track.stopped));
  pending.resolve(f.stream);
  await Promise.resolve();
  await Promise.resolve();
  assert.ok(f.trackStates.every((track) => track.stopped));
  assert.equal(f.draws.length, 0);
  assert.equal(f.events.includes('encode'), false);
  assert.equal(f.video.srcObject, null);
});

test('a bounded capture deadline also stops a stream arriving after timeout', async (t) => {
  const pending = deferred<MediaStream>();
  const f = fixture(t, { display: pending.promise });
  const timeout = new AbortController();
  t.mock.method(AbortSignal, 'timeout', (milliseconds: number) => {
    assert.equal(milliseconds, VISUAL_LIMITS.captureStageTimeoutMs);
    return timeout.signal;
  });
  const capture = captureWindowFrame(new AbortController().signal);
  await f.displayStarted;
  timeout.abort(new DOMException('Timed out', 'TimeoutError'));
  await assert.rejects(capture, { code: 'TIMEOUT' });
  pending.resolve(f.stream);
  await Promise.resolve();
  await Promise.resolve();
  assert.ok(f.trackStates.every((track) => track.stopped));
  assert.equal(f.events.includes('encode'), false);
});

test('already cancelled requests and unavailable media never start capture', async (t) => {
  const f = fixture(t);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(captureWindowFrame(abort.signal), { code: 'CANCELLED' });
  assert.equal(f.displayCalls(), 0);
  Object.defineProperty(f.dom.window.navigator, 'mediaDevices', {
    value: undefined,
  });
  await assert.rejects(captureWindowFrame(new AbortController().signal), {
    code: 'CAPTURE_UNAVAILABLE',
  });
  assert.equal(f.displayCalls(), 0);
});

test('blank or protected images release capture without encoding', async (t) => {
  const f = fixture(t, { blank: true });
  await assert.rejects(captureWindowFrame(new AbortController().signal), {
    code: 'CAPTURE_UNAVAILABLE',
  });
  assert.ok(f.trackStates.every((track) => track.stopped));
  assert.equal(f.events.includes('encode'), false);
  assert.equal(f.video.srcObject, null);
});

test('raw image bounds reject before allocation or drawing', async (t) => {
  const f = fixture(t, { width: 6001, height: 4000 });
  await assert.rejects(captureWindowFrame(new AbortController().signal), {
    code: 'INPUT_TOO_LARGE',
  });
  assert.equal(f.draws.length, 0);
  assert.equal(f.events.includes('encode'), false);
  assert.ok(f.trackStates.every((track) => track.stopped));
});

test('empty and oversized encoded blobs are rejected after capture has stopped', async (t) => {
  for (const encoding of ['empty', 'oversized'] as const) {
    await t.test(encoding, async (child) => {
      const f = fixture(child, { encoding });
      await assert.rejects(captureWindowFrame(new AbortController().signal), {
        code: 'INPUT_TOO_LARGE',
      });
      assert.ok(f.trackStates.every((track) => track.stopped));
      assert.equal(f.video.srcObject, null);
    });
  }
});

test('playback, canvas, drawing and pixel failures are normalized and release all tracks', async (t) => {
  for (const failure of ['play', 'context', 'draw', 'pixels'] as const) {
    await t.test(failure, async (child) => {
      const f = fixture(child, { failure });
      await assert.rejects(captureWindowFrame(new AbortController().signal), {
        code: failure === 'context' ? 'CAPTURE_UNAVAILABLE' : 'CAPTURE_FAILED',
      });
      assert.ok(f.trackStates.every((track) => track.stopped));
      assert.equal(f.video.srcObject, null);
      assert.equal(f.events.includes('pause'), true);
    });
  }
});

test('native display errors have stable denial, unavailable or failure codes without capturing', async (t) => {
  for (const [name, code, synchronous] of [
    ['NotAllowedError', 'CAPTURE_DENIED', false],
    ['SecurityError', 'CAPTURE_DENIED', true],
    ['NotFoundError', 'CAPTURE_UNAVAILABLE', false],
    ['InvalidStateError', 'CAPTURE_UNAVAILABLE', true],
    ['NotSupportedError', 'CAPTURE_UNAVAILABLE', false],
    ['NotReadableError', 'CAPTURE_FAILED', false],
    ['AbortError', 'CAPTURE_FAILED', false],
    ['UnexpectedError', 'CAPTURE_FAILED', true],
  ] as const) {
    await t.test(name, async (child) => {
      const f = fixture(child, {
        displayFailure: {
          error: new DOMException('Native capture error details', name),
          synchronous,
        },
      });
      await assert.rejects(captureWindowFrame(new AbortController().signal), {
        code,
      });
      assert.equal(f.displayCalls(), 1);
      assert.equal(f.draws.length, 0);
      assert.equal(f.events.includes('encode'), false);
      assert.equal(f.events.includes('pause'), true);
      assert.equal(f.video.srcObject, null);
      assert.equal(f.video.onerror, null);
      assert.ok(f.trackStates.every((track) => !track.stopped));
    });
  }
});

test('native play and drawing exceptions map to stable codes and release tracks', async (t) => {
  for (const [stage, name, code] of [
    ['play', 'NotAllowedError', 'CAPTURE_DENIED'],
    ['draw', 'InvalidStateError', 'CAPTURE_UNAVAILABLE'],
    ['draw', 'SecurityError', 'CAPTURE_DENIED'],
  ] as const) {
    await t.test(`${stage} ${name}`, async (child) => {
      const f = fixture(child, {
        failure: stage,
        stageError: new DOMException('Native stage error details', name),
      });
      await assert.rejects(captureWindowFrame(new AbortController().signal), {
        code,
      });
      assert.ok(f.trackStates.every((track) => track.stopped));
      assert.equal(f.video.srcObject, null);
      assert.equal(f.events.includes('encode'), false);
      if (stage === 'draw') {
        assert.equal(f.canvas.width, 0);
        assert.equal(f.canvas.height, 0);
      }
    });
  }
});

test('cancellation takes priority over a simultaneous native display failure', async (t) => {
  const abort = new AbortController();
  const f = fixture(t);
  t.mock.method(f.dom.window.navigator.mediaDevices, 'getDisplayMedia', () => {
    abort.abort();
    throw new DOMException('Denied after cancellation', 'NotAllowedError');
  });
  await assert.rejects(captureWindowFrame(abort.signal), { code: 'CANCELLED' });
  assert.equal(f.video.srcObject, null);
  assert.equal(f.events.includes('pause'), true);
});

test('capture timeout takes priority over a simultaneous native display failure', async (t) => {
  const timeout = new AbortController();
  const f = fixture(t);
  t.mock.method(AbortSignal, 'timeout', () => timeout.signal);
  t.mock.method(f.dom.window.navigator.mediaDevices, 'getDisplayMedia', () => {
    timeout.abort();
    throw new DOMException(
      'Source unavailable after deadline',
      'NotFoundError',
    );
  });
  await assert.rejects(captureWindowFrame(new AbortController().signal), {
    code: 'TIMEOUT',
  });
  assert.equal(f.video.srcObject, null);
  assert.equal(f.events.includes('pause'), true);
});

test('encoding failure releases capture and produces no image', async (t) => {
  const f = fixture(t, { encoding: 'failed' });
  await assert.rejects(captureWindowFrame(new AbortController().signal), {
    code: 'CAPTURE_UNAVAILABLE',
  });
  assert.ok(f.trackStates.every((track) => track.stopped));
  assert.equal(f.video.srcObject, null);
});

test('cancellation while encoding rejects promptly and ignores the late blob', async (t) => {
  const f = fixture(t, { encoding: 'pending' });
  const abort = new AbortController();
  const capture = captureWindowFrame(abort.signal);
  await f.encoded;
  assert.ok(f.trackStates.every((track) => track.stopped));
  abort.abort();
  await assert.rejects(capture, { code: 'CANCELLED' });
  let readBlob = false;
  const lateBlob = new Blob([f.imageBytes], { type: 'image/jpeg' });
  lateBlob.arrayBuffer = async () => {
    readBlob = true;
    return new ArrayBuffer(0);
  };
  f.completeEncoding(lateBlob);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(readBlob, false);
  assert.equal(f.video.srcObject, null);
});
