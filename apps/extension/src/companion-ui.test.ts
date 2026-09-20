import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { act, createElement } from 'react';
import { JSDOM } from 'jsdom';
import ts from 'typescript';
import {
  fingerprintSnapshot,
  type GroundedRequest,
  type GroundedSnapshot,
  type RecognitionLanguage,
} from '@adc/contracts';
import { calculateComparison } from '../../web/utils/grounded/comparison.ts';
import type {
  OrdersPageRequest,
  OrdersPageResponse,
} from './orders-adapter.ts';

test('companion sends the validated answer to speech, reuses audio and preserves text, focus and language across controls', async () => {
  // Node handles the repository's .ts files. Transform the two actual React .tsx
  // components in memory using the already-installed compiler, with no build output.
  const hook = registerHooks({
    load(url, context, next) {
      if (!url.endsWith('.tsx')) return next(url, context);
      const source = ts
        .transpileModule(readFileSync(fileURLToPath(url), 'utf8'), {
          compilerOptions: {
            module: ts.ModuleKind.ESNext,
            jsx: ts.JsxEmit.ReactJSX,
            target: ts.ScriptTarget.ES2022,
          },
        })
        .outputText.replaceAll(
          'import.meta.env',
          '({ VITE_API_BASE_URL: "http://127.0.0.1:3000" })',
        );
      return { format: 'module', shortCircuit: true, source };
    },
  });
  const dom = new JSDOM('<div id="root"></div>', {
    url: 'https://extension.example.test/index.html',
    pretendToBeVisual: true,
  });
  const replaced = new Map<string, PropertyDescriptor | undefined>();
  function expose(key: string, value: unknown) {
    replaced.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  for (const key of [
    'window',
    'document',
    'navigator',
    'localStorage',
    'HTMLElement',
    'HTMLTextAreaElement',
  ] as const)
    expose(key, dom.window[key]);
  expose('IS_REACT_ACT_ENVIRONMENT', true);
  const source: GroundedSnapshot = {
    snapshot_id: crypto.randomUUID(),
    document_key: crypto.randomUUID(),
    adapter_key: 'orders-fixture@1',
    captured_at: new Date().toISOString(),
    origin: 'http://127.0.0.1:3000',
    pathname: '/orders',
    title: 'Orders dashboard',
    table_title: 'Completed orders',
    region: 'South',
    year: 2026,
    metric: 'completed_orders',
    unit: 'orders',
    locale: 'en-US',
    is_complete: true,
    rows: [
      {
        id: 'july',
        period: '2026-07',
        region: 'South',
        raw_value: '1,200',
        value: 1200,
      },
      {
        id: 'august',
        period: '2026-08',
        region: 'South',
        raw_value: '900',
        value: 900,
      },
    ],
    fingerprint: '0'.repeat(64),
  };
  source.fingerprint = await fingerprintSnapshot(source);
  const listeners = new Set<(message: OrdersPageResponse) => void>();
  const noEvents = { addListener() {}, removeListener() {} };
  const updatedListeners = new Set<
    (id: number, change: { url?: string; status?: string }) => void
  >();
  let captures = 0;
  const tab = { id: 1, windowId: 2, url: 'http://127.0.0.1:3000/voice' };
  expose('chrome', {
    runtime: {},
    tabs: {
      onActivated: noEvents,
      onUpdated: {
        addListener(
          listener: (
            id: number,
            change: { url?: string; status?: string },
          ) => void,
        ) {
          updatedListeners.add(listener);
        },
        removeListener(
          listener: (
            id: number,
            change: { url?: string; status?: string },
          ) => void,
        ) {
          updatedListeners.delete(listener);
        },
      },
      onRemoved: noEvents,
      async query() {
        return [tab];
      },
      async update() {
        return tab;
      },
      connect() {
        return {
          onMessage: {
            addListener(listener: (message: OrdersPageResponse) => void) {
              listeners.add(listener);
            },
          },
          onDisconnect: noEvents,
          disconnect() {
            listeners.clear();
          },
          postMessage(message: OrdersPageRequest) {
            const response: OrdersPageResponse =
              message.type === 'orders:capture'
                ? {
                    type: 'orders:result',
                    id: message.id,
                    snapshot: { ...source, snapshot_id: crypto.randomUUID() },
                  }
                : message.type === 'orders:verify'
                  ? { type: 'orders:verified', id: message.id, current: true }
                  : { type: 'orders:focused', id: message.id, restored: true };
            if (message.type === 'orders:capture') captures++;
            queueMicrotask(() => {
              for (const listener of listeners) listener(response);
            });
          },
        };
      },
    },
    windows: { async update() {} },
  });
  const playback = { plays: 0, pauses: 0, releases: 0, rates: [] as number[] };
  expose(
    'Audio',
    class {
      currentTime = 0;
      private rate = 1;
      get playbackRate() {
        return this.rate;
      }
      set playbackRate(value: number) {
        this.rate = value;
        playback.rates.push(value);
      }
      addEventListener() {}
      async play() {
        playback.plays++;
      }
      pause() {
        playback.pauses++;
      }
      removeAttribute() {
        playback.releases++;
      }
      load() {}
    },
  );
  const submissions: GroundedRequest[] = [];
  let pendingFetch: ((response: Response) => void) | null = null;
  let holdRequest = false;
  let requestSignal: AbortSignal | null = null;
  expose('fetch', async (_url: RequestInfo | URL, options?: RequestInit) => {
    const request = JSON.parse(String(options?.body)) as GroundedRequest;
    submissions.push(request);
    requestSignal = options?.signal ?? null;
    if (holdRequest)
      return new Promise<Response>((resolve) => {
        pendingFetch = resolve;
      });
    return Response.json(
      calculateComparison(request, {
        decision: 'comparison',
        operation: 'compare',
        metric: 'completed_orders',
        region: 'South',
        baseline_period: '2026-07',
        comparison_period: '2026-08',
        reason: null,
      }),
    );
  });
  const spoken: { text: string; language: RecognitionLanguage }[] = [];
  let speechFails = false;
  let holdSpeech = false;
  let pendingSpeech: ((audio: Blob) => void) | null = null;
  let speechSignal: AbortSignal | null = null;
  const voiceTransport = {
    async transcribe(): Promise<never> {
      assert.fail('Typing must not start microphone or STT');
    },
    async speak(
      text: string,
      language: RecognitionLanguage,
      signal: AbortSignal,
    ) {
      spoken.push({ text, language });
      speechSignal = signal;
      if (speechFails)
        throw Object.assign(new Error('Speech unavailable'), {
          code: 'QUOTA_EXHAUSTED',
        });
      if (holdSpeech)
        return new Promise<Blob>((resolve) => {
          pendingSpeech = resolve;
        });
      return new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mpeg' });
    },
  };
  const { GroundedPanel } = await import('./GroundedPanel.tsx');
  // ReactDOM's event feature detection must see this test document at import time.
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root')!);
  const baseProps = {
    sessionKey: 'synthetic-user',
    voiceTransport,
    backend: 'https://backend.example.test',
    getHeaders: async () => ({ Authorization: 'Bearer synthetic-test-token' }),
    onExpired() {
      assert.fail('No authentication failure expected');
    },
    onReady() {
      return () => {};
    },
  };
  const flush = () => new Promise<void>((done) => setImmediate(done));
  async function settle(action: () => void) {
    await act(async () => {
      action();
      await flush();
      await flush();
    });
  }
  function button(text: string) {
    const result = [...dom.window.document.querySelectorAll('button')].find(
      (element) => element.textContent === text,
    );
    assert.ok(result, `Missing button: ${text}`);
    return result;
  }
  function assertSingleStop() {
    assert.equal(
      [...dom.window.document.querySelectorAll('button')].filter(
        (element) => element.textContent === 'Stop speech',
      ).length,
      1,
    );
  }
  try {
    await settle(() =>
      root.render(
        createElement(GroundedPanel, { ...baseProps, language: 'en' }),
      ),
    );
    assert.equal(captures, 0);
    assert.equal(submissions.length, 0);
    assert.equal(spoken.length, 0);
    assert.equal(button('Allow page processing').disabled, true);
    assert.equal(
      button('Allow page processing').getAttribute('aria-describedby'),
      'page-permission-help',
    );
    assert.equal(
      dom.window.document.querySelector<HTMLAnchorElement>(
        '#page-permission-help a',
      )?.href,
      'http://127.0.0.1:3000/orders',
    );
    await settle(() => button('Check active page').click());
    assert.equal(button('Allow page processing').disabled, true);
    // Manual address recheck recovers without capturing or granting permission.
    tab.url = 'http://127.0.0.1:3000/orders';
    await settle(() => button('Check active page').click());
    assert.equal(button('Allow page processing').disabled, false);
    // Same-tab navigation also updates permission availability before any capture.
    await settle(() => {
      tab.url = 'http://127.0.0.1:3000/voice';
      updatedListeners.forEach((listener) =>
        listener(tab.id, { url: tab.url }),
      );
    });
    assert.equal(button('Allow page processing').disabled, true);
    await settle(() => {
      tab.url = 'http://127.0.0.1:3000/orders';
      updatedListeners.forEach((listener) =>
        listener(tab.id, { url: tab.url }),
      );
    });
    assert.equal(button('Allow page processing').disabled, false);
    assert.equal(captures, 0);
    assert.equal(submissions.length, 0);
    assert.equal(spoken.length, 0);
    await settle(() => button('Allow page processing').click());
    await settle(() => button('Use example question').click());
    assert.equal(dom.window.document.activeElement?.tagName, 'TEXTAREA');
    await settle(() => button('Ask VSual').click());
    const answer =
      'Completed orders in the South decreased by 300, or 25%, from July to August 2026.';
    assert.equal(submissions.length, 1);
    assert.ok(
      !dom.window.document.body.textContent?.includes(
        'Cancelled. Your text is preserved.',
      ),
      'Submitting idle typed input must not announce a cancelled recording',
    );
    assert.ok(dom.window.document.body.textContent?.includes(answer));
    assert.notEqual(submissions[0]?.question, answer);
    assert.equal(
      spoken.length,
      0,
      'App speech remains off until explicitly enabled',
    );
    await settle(() => button('View evidence').click());
    assert.equal(dom.window.document.activeElement?.id, 'evidence-heading');
    assert.ok(
      dom.window.document
        .querySelector('table')
        ?.textContent?.includes('1,200'),
    );
    await settle(() => button('Back to answer').click());
    assert.equal(dom.window.document.activeElement?.id, 'answer-heading');
    const enableSpeech = dom.window.document.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    assert.ok(enableSpeech);
    await settle(() => enableSpeech.click());
    await settle(() => button('Read answer').click());
    assert.deepEqual(spoken, [{ text: answer, language: 'en' }]);
    const plays = playback.plays;
    await settle(() => button('Play / Repeat').click());
    assert.equal(playback.plays, plays + 1);
    const speed = dom.window.document.getElementById(
      'answer-speed',
    ) as HTMLSelectElement;
    await settle(() => {
      speed.value = '1.5';
      speed.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    });
    assert.equal(playback.rates.at(-1), 1.5);
    assert.equal(
      spoken.length,
      1,
      'Repeat and speed changes reuse generated audio',
    );
    await settle(() => button('View evidence').click());
    assert.equal(dom.window.document.activeElement?.id, 'evidence-heading');
    assertSingleStop();
    assert.equal(button('Stop speech').disabled, false);
    const evidencePauses = playback.pauses;
    await settle(() => {
      button('Stop speech').focus();
      assert.equal(dom.window.document.activeElement, button('Stop speech'));
      button('Stop speech').click();
      assert.ok(
        playback.pauses > evidencePauses,
        'Stop pauses immediately while viewing evidence',
      );
    });
    const evidencePlays = playback.plays;
    await settle(() => button('Play / Repeat').click());
    assert.equal(playback.plays, evidencePlays + 1);
    assert.equal(
      spoken.length,
      1,
      'Repeat in evidence reuses the existing audio',
    );
    await settle(() => button('View captured table').click());
    assert.equal(dom.window.document.activeElement?.id, 'source-table-heading');
    assertSingleStop();
    const tablePauses = playback.pauses;
    await settle(() => {
      button('Stop speech').click();
      assert.ok(
        playback.pauses > tablePauses,
        'Stop pauses immediately while viewing the captured table',
      );
    });
    await settle(() => button('Play / Repeat').click());
    assert.equal(
      spoken.length,
      1,
      'Switching views and repeating cannot generate another clip',
    );
    await settle(() => button('Stop speech').click());
    await settle(() => button('Back to answer').click());
    assert.equal(dom.window.document.activeElement?.id, 'answer-heading');
    assert.ok(dom.window.document.body.textContent?.includes(answer));
    assert.equal((requestSignal as AbortSignal | null)?.aborted, false);
    assert.equal(captures, 1);
    assert.equal(submissions.length, 1);
    await settle(() =>
      root.render(
        createElement(GroundedPanel, { ...baseProps, language: 'vi' }),
      ),
    );
    const answerParagraph = dom.window.document.querySelector(
      '#answer-heading + p',
    );
    assert.equal(answerParagraph?.getAttribute('lang'), 'en');
    assert.equal(answerParagraph?.textContent, answer);
    assert.equal(spoken.length, 1);
    await settle(() =>
      root.render(
        createElement(GroundedPanel, { ...baseProps, language: 'en' }),
      ),
    );
    await settle(() => button('Play / Repeat').click());
    const beforeEscape = playback.pauses;
    const textarea = dom.window.document.querySelector('textarea')!;
    await settle(() =>
      textarea.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    assert.ok(
      playback.pauses > beforeEscape,
      'Escape inside question also stops answer speech',
    );
    assert.equal(spoken.length, 1);

    // A new answer invalidates the cached clip. A speech failure leaves readable evidence.
    source.rows[1] = {
      id: 'august',
      period: '2026-08',
      region: 'South',
      raw_value: '1,050',
      value: 1050,
    };
    source.fingerprint = await fingerprintSnapshot(source);
    await settle(() => button('Ask VSual').click());
    speechFails = true;
    await settle(() => button('Read answer').click());
    assert.equal(spoken.length, 2);
    assert.match(spoken[1]!.text, /150, or 12\.5%/);
    assert.ok(dom.window.document.body.textContent?.includes(spoken[1]!.text));
    assert.ok(
      dom.window.document.body.textContent?.includes(
        'The voice service allowance has been used.',
      ),
    );
    assert.ok(
      playback.releases > 0,
      'Changing the answer releases its previous audio',
    );
    await settle(() => button('View evidence').click());
    assert.ok(
      dom.window.document.body.textContent?.includes(
        'The voice service allowance has been used.',
      ),
      'Speech errors remain available in the evidence view',
    );
    assert.ok(
      dom.window.document
        .querySelector('table')
        ?.textContent?.includes('1,050'),
    );
    await settle(() => button('Back to answer').click());

    // Stop also remains available when synthesis is pending in either source view.
    speechFails = false;
    holdSpeech = true;
    await settle(() => button('Read answer').click());
    assert.equal(spoken.length, 3);
    await settle(() => button('View evidence').click());
    assert.equal(dom.window.document.activeElement?.id, 'evidence-heading');
    assertSingleStop();
    assert.equal(button('Stop speech').disabled, false);
    assert.ok(
      dom.window.document.body.textContent?.includes(
        'Speech is being prepared.',
      ),
    );
    await settle(() => button('View captured table').click());
    assert.equal(dom.window.document.activeElement?.id, 'source-table-heading');
    assertSingleStop();
    assert.ok(
      dom.window.document.body.textContent?.includes(
        'Speech is being prepared.',
      ),
    );
    const beforeLateSpeech = playback.plays;
    await settle(() => {
      button('Stop speech').focus();
      button('Stop speech').click();
      assert.equal(
        (speechSignal as AbortSignal | null)?.aborted,
        true,
        'Stop aborts synthesis immediately from the captured table',
      );
    });
    assert.ok(pendingSpeech);
    await settle(() =>
      (pendingSpeech as (audio: Blob) => void)(
        new Blob([new Uint8Array([4, 5, 6])], { type: 'audio/mpeg' }),
      ),
    );
    assert.equal(
      playback.plays,
      beforeLateSpeech,
      'Late synthesis cannot start playback after Stop',
    );
    assert.equal(
      spoken.length,
      3,
      'View changes and Stop do not submit more speech requests',
    );
    await settle(() => button('Back to answer').click());
    assert.equal(dom.window.document.activeElement?.id, 'answer-heading');
    assert.ok(dom.window.document.body.textContent?.includes(spoken[1]!.text));

    holdRequest = true;
    await settle(() => button('Ask VSual').click());
    const pending = submissions.at(-1)!;
    await settle(() => button('Cancel request').click());
    assert.equal((requestSignal as AbortSignal | null)?.aborted, true);
    assert.ok(pendingFetch);
    await settle(() =>
      (pendingFetch as (response: Response) => void)(
        Response.json(
          calculateComparison(pending, {
            decision: 'comparison',
            operation: 'compare',
            metric: 'completed_orders',
            region: 'South',
            baseline_period: '2026-07',
            comparison_period: '2026-08',
            reason: null,
          }),
        ),
      ),
    );
    assert.equal(
      dom.window.document
        .querySelector('#answer-heading + p')
        ?.textContent?.includes('12.5%'),
      false,
    );
    assert.ok(textarea.value.length > 0, 'Cancellation preserves the question');
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    hook.deregister();
    for (const [key, descriptor] of replaced) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
