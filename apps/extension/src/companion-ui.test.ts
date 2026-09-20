import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mock, test } from 'node:test';
import { act, createElement, StrictMode } from 'react';
import { JSDOM } from 'jsdom';
import ts from 'typescript';
import {
  fingerprintSnapshot,
  type GroundedRequest,
  type GroundedSnapshot,
  type RecognitionLanguage,
  type TranscriptResponse,
} from '@adc/contracts';
import type {
  MicrophoneStream,
  Recorder,
  VoiceDependencies,
} from '../../../packages/voice-ui/src/controller.ts';
import { calculateComparison } from '../../web/utils/grounded/comparison.ts';
import type {
  OrdersPageRequest,
  OrdersPageResponse,
} from './orders-adapter.ts';

test('companion preserves evidence, saved opt-out and focus while automatically reading only fresh answers', async () => {
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
  dom.window.localStorage.setItem(
    'voice:extension-preferences',
    JSON.stringify({ speechEnabled: false }),
  );
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
  let autoplayDenied = false;
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
        if (autoplayDenied)
          throw new DOMException(
            'Automatic playback blocked',
            'NotAllowedError',
          );
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
  let responseLanguage: 'en' | 'vi' = 'en';
  let responseKind: 'comparison' | 'clarification' | 'unsupported' =
    'comparison';
  const usageLimit = {
    minute_count: 24,
    minute_limit: 24,
    day_count: 73,
    day_limit: 240,
    limited_by: 'minute' as const,
    retry_after_seconds: 42,
    retry_at: '2026-09-21T00:01:00.000Z',
  };
  let answerLimited = false;
  expose('fetch', async (_url: RequestInfo | URL, options?: RequestInit) => {
    const request = JSON.parse(String(options?.body)) as GroundedRequest;
    submissions.push(request);
    requestSignal = options?.signal ?? null;
    if (answerLimited)
      return Response.json(
        {
          request_id: request.request_id,
          error: {
            code: 'APP_RATE_LIMITED',
            message: 'VSual request limit reached.',
            retryable: true,
            usage: usageLimit,
          },
        },
        { status: 429 },
      );
    if (holdRequest)
      return new Promise<Response>((resolve) => {
        pendingFetch = resolve;
      });
    return Response.json(
      calculateComparison(request, {
        answer_language: responseLanguage,
        decision: responseKind,
        operation: 'compare',
        metric: 'completed_orders',
        region: 'South',
        baseline_period: '2026-07',
        comparison_period: '2026-08',
        reason:
          responseKind === 'comparison'
            ? null
            : responseKind === 'clarification'
              ? 'missing_periods'
              : 'unsupported_operation',
      }),
    );
  });
  const spoken: { text: string; language: RecognitionLanguage }[] = [];
  let speechFails = false;
  let speechFailureCode = 'QUOTA_EXHAUSTED';
  let speechUsageLimited = false;
  let holdSpeech = false;
  let pendingSpeech: ((audio: Blob) => void) | null = null;
  let speechSignal: AbortSignal | null = null;
  let recordedMode = false;
  let transcriptText = 'Compare completed orders in July and August.';
  let transcriptCalls = 0;
  let holdTranscript = false;
  let pendingTranscript: ((response: TranscriptResponse) => void) | null = null;
  let transcriptSignal: AbortSignal | null = null;
  const voiceTransport = {
    async transcribe(
      audio: Blob,
      filename: string,
      _language: RecognitionLanguage,
      signal: AbortSignal,
    ): Promise<TranscriptResponse> {
      assert.ok(recordedMode, 'Typing must not start microphone or STT');
      assert.equal(filename, 'recording.webm');
      assert.ok(audio.size > 0, 'The final recorder chunk is uploaded');
      transcriptCalls++;
      transcriptSignal = signal;
      if (holdTranscript)
        return new Promise((resolve) => {
          pendingTranscript = resolve;
        });
      return { transcript: transcriptText, request_id: crypto.randomUUID() };
    },
    async speak(
      text: string,
      language: RecognitionLanguage,
      signal: AbortSignal,
    ) {
      spoken.push({ text, language });
      speechSignal = signal;
      if (speechUsageLimited)
        throw Object.assign(new Error('VSual request limit reached.'), {
          code: 'APP_RATE_LIMITED',
          usage: usageLimit,
        });
      if (speechFails)
        throw Object.assign(new Error('Speech unavailable'), {
          code: speechFailureCode,
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
  function disclosure(text: string) {
    const summary = [...dom.window.document.querySelectorAll('summary')].find(
      (element) => element.textContent === text,
    );
    assert.ok(summary, `Missing disclosure: ${text}`);
    return summary;
  }
  function openDisclosure(text: string) {
    const summary = disclosure(text);
    summary.focus();
    if (!(summary.parentElement as HTMLDetailsElement).open) summary.click();
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
    await settle(() => {
      button('Allow page processing').focus();
      button('Allow page processing').click();
    });
    assert.equal(
      dom.window.document.activeElement?.tagName,
      'TEXTAREA',
      'The removed consent action hands focus to the question',
    );
    const permissionSummary = disclosure('Page processing permission');
    await settle(() => {
      permissionSummary.focus();
      tab.url = 'http://127.0.0.1:3000/voice';
      updatedListeners.forEach((listener) =>
        listener(tab.id, { url: tab.url }),
      );
    });
    assert.equal(disclosure('Page processing permission'), permissionSummary);
    assert.equal(
      dom.window.document.activeElement,
      permissionSummary,
      'A page change keeps focus on the stable permission disclosure',
    );
    assert.equal(
      (permissionSummary.parentElement as HTMLDetailsElement).open,
      true,
      'Losing page access exposes the explanation and next action',
    );
    assert.equal(button('Allow page processing').disabled, true);
    await settle(() => {
      tab.url = 'http://127.0.0.1:3000/orders';
      updatedListeners.forEach((listener) =>
        listener(tab.id, { url: tab.url }),
      );
    });
    await settle(() => {
      button('Allow page processing').focus();
      button('Allow page processing').click();
    });
    assert.equal(dom.window.document.activeElement?.tagName, 'TEXTAREA');
    assert.equal(
      (permissionSummary.parentElement as HTMLDetailsElement).open,
      false,
    );
    assert.equal(captures, 0);
    assert.equal(submissions.length, 0);
    await settle(() => button('Use example question').click());
    assert.equal(dom.window.document.activeElement?.tagName, 'TEXTAREA');
    const inputBeforeAnswer = dom.window.document.activeElement;
    await settle(() => button('Ask VSual').click());
    assert.equal(
      dom.window.document.activeElement,
      inputBeforeAnswer,
      'Async answer arrival preserves focus',
    );
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
      'A saved OFF preference remains off until explicitly enabled',
    );
    await settle(() => openDisclosure('View evidence'));
    assert.equal(
      dom.window.document.activeElement,
      disclosure('View evidence'),
    );
    assert.equal(
      (disclosure('View evidence').parentElement as HTMLDetailsElement).open,
      true,
    );
    assert.ok(
      dom.window.document
        .querySelector('table')
        ?.textContent?.includes('1,200'),
    );
    await settle(() => button('Close evidence').click());
    assert.equal(
      dom.window.document.activeElement,
      disclosure('View evidence'),
    );
    assert.equal(
      (disclosure('View evidence').parentElement as HTMLDetailsElement).open,
      false,
    );
    const enableSpeech = dom.window.document.querySelector<HTMLInputElement>(
      '#answer-speech-enabled',
    );
    assert.ok(enableSpeech);
    assert.equal(enableSpeech.checked, false);
    await settle(() => enableSpeech.click());
    assert.equal(
      spoken.length,
      0,
      'Enabling speech does not read an old answer',
    );
    await settle(() => button('Read answer').click());
    assert.deepEqual(spoken, [{ text: answer, language: 'en' }]);
    await settle(() => button('Stop speech').click());
    const plays = playback.plays;
    await settle(() => button('Read again').click());
    assert.equal(playback.plays, plays + 1);
    assert.equal(dom.window.document.getElementById('answer-speed'), null);
    assert.equal(playback.rates.at(-1), 0.9);
    assert.equal(
      spoken.length,
      1,
      'Repeat reuses generated audio at the fixed companion speed',
    );
    await settle(() => openDisclosure('View evidence'));
    assert.equal(
      dom.window.document.activeElement,
      disclosure('View evidence'),
    );
    assert.equal(
      (disclosure('View evidence').parentElement as HTMLDetailsElement).open,
      true,
    );
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
    await settle(() => button('Read again').click());
    assert.equal(playback.plays, evidencePlays + 1);
    assert.equal(
      spoken.length,
      1,
      'Repeat in evidence reuses the existing audio',
    );
    await settle(() => openDisclosure('Inspect the source table without AI'));
    assert.equal(
      dom.window.document.activeElement,
      disclosure('Inspect the source table without AI'),
    );
    assertSingleStop();
    const tablePauses = playback.pauses;
    await settle(() => {
      button('Stop speech').click();
      assert.ok(
        playback.pauses > tablePauses,
        'Stop pauses immediately while viewing the captured table',
      );
    });
    await settle(() => button('Read again').click());
    assert.equal(
      spoken.length,
      1,
      'Switching views and repeating cannot generate another clip',
    );
    await settle(() => button('Stop speech').click());
    await settle(() => button('Close evidence').click());
    assert.equal(
      dom.window.document.activeElement,
      disclosure('View evidence'),
    );
    assert.equal(
      (disclosure('View evidence').parentElement as HTMLDetailsElement).open,
      false,
    );
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
    await settle(() => button('Read again').click());
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
    speechFails = true;
    await settle(() => button('Ask VSual').click());
    assert.equal(spoken.length, 2);
    assert.match(spoken[1]!.text, /150, or 12\.5%/);
    assert.ok(dom.window.document.body.textContent?.includes(spoken[1]!.text));
    assert.ok(
      dom.window.document.body.textContent?.includes(
        'ElevenLabs reported insufficient credits or allowance for this request.',
      ),
    );
    assert.ok(
      playback.releases > 0,
      'Changing the answer releases its previous audio',
    );
    await settle(() => openDisclosure('View evidence'));
    assert.ok(
      dom.window.document.body.textContent?.includes(
        'ElevenLabs reported insufficient credits or allowance for this request.',
      ),
      'Speech errors remain available in the evidence view',
    );
    assert.ok(
      dom.window.document
        .querySelector('table')
        ?.textContent?.includes('1,050'),
    );
    await settle(() => button('Close evidence').click());

    // Stop also remains available when synthesis is pending in either source view.
    speechFails = false;
    holdSpeech = true;
    await settle(() => button('Retry speech').click());
    assert.equal(spoken.length, 3);
    await settle(() => openDisclosure('View evidence'));
    assert.equal(
      dom.window.document.activeElement,
      disclosure('View evidence'),
    );
    assert.equal(
      (disclosure('View evidence').parentElement as HTMLDetailsElement).open,
      true,
    );
    assertSingleStop();
    assert.equal(button('Stop speech').disabled, false);
    assert.ok(
      dom.window.document.body.textContent?.includes('Preparing audio.'),
    );
    await settle(() => openDisclosure('Inspect the source table without AI'));
    assert.equal(
      dom.window.document.activeElement,
      disclosure('Inspect the source table without AI'),
    );
    assertSingleStop();
    assert.ok(
      dom.window.document.body.textContent?.includes('Preparing audio.'),
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
    await settle(() => button('Close evidence').click());
    assert.equal(
      dom.window.document.activeElement,
      disclosure('View evidence'),
    );
    assert.equal(
      (disclosure('View evidence').parentElement as HTMLDetailsElement).open,
      false,
    );
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
            answer_language: 'en',
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
        ?.textContent?.includes('12.5%') ?? false,
      false,
    );
    assert.ok(textarea.value.length > 0, 'Cancellation preserves the question');
    holdRequest = false;
    await settle(() => button('Ask VSual').click());
    await settle(() => button('Go to answer').click());
    assert.equal(dom.window.document.activeElement?.id, 'answer-heading');
    await settle(() => button('Ask another question').click());
    assert.equal(dom.window.document.activeElement, textarea);
    const beforeNavigation = submissions.length;
    await settle(() => {
      tab.url = 'http://127.0.0.1:3000/voice';
      updatedListeners.forEach((listener) =>
        listener(tab.id, { url: tab.url }),
      );
    });
    assert.equal(
      submissions.length,
      beforeNavigation,
      'Navigation cannot submit automatically',
    );
    assert.equal(
      dom.window.document.querySelector('#answer-heading'),
      null,
      'Old answer clears on unsupported navigation',
    );

    // A fresh panel with no preference defaults ON only after preference loading.
    // Strict Mode exercises effect setup/cleanup without creating a second request.
    const supersededSpeech = pendingSpeech as ((audio: Blob) => void) | null;
    await settle(() => root.render(null));
    dom.window.localStorage.clear();
    tab.url = 'http://127.0.0.1:3000/orders';
    const renderAutomatic = (
      language: 'en' | 'vi' = 'en',
      sessionKey = baseProps.sessionKey,
    ) =>
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(GroundedPanel, {
            ...baseProps,
            language,
            sessionKey,
            key: sessionKey,
          }),
        ),
      );
    const requestsBeforeOpen = spoken.length;
    await settle(() => renderAutomatic());
    assert.equal(
      spoken.length,
      requestsBeforeOpen,
      'Opening the panel cannot generate speech',
    );
    const speechToggle = dom.window.document.querySelector<HTMLInputElement>(
      '#answer-speech-enabled',
    )!;
    assert.equal(
      speechToggle.checked,
      true,
      'No stored preference defaults speech ON',
    );
    await settle(() => button('Allow page processing').click());
    await settle(() => button('Use example question').click());
    const questionWithFocus = dom.window.document.activeElement;
    const playsBeforeAnswer = playback.plays;
    await settle(() => button('Ask VSual').click());
    assert.equal(
      spoken.length,
      requestsBeforeOpen + 1,
      'One new answer reserves one automatic request',
    );
    const visibleAnswer =
      dom.window.document.querySelector<HTMLElement>('.answer-text')!;
    assert.ok(visibleAnswer.textContent?.includes('150, or 12.5%'));
    assert.equal(visibleAnswer.lang, 'en');
    assert.equal(dom.window.document.activeElement, questionWithFocus);
    assert.equal(
      playback.plays,
      playsBeforeAnswer,
      'The answer is displayed while audio is still preparing',
    );
    assert.equal(
      visibleAnswer.closest(
        '[aria-live]:not([aria-live="off"]), [role="status"], [role="alert"], [role="log"]',
      ),
      null,
      'The complete answer must not be inside an implicit or explicit live region',
    );
    await settle(() => openDisclosure('View evidence'));
    const evidenceFocus = dom.window.document.activeElement;
    assert.ok(
      dom.window.document
        .querySelector('table')
        ?.textContent?.includes('1,050'),
    );
    await settle(() => renderAutomatic());
    await settle(() => renderAutomatic('vi'));
    assert.equal(
      visibleAnswer.lang,
      'en',
      'The accepted answer keeps its own language',
    );
    assert.equal(visibleAnswer.textContent, spoken.at(-1)!.text);
    assert.equal(dom.window.document.activeElement, evidenceFocus);
    await settle(() => renderAutomatic());
    assert.equal(
      spoken.length,
      requestsBeforeOpen + 1,
      'Renders and interface-language changes cannot repeat TTS',
    );
    if (supersededSpeech)
      await settle(() =>
        supersededSpeech(new Blob(['obsolete'], { type: 'audio/mpeg' })),
      );
    assert.equal(
      playback.plays,
      playsBeforeAnswer,
      'Old disposed-panel audio remains silent',
    );

    // Browser autoplay denial keeps generated audio for a direct user gesture.
    autoplayDenied = true;
    assert.ok(pendingSpeech);
    await settle(() =>
      (pendingSpeech as (audio: Blob) => void)(
        new Blob(['new answer'], { type: 'audio/mpeg' }),
      ),
    );
    assert.ok(
      dom.window.document.body.textContent?.includes(
        'Automatic playback was blocked. Select Play answer.',
      ),
    );
    assert.equal(
      dom.window.document.activeElement,
      evidenceFocus,
      'A playback failure does not steal focus',
    );
    const playAnswer = button('Play answer');
    const deniedAttempts = playback.plays;
    autoplayDenied = false;
    await settle(() => {
      playAnswer.focus();
      playAnswer.click();
      playAnswer.click();
      playAnswer.click();
    });
    assert.equal(
      playback.plays,
      deniedAttempts + 1,
      'Rapid Play clicks start one player',
    );
    assert.equal(
      spoken.length,
      requestsBeforeOpen + 1,
      'Play after denial uses cached audio',
    );
    assert.equal(
      button('Stop speech'),
      playAnswer,
      'The playback control remains the same DOM element',
    );
    assert.equal(dom.window.document.activeElement, playAnswer);
    assert.equal(playback.rates.at(-1), 0.9);
    await settle(() => playAnswer.click());
    assert.equal(button('Read again'), playAnswer);
    assert.equal(
      dom.window.document.activeElement,
      playAnswer,
      'Stop preserves keyboard focus',
    );
    await settle(() => playAnswer.click());
    assert.equal(spoken.length, requestsBeforeOpen + 1);

    // OFF stops active speech. Neither OFF -> ON nor a new OFF answer auto-plays.
    const pausesBeforeOff = playback.pauses;
    await settle(() => speechToggle.click());
    assert.ok(playback.pauses > pausesBeforeOff);
    const pausedPlayCount = playback.plays;
    const mutedRead = button('Read again');
    assert.equal(mutedRead.disabled, true);
    await settle(() => mutedRead.click());
    assert.equal(playback.plays, pausedPlayCount);
    assert.ok(
      dom.window.document.body.textContent?.includes('App speech is off.'),
    );
    await settle(() => speechToggle.click());
    assert.equal(
      playback.plays,
      pausedPlayCount,
      'Turning ON does not replay the previous answer',
    );
    await settle(() => speechToggle.click());
    await settle(() => button('Ask VSual').click());
    assert.equal(
      spoken.length,
      requestsBeforeOpen + 1,
      'An OFF answer does not request synthesis',
    );
    await settle(() => speechToggle.click());
    assert.equal(
      spoken.length,
      requestsBeforeOpen + 1,
      'Turning ON does not synthesize the displayed OFF answer',
    );
    assert.equal(button('Read answer').disabled, false);

    // Explicit Read can generate this answer. Stop must invalidate its late audio.
    await settle(() => button('Read answer').click());
    assert.equal(spoken.length, requestsBeforeOpen + 2);
    const pendingRead = pendingSpeech as ((audio: Blob) => void) | null;
    const generatingControl = button('Stop speech');
    await settle(() => {
      generatingControl.focus();
      generatingControl.click();
    });
    assert.equal((speechSignal as AbortSignal | null)?.aborted, true);
    assert.equal(dom.window.document.activeElement, generatingControl);
    assert.equal(button('Read answer'), generatingControl);
    assert.ok(pendingRead);
    await settle(() =>
      pendingRead(new Blob(['cancelled'], { type: 'audio/mpeg' })),
    );
    assert.equal(playback.plays, pausedPlayCount);
    assert.ok(dom.window.document.querySelector('.answer-text'));

    // Closing and reopening clears transient answers/audio without replaying them.
    await settle(() => root.render(null));
    const speechBeforeReopen = spoken.length;
    const playsBeforeReopen = playback.plays;
    await settle(() => renderAutomatic());
    assert.equal(dom.window.document.querySelector('.answer-text'), null);
    assert.equal(spoken.length, speechBeforeReopen);
    assert.equal(playback.plays, playsBeforeReopen);
    assert.equal(
      dom.window.document.querySelector<HTMLInputElement>(
        '#answer-speech-enabled',
      )?.checked,
      true,
    );

    // The API's resolved answer locale controls text and speech independently
    // of the interface. The final reviewed draft remains the submitted input.
    holdSpeech = false;
    responseLanguage = 'vi';
    await settle(() => button('Allow page processing').click());
    await settle(() => renderAutomatic('vi'));
    await settle(() => button('Dùng câu hỏi mẫu').click());
    const reviewedVietnamese =
      dom.window.document.querySelector('textarea')!.value;
    await settle(() => renderAutomatic());
    await settle(() => button('Ask VSual').click());
    assert.equal(submissions.at(-1)!.question, reviewedVietnamese);
    assert.equal(spoken.at(-1)!.language, 'vi');
    const vietnameseAnswer =
      dom.window.document.querySelector<HTMLElement>('.answer-text')!;
    assert.equal(vietnameseAnswer.lang, 'vi');
    assert.equal(vietnameseAnswer.textContent, spoken.at(-1)!.text);
    assert.equal(
      vietnameseAnswer.closest('.grounded-panel')?.getAttribute('lang'),
      'en',
    );
    assert.ok(
      dom.window.document
        .querySelector('table')
        ?.textContent?.includes('1,050'),
      'Source evidence values remain unchanged',
    );

    // Clarifications and normal unsupported answers also speak their readable
    // validated text, without requiring an evidence collection to exist.
    for (const kind of ['clarification', 'unsupported'] as const) {
      responseKind = kind;
      const beforeResponse: number = spoken.length;
      await settle(() => button('Ask VSual').click());
      assert.equal(spoken.length, beforeResponse + 1);
      assert.equal(
        dom.window.document.querySelector('.answer-text')?.textContent,
        spoken.at(-1)!.text,
      );
      assert.equal(
        dom.window.document.querySelector('.evidence-disclosure'),
        null,
      );
      assert.equal(button('Stop speech').disabled, false);
    }

    // Exercise the real question surface/controller using local activity events
    // and an advancing monotonic clock. No microphone or provider is contacted.
    await settle(() => root.render(null));
    const { browserDependencies } = await import('@adc/voice-ui');
    let clock = 0;
    let timerId = 0;
    const timers = new Map<number, { due: number; callback: () => void }>();
    let activity: (() => void) | null = null;
    let stoppedTracks = 0;
    let stoppedObservers = 0;
    let recorder: Recorder | null = null;
    assert.ok(browserDependencies.now);
    assert.ok(browserDependencies.observeAudioActivity);
    const activityDependencies = browserDependencies as Required<
      Pick<VoiceDependencies, 'now' | 'observeAudioActivity'>
    >;
    mock.method(activityDependencies, 'now', () => clock);
    mock.method(
      browserDependencies,
      'schedule',
      (callback: () => void, delay: number) => {
        const id = ++timerId;
        timers.set(id, { due: clock + delay, callback });
        return id;
      },
    );
    mock.method(browserDependencies, 'unschedule', (id: unknown) => {
      timers.delete(id as number);
    });
    mock.method(browserDependencies, 'getMicrophone', async () => ({
      getTracks: () => [{ stop: () => stoppedTracks++ }],
    }));
    mock.method(
      activityDependencies,
      'observeAudioActivity',
      async (_stream: MicrophoneStream, onActivity: () => void) => {
        activity = onActivity;
        return () => {
          activity = null;
          stoppedObservers++;
        };
      },
    );
    mock.method(browserDependencies, 'createRecorder', () => {
      let recording = false;
      const next: Recorder = {
        mimeType: 'audio/webm;codecs=opus',
        get state() {
          return recording ? 'recording' : 'inactive';
        },
        ondata() {},
        onstop() {},
        onerror() {},
        start() {
          recording = true;
        },
        stop() {
          recording = false;
          next.ondata(
            new Blob(['final recorded chunk'], { type: next.mimeType }),
          );
          next.onstop();
        },
      };
      recorder = next;
      return next;
    });
    function advance(milliseconds: number) {
      const until = clock + milliseconds;
      while (true) {
        const due = [...timers.entries()]
          .filter(([, value]) => value.due <= until)
          .sort((a, b) => a[1].due - b[1].due)[0];
        if (!due) break;
        clock = due[1].due;
        timers.delete(due[0]);
        due[1].callback();
      }
      clock = until;
    }
    function reportActivity() {
      assert.ok(activity, 'The active recording owns an activity observer');
      activity();
    }
    recordedMode = true;
    responseKind = 'comparison';
    responseLanguage = 'en';
    await settle(() => renderAutomatic());
    await settle(() => button('Allow page processing').click());
    const beforeSilenceAsk = submissions.length;
    const beforeSilenceSpeech = spoken.length;
    const beforeSilencePlay = playback.plays;
    await settle(() => button('Record question').click());
    assert.equal((recorder as Recorder | null)?.state, 'recording');
    await settle(() => advance(6000));
    assert.equal(transcriptCalls, 0, 'Silence before any speech cannot submit');
    await settle(reportActivity);
    const countdown = dom.window.document.querySelector(
      '.voice-silence-countdown',
    );
    assert.ok(countdown);
    assert.match(countdown.textContent ?? '', /5/);
    assert.equal(
      countdown.closest(
        '[aria-live]:not([aria-live="off"]), [role="status"], [role="alert"], [role="log"]',
      ),
      null,
      'Each countdown tick stays out of automatic screen-reader announcements',
    );
    await settle(() => advance(4000));
    assert.equal(transcriptCalls, 0);
    await settle(reportActivity);
    await settle(() => advance(4000));
    assert.equal(
      transcriptCalls,
      0,
      'Continued speech resets the full silence window',
    );
    await settle(() => advance(1000));
    assert.equal(transcriptCalls, 1);
    assert.equal(submissions.length, beforeSilenceAsk + 1);
    assert.equal(submissions.at(-1)?.question, transcriptText);
    assert.equal(spoken.length, beforeSilenceSpeech + 1);
    assert.equal(playback.plays, beforeSilencePlay + 1);
    assert.ok(stoppedTracks > 0);
    assert.ok(stoppedObservers > 0);
    assert.equal(activity, null);
    await settle(() => renderAutomatic('vi'));
    await settle(() => renderAutomatic());
    await settle(() => advance(10_000));
    assert.equal(
      submissions.length,
      beforeSilenceAsk + 1,
      'Rerenders cannot resubmit the recognised question',
    );
    assert.equal(
      spoken.length,
      beforeSilenceSpeech + 1,
      'One silence turn produces one answer audio',
    );

    // Manual stop leaves the recognised text editable; typed changes remain
    // explicit submissions even though this surface supports silent finishing.
    const beforeManual = submissions.length;
    await settle(() => button('Record question').click());
    await settle(reportActivity);
    await settle(() => button('Stop and review').click());
    assert.equal(transcriptCalls, 2);
    assert.equal(submissions.length, beforeManual);
    assert.equal(
      dom.window.document.querySelector('textarea')?.value,
      transcriptText,
    );
    await settle(() => button('Use example question').click());
    await settle(() => advance(6000));
    assert.equal(
      submissions.length,
      beforeManual,
      'Editing a draft never starts a timer or submits',
    );
    await settle(() => button('Ask VSual').click());
    assert.equal(submissions.length, beforeManual + 1);

    const beforeDuration = submissions.length;
    await settle(() => button('Record question').click());
    await settle(() => advance(30_000));
    assert.equal(transcriptCalls, 3);
    assert.equal(
      submissions.length,
      beforeDuration,
      'The recording duration cap remains review-only',
    );
    assert.equal(
      dom.window.document.querySelector('textarea')?.value,
      transcriptText,
    );

    // Cancelling while STT is pending consumes the silence intent permanently.
    holdTranscript = true;
    const beforeCancelled = submissions.length;
    await settle(() => button('Record question').click());
    await settle(reportActivity);
    await settle(() => advance(5000));
    assert.ok(pendingTranscript);
    const cancelledTranscript = pendingTranscript as (
      response: TranscriptResponse,
    ) => void;
    const preservedDraft = dom.window.document.querySelector('textarea')!.value;
    await settle(() => button('Cancel operation').click());
    assert.equal((transcriptSignal as AbortSignal | null)?.aborted, true);
    await settle(() =>
      cancelledTranscript({
        transcript: 'A late cancelled question must not be sent.',
        request_id: crypto.randomUUID(),
      }),
    );
    assert.equal(submissions.length, beforeCancelled);
    assert.equal(
      dom.window.document.querySelector('textarea')!.value,
      preservedDraft,
    );

    // Source invalidation and account replacement cancel the pending transcript
    // at the panel boundary, before it can become a fresh automatic question.
    const beforeContextChange = submissions.length;
    await settle(() => button('Record question').click());
    await settle(reportActivity);
    await settle(() => advance(5000));
    assert.ok(pendingTranscript);
    const contextTranscript = pendingTranscript as (
      response: TranscriptResponse,
    ) => void;
    await settle(() => {
      tab.url = 'http://127.0.0.1:3000/voice';
      updatedListeners.forEach((listener) =>
        listener(tab.id, { url: tab.url }),
      );
    });
    assert.equal((transcriptSignal as AbortSignal | null)?.aborted, true);
    await settle(() =>
      contextTranscript({
        transcript: 'A question from the previous page.',
        request_id: crypto.randomUUID(),
      }),
    );
    assert.equal(submissions.length, beforeContextChange);
    assert.equal(
      dom.window.document.querySelector('textarea')!.value,
      preservedDraft,
    );
    await settle(() => {
      tab.url = 'http://127.0.0.1:3000/orders';
      updatedListeners.forEach((listener) =>
        listener(tab.id, { url: tab.url }),
      );
    });
    await settle(() => button('Allow page processing').click());
    await settle(() => button('Record question').click());
    await settle(reportActivity);
    await settle(() => advance(5000));
    assert.ok(pendingTranscript);
    const accountTranscript = pendingTranscript as (
      response: TranscriptResponse,
    ) => void;
    const audioBeforeAccountChange = spoken.length;
    await settle(() => renderAutomatic('en', 'synthetic-other-user'));
    assert.equal((transcriptSignal as AbortSignal | null)?.aborted, true);
    await settle(() =>
      accountTranscript({
        transcript: 'A private question from the previous account.',
        request_id: crypto.randomUUID(),
      }),
    );
    assert.equal(submissions.length, beforeContextChange);
    assert.equal(spoken.length, audioBeforeAccountChange);
    assert.equal(dom.window.document.querySelector('textarea')!.value, '');
    assert.equal(dom.window.document.querySelector('.answer-text'), null);
    await settle(() => button('Allow page processing').click());

    // Empty recognition and missing page permission never become protected asks.
    holdTranscript = false;
    transcriptText = '   ';
    const beforeEmpty = submissions.length;
    await settle(() => button('Record question').click());
    await settle(reportActivity);
    await settle(() => advance(5000));
    assert.equal(submissions.length, beforeEmpty);
    assert.equal(button('Ask VSual').disabled, true);
    assert.match(
      dom.window.document.body.textContent ?? '',
      /No speech recognised/,
    );
    await settle(() => button('Cancel / withdraw permission').click());
    transcriptText = 'Compare July and August without page permission.';
    const beforeNoConsent = submissions.length;
    const capturesBeforeNoConsent = captures;
    const speechBeforeNoConsent = spoken.length;
    await settle(() => button('Record question').click());
    await settle(reportActivity);
    await settle(() => advance(5000));
    assert.equal(submissions.length, beforeNoConsent);
    assert.equal(captures, capturesBeforeNoConsent);
    assert.equal(spoken.length, speechBeforeNoConsent);
    assert.equal(
      dom.window.document.querySelector('textarea')?.value,
      transcriptText,
    );
    function heldExplanation(reason: string) {
      const explanation = [...dom.window.document.querySelectorAll('p')].find(
        (element) => element.textContent?.includes(reason),
      );
      assert.ok(
        explanation,
        `Explain why the recorded question was held: ${reason}`,
      );
      assert.equal(
        explanation.closest(
          '[aria-live]:not([aria-live="off"]), [role="status"], [role="alert"], [role="log"]',
        ),
        null,
        'Detailed recovery instructions remain readable outside the concise live announcement',
      );
      return explanation.textContent ?? '';
    }
    assert.match(
      heldExplanation('page-processing permission is missing'),
      /question was not sent.*Allow page processing, review the transcript, then select Ask VSual.*Granting permission will not send it automatically/,
    );
    assert.ok(
      [...dom.window.document.querySelectorAll('[role="status"]')].some(
        (element) =>
          element.textContent ===
          'Transcript ready. The question was not sent; see the explanation below.',
      ),
      'Announce that transcription succeeded but submission did not happen',
    );
    await settle(() => renderAutomatic('vi', 'synthetic-other-user'));
    assert.match(
      heldExplanation('chưa có quyền xử lý trang'),
      /chưa gửi câu hỏi.*Cho phép xử lý trang, kiểm tra văn bản rồi chọn Hỏi VSual.*không tự gửi/,
    );
    assert.equal(submissions.length, beforeNoConsent);
    assert.equal(spoken.length, speechBeforeNoConsent);
    await settle(() => renderAutomatic('en', 'synthetic-other-user'));
    await settle(() => button('Allow page processing').click());
    assert.equal(
      submissions.length,
      beforeNoConsent,
      'Later consent cannot revive a blocked automatic ask',
    );
    assert.equal(spoken.length, speechBeforeNoConsent);

    // Unsupported-page recordings also retain the transcript and explain the
    // required return to a supported source rather than appearing to submit.
    await settle(() => {
      tab.url = 'http://127.0.0.1:3000/voice';
      updatedListeners.forEach((listener) =>
        listener(tab.id, { url: tab.url }),
      );
    });
    transcriptText = 'Compare July and August after returning to orders.';
    await settle(() => button('Record question').click());
    await settle(reportActivity);
    await settle(() => advance(5000));
    assert.equal(submissions.length, beforeNoConsent);
    assert.equal(captures, capturesBeforeNoConsent);
    assert.equal(spoken.length, speechBeforeNoConsent);
    assert.equal(
      dom.window.document.querySelector('textarea')?.value,
      transcriptText,
    );
    assert.match(
      heldExplanation('a supported orders page could not be confirmed'),
      /question was not sent.*Open the configured orders dashboard, check the active page and its permission, then select Ask VSual/,
    );
    assert.equal(button('Ask VSual').disabled, true);
    await settle(() => {
      tab.url = 'http://127.0.0.1:3000/orders';
      updatedListeners.forEach((listener) =>
        listener(tab.id, { url: tab.url }),
      );
    });
    await settle(() => button('Allow page processing').click());
    assert.equal(submissions.length, beforeNoConsent);
    assert.equal(spoken.length, speechBeforeNoConsent);

    // App request budgets are separate from provider credits. The real
    // transport parses server-owned counters and the UI keeps detailed usage
    // readable without announcing the entire quota block as a live update.
    function assertUsageDetails(operation: RegExp) {
      const notice = dom.window.document.querySelector('.usage-limit-notice');
      assert.ok(notice, 'Show the server usage details for an app limit');
      assert.match(notice.querySelector('h3')?.textContent ?? '', operation);
      assert.match(notice.textContent ?? '', /24\s*\/\s*24/);
      assert.match(notice.textContent ?? '', /73\s*\/\s*240/);
      assert.equal(notice.querySelector('time')?.dateTime, usageLimit.retry_at);
      assert.equal(
        notice.closest(
          '[aria-live]:not([aria-live="off"]), [role="status"], [role="alert"], [role="log"]',
        ),
        null,
        'Detailed counts and retry timestamp are not one large announcement',
      );
      assert.doesNotMatch(
        [...dom.window.document.querySelectorAll('[role="status"]')]
          .map((element) => element.textContent)
          .join(' '),
        /24\s*\/\s*24|73\s*\/\s*240/,
      );
      return notice;
    }
    answerLimited = true;
    const voiceCallsBeforeAnswerLimit = spoken.length;
    await settle(() => button('Ask VSual').click());
    const answerUsage = assertUsageDetails(/Answer: VSual/);
    assert.match(
      answerUsage.textContent ?? '',
      /Provider credits are separate and are not shown here/,
    );
    assert.match(answerUsage.textContent ?? '', /Estimated retry from:/);
    assert.equal(spoken.length, voiceCallsBeforeAnswerLimit);
    assert.equal(dom.window.document.querySelector('.answer-text'), null);
    assert.equal(
      dom.window.document.querySelector('textarea')?.value,
      transcriptText,
    );
    await settle(() => renderAutomatic('vi', 'synthetic-other-user'));
    const vietnameseUsage = assertUsageDetails(/Câu trả lời:.*VSual/);
    assert.match(
      vietnameseUsage.textContent ?? '',
      /Hạn mức của nhà cung cấp là riêng biệt/,
    );
    assert.doesNotMatch(
      vietnameseUsage.textContent ?? '',
      /Try again|request limit/i,
    );
    await settle(() => renderAutomatic('en', 'synthetic-other-user'));

    answerLimited = false;
    holdRequest = true;
    await settle(() => button('Ask VSual').click());
    assert.equal(
      dom.window.document.querySelector('.usage-limit-notice'),
      null,
      'Starting a new answer request removes the previous limit details',
    );
    assert.ok(pendingFetch);
    const limitedAnswerRequest = submissions.at(-1)!;
    speechUsageLimited = true;
    await settle(() =>
      (pendingFetch as (response: Response) => void)(
        Response.json(
          calculateComparison(limitedAnswerRequest, {
            answer_language: 'en',
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
    holdRequest = false;
    assertUsageDetails(/Read-back: VSual/);
    const answerWithLimitedSpeech =
      dom.window.document.querySelector('.answer-text')?.textContent;
    assert.ok(answerWithLimitedSpeech);
    assert.ok(dom.window.document.querySelector('.evidence-disclosure table'));
    assert.equal(button('Retry speech').disabled, false);
    assert.equal(button('Ask VSual').disabled, false);
    await settle(() => renderAutomatic('vi', 'synthetic-other-user'));
    assertUsageDetails(/Giọng đọc:.*VSual/);
    assert.equal(
      dom.window.document.querySelector('.answer-text')?.textContent,
      answerWithLimitedSpeech,
    );
    await settle(() => renderAutomatic('en', 'synthetic-other-user'));

    speechUsageLimited = false;
    speechFails = true;
    speechFailureCode = 'PROVIDER_RATE_LIMITED';
    await settle(() => button('Retry speech').click());
    assert.equal(
      dom.window.document.querySelector('.usage-limit-notice'),
      null,
    );
    assert.equal(
      dom.window.document.querySelector('.answer-text')?.textContent,
      answerWithLimitedSpeech,
    );
    assert.match(
      dom.window.document.querySelector('.answer-section [role="status"]')
        ?.textContent ?? '',
      /text answer is available.*audio could not.*ElevenLabs temporarily limited.*No exact retry time/,
      'A provider throttle is distinct from a counted VSual application limit',
    );
    speechFails = false;
    holdSpeech = true;
    await settle(() => button('Retry speech').click());
    assert.equal(
      dom.window.document.querySelector('.usage-limit-notice'),
      null,
    );
    assert.equal(
      dom.window.document.querySelector('.answer-text')?.textContent,
      answerWithLimitedSpeech,
    );
    assert.ok(pendingSpeech);
    await settle(() =>
      (pendingSpeech as (audio: Blob) => void)(
        new Blob(['retry'], { type: 'audio/mpeg' }),
      ),
    );
    assert.equal(
      dom.window.document.querySelector('.usage-limit-notice'),
      null,
    );
    holdSpeech = false;
    speechUsageLimited = true;
    await settle(() => button('Ask VSual').click());
    assert.ok(dom.window.document.querySelector('.usage-limit-notice'));
    await settle(() => renderAutomatic('en', 'synthetic-limit-free-session'));
    assert.equal(
      dom.window.document.querySelector('.usage-limit-notice'),
      null,
    );
    assert.equal(dom.window.document.querySelector('.answer-text'), null);
    assert.equal(dom.window.document.querySelector('textarea')?.value, '');
  } finally {
    await act(async () => root.unmount());
    mock.restoreAll();
    dom.window.close();
    hook.deregister();
    for (const [key, descriptor] of replaced) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
