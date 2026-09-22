import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { act, createElement } from 'react';
import { JSDOM } from 'jsdom';
import ts from 'typescript';
import {
  fingerprintVisualSnapshot,
  type VisualSnapshot,
  type VisualRequest,
  type VisualResponse,
} from '@adc/contracts';
import type { CompanionControls } from './GroundedPanel.tsx';
import type { GroundedController } from './grounded-controller.ts';
import type { OrdersContext } from './page-context.ts';
import type {
  Playback,
  VoiceTransport,
} from '../../../packages/voice-ui/src/controller.ts';
import { ANSWER_PREFERENCES_KEY } from './answer-preferences.ts';

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}

test('actual visual companion processes first Ask without extra approval, exposes evidence and preserves accepted speech across tab visibility', async (t) => {
  const hook = registerHooks({
    load(url, context, next) {
      if (!url.endsWith('.tsx')) return next(url, context);
      return {
        format: 'module',
        shortCircuit: true,
        source: ts
          .transpileModule(readFileSync(fileURLToPath(url), 'utf8'), {
            compilerOptions: {
              module: ts.ModuleKind.ESNext,
              jsx: ts.JsxEmit.ReactJSX,
              target: ts.ScriptTarget.ES2022,
            },
          })
          .outputText.replaceAll(
            'import.meta.env',
            '({VITE_API_BASE_URL:"http://127.0.0.1:3000"})',
          ),
      };
    },
  });
  const dom = new JSDOM('<div id="root"></div>', {
    url: 'https://extension.example.test/floating.html',
    pretendToBeVisual: true,
  });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    localStorage: dom.window.localStorage,
    HTMLElement: dom.window.HTMLElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  dom.window.localStorage.setItem(
    ANSWER_PREFERENCES_KEY,
    JSON.stringify({ speechEnabled: false }),
  );
  const { browserDependencies } = await import('@adc/voice-ui');
  const { GroundedPanel } = await import('./GroundedPanel.tsx');
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root')!);
  const capturedAt = new Date().toISOString();
  const snapshot: VisualSnapshot = {
    source_kind: 'visual_page',
    snapshot_id: crypto.randomUUID(),
    captured_at: capturedAt,
    capture_started_at: capturedAt,
    fingerprint: '0'.repeat(64),
    origin: 'https://calendar.example.test',
    pathname: '/calendar',
    title: 'Team calendar',
    document_key: crypto.randomUUID(),
    resource_key: 'a'.repeat(64),
    window_id: 20,
    tab_id: 10,
    scope: 'current_view',
    images: [
      {
        id: 'image-1',
        sha256: 'b'.repeat(64),
        captured_at: capturedAt,
        width: 800,
        height: 600,
        viewport_width: 800,
        viewport_height: 600,
        scroll_x: 0,
        scroll_y: 0,
        scale_x: 1,
        scale_y: 1,
        redactions: [],
      },
    ],
    coverage: {
      scroll_width: 800,
      scroll_height: 600,
      geometric_complete: false,
      limitations: ['current_view_only', 'document_not_retrieved'],
    },
  };
  snapshot.fingerprint = await fingerprintVisualSnapshot(snapshot);
  const pageContext: OrdersContext = {
    supported: false,
    sourceKind: 'structured_page',
    permission: 'granted',
    capability: 'unsupported',
    origin: snapshot.origin,
    pathname: snapshot.pathname,
    resourceKey: snapshot.resource_key,
    title: snapshot.title,
    tabId: 10,
    windowId: 20,
    reason: 'unsupported',
    documentId: crypto.randomUUID(),
    visual: { eligible: true, permission: 'granted' },
  };
  let captures = 0,
    modelCalls = 0,
    generations = 0,
    plays = 0,
    releases = 0;
  const rates: number[] = [];
  let pendingAudio: ReturnType<typeof deferred<Blob>> | null = null;
  let controls: CompanionControls | null = null;
  let expired = 0;
  const controlsNow = () => {
    assert.ok(controls);
    return controls;
  };
  const page = (): ConstructorParameters<typeof GroundedController>[0] => ({
    getContext: async () => ({ ...pageContext }),
    capture: async () => {
      assert.fail('A visual question must not run the DOM reader');
    },
    captureVisual: async (scope) => {
      assert.equal(scope, 'current_view');
      captures++;
      return {
        snapshot,
        images: [{ id: 'image-1', mime_type: 'image/png', base64: 'YWJj' }],
      };
    },
    verify: async () => true,
    verifyVisual: async () => true,
    subscribe: () => () => {},
    reset() {},
    dispose() {},
    returnToPage: async () => ({ restored: true }),
  });
  const answer = 'Lịch hiển thị cuộc họp vào 10:00.';
  const excerpt = 'Ô lịch ghi cuộc họp lúc 10:00.';
  let failVisualRequest = false;
  const failedRequestId = crypto.randomUUID();
  t.mock.method(
    globalThis,
    'fetch',
    async (url: unknown, options: RequestInit) => {
      assert.equal(url, 'https://backend.example.test/api/visual-read');
      assert.equal(
        new Headers(options.headers).get('authorization'),
        'Bearer synthetic-session',
      );
      const request = JSON.parse(String(options.body)) as VisualRequest;
      modelCalls++;
      if (failVisualRequest)
        return Response.json(
          {
            request_id: failedRequestId,
            error: {
              code: 'PROVIDER_FAILURE',
              message: 'Safe visual failure',
              retryable: true,
            },
          },
          { status: 502 },
        );
      const response: VisualResponse = {
        source_kind: 'visual_page',
        request_id: request.request_id,
        snapshot_id: request.snapshot.snapshot_id,
        fingerprint: request.snapshot.fingerprint,
        status: 'answer',
        answer_language: 'vi',
        text: answer,
        evidence: [
          {
            image_id: 'image-1',
            region: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
            description: excerpt,
          },
        ],
        scope: request.snapshot.scope,
        coverage: request.snapshot.coverage,
      };
      return Response.json(response);
    },
  );
  let waitForSpeechAbort = false;
  const voice: VoiceTransport = {
    transcribe: async () => {
      assert.fail('Typing and opening must not record');
    },
    speak: async (text, language, signal) => {
      generations++;
      assert.equal(text, answer);
      assert.equal(language, 'vi');
      if (waitForSpeechAbort) {
        return new Promise<Blob>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        });
      }
      return pendingAudio
        ? pendingAudio.promise
        : new Blob(['mock audio'], { type: 'audio/mpeg' });
    },
  };
  t.mock.method(browserDependencies, 'getMicrophone', async () => {
    assert.fail('No automatic microphone');
  });
  t.mock.method(
    browserDependencies,
    'createObjectURL',
    () => 'blob:visual-answer',
  );
  t.mock.method(browserDependencies, 'revokeObjectURL', () => {});
  t.mock.method(browserDependencies, 'createPlayback', (): Playback => ({
    currentTime: 0,
    playbackRate: 1,
    onended: null,
    onerror: null,
    play: async function () {
      plays++;
      rates.push(this.playbackRate);
    },
    pause() {},
    release() {
      releases++;
    },
  }));
  const render = () =>
    root.render(
      createElement(GroundedPanel, {
        sessionKey: 'visual-account:workspace',
        language: 'en',
        voiceTransport: voice,
        backend: 'https://backend.example.test',
        getHeaders: async () => ({ Authorization: 'Bearer synthetic-session' }),
        onExpired() {
          expired++;
        },
        onReady: () => () => {},
        createPage: page,
        autoFocus: false,
        onControls: (next) => {
          controls = next;
        },
      }),
    );
  const button = (label: string) => {
    const value = [...dom.window.document.querySelectorAll('button')].find(
      (button) => button.textContent === label,
    );
    assert.ok(value, label);
    return value;
  };
  const click = async (label: string) => {
    const value = button(label);
    assert.equal(value.disabled, false, label);
    await act(async () => {
      value.click();
      await flush();
    });
  };
  try {
    await act(async () => {
      render();
      await flush();
    });
    assert.equal(captures, 0);
    assert.equal(modelCalls, 0);
    assert.equal(generations, 0);
    await act(async () => {
      controlsNow().question.editText('Lịch đang hiển thị cuộc họp nào?');
    });
    assert.equal(
      [...dom.window.document.querySelectorAll('button')].some(
        (button) => button.textContent === 'Use page images for my questions',
      ),
      false,
    );
    assert.match(
      dom.window.document.body.textContent!,
      /image and question through Avis/,
    );
    const disclosure = [
      ...dom.window.document.querySelectorAll('details'),
    ].find(
      (element) =>
        element.querySelector('summary')?.textContent ===
        'How page images are processed',
    );
    assert.ok(disclosure);
    await act(async () => {
      disclosure.open = true;
      await flush();
    });
    assert.equal(captures, 0, 'Reading the disclosure must not capture');
    assert.equal(modelCalls, 0, 'Reading the disclosure must not submit');
    await click('Ask VSual');
    assert.equal(captures, 1);
    assert.equal(modelCalls, 1);
    assert.equal(generations, 0);
    assert.equal(plays, 0);
    const displayed = dom.window.document.querySelector('.answer-text')!;
    assert.equal(displayed.textContent, answer);
    assert.equal(displayed.getAttribute('lang'), 'vi');
    assert.equal(
      displayed.closest('[aria-live],[role="status"],[role="alert"]'),
      null,
    );
    const evidence = dom.window.document.querySelector(
      '.evidence-disclosure ul',
    )!;
    assert.match(evidence.textContent!, /10:00/);
    assert.equal(evidence.getAttribute('lang'), 'vi');
    assert.equal(
      evidence.closest('[aria-live],[role="status"],[role="alert"]'),
      null,
    );
    assert.match(
      dom.window.document.body.textContent!,
      /one captured browser view/,
    );
    const speechToggle = dom.window.document.getElementById(
      'answer-speech-enabled',
    ) as HTMLInputElement;
    await act(async () => {
      speechToggle.click();
      await flush();
    });
    assert.equal(
      generations,
      0,
      'Enabling speech must not read an older answer',
    );
    pendingAudio = deferred<Blob>();
    await click('Ask VSual');
    assert.equal(captures, 2);
    assert.equal(modelCalls, 2);
    assert.equal(generations, 1);
    assert.equal(plays, 0);
    assert.equal(
      dom.window.document.querySelector('.answer-text')?.textContent,
      answer,
    );
    assert.match(dom.window.document.body.textContent!, /Preparing audio/);
    await act(async () => {
      render();
      await flush();
    });
    assert.equal(
      generations,
      1,
      'Rerender must not repeat the automatic attempt',
    );
    await act(async () => {
      pendingAudio!.resolve(new Blob(['mock audio'], { type: 'audio/mpeg' }));
      await flush();
    });
    pendingAudio = null;
    assert.equal(plays, 1);
    assert.deepEqual(rates, [0.9]);
    await click('Stop speech');
    await click('Read again');
    assert.equal(
      generations,
      1,
      'Repeat must use the existing generated audio',
    );
    assert.equal(modelCalls, 2);
    assert.equal(plays, 2);
    assert.deepEqual(rates, [0.9, 0.9]);
    await act(async () => {
      speechToggle.click();
      await flush();
    });
    assert.equal(controlsNow().speech.getSnapshot().speechEnabled, false);
    assert.equal(button('Read again').disabled, true);
    await click('Ask VSual');
    assert.equal(modelCalls, 3);
    assert.equal(generations, 1);
    assert.equal(plays, 2);
    assert.equal(expired, 0);
    const later = Date.now() + 120_000;
    t.mock.method(Date, 'now', () => later);
    await act(async () => {
      speechToggle.click();
      await flush();
    });
    assert.equal(
      generations,
      1,
      'Enabling speech after the task deadline is still passive',
    );
    await click('Read answer');
    assert.equal(
      generations,
      2,
      'A later explicit read gets its own speech deadline',
    );
    assert.equal(plays, 3);
    assert.equal(modelCalls, 3);
    await click('Stop speech');
    const speechTimeout = new AbortController();
    t.mock.method(AbortSignal, 'timeout', () => speechTimeout.signal);
    waitForSpeechAbort = true;
    await click('Ask VSual');
    assert.equal(modelCalls, 4);
    assert.equal(generations, 3);
    assert.equal(controlsNow().speech.getSnapshot().phase, 'generating');
    await act(async () => {
      speechTimeout.abort(
        new DOMException('Synthetic timeout', 'TimeoutError'),
      );
      await flush();
    });
    assert.equal(controlsNow().speech.getSnapshot().errorCode, 'timeout');
    assert.equal(plays, 3, 'Timed out audio cannot start playback');
    assert.equal(generations, 3, 'Timeout never retries paid generation');
    assert.equal(modelCalls, 4);
    assert.equal(
      dom.window.document.querySelector('.answer-text')?.textContent,
      answer,
    );
    assert.match(
      dom.window.document.querySelector('.evidence-disclosure ul')!
        .textContent!,
      /10:00/,
    );
    assert.equal(button('Retry speech').disabled, false);
    failVisualRequest = true;
    await click('Ask VSual');
    const requestDetails = [...dom.window.document.querySelectorAll('summary')]
      .find((summary) => summary.textContent === 'Request details')
      ?.closest('details');
    assert.ok(requestDetails);
    assert.ok(requestDetails.textContent?.includes(failedRequestId));
    assert.equal(
      requestDetails.closest('[aria-live],[role="status"],[role="alert"]'),
      null,
    );
    assert.equal(dom.window.document.querySelector('.answer-text'), null);
    assert.equal(
      generations,
      3,
      'Failed visual answers cannot generate speech',
    );
    await act(async () => {
      controlsNow().controller.pauseForTab();
      await flush();
    });
    assert.equal(
      controlsNow().controller.getSnapshot().error,
      'PROVIDER_FAILURE',
    );
    assert.ok(dom.window.document.body.textContent!.includes(failedRequestId));
    await act(async () => controlsNow().controller.clearTransient());
    assert.ok(!dom.window.document.body.textContent!.includes(failedRequestId));
  } finally {
    await act(async () => {
      root.unmount();
    });
    assert.ok(releases > 0);
    hook.deregister();
    dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
