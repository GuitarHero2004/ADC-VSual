import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { act, createElement } from 'react';
import { JSDOM } from 'jsdom';
import ts from 'typescript';
import {
  fingerprintSnapshot,
  type AuthPanelMessage,
  type AuthStatus,
  type GroundedRequest,
  type GroundedSnapshot,
} from '@adc/contracts';
import type {
  Recorder,
  VoiceDependencies,
} from '../../../packages/voice-ui/src/controller.ts';
import { calculateComparison } from '../../web/utils/grounded/comparison.ts';

test('actual floating App starts as an idle launcher and preserves work when opening and collapsing', async (t) => {
  const environment = {
    VITE_API_BASE_URL: 'http://127.0.0.1:3000',
    VITE_SUPABASE_URL: 'https://auth.example.test',
    VITE_SUPABASE_PUBLISHABLE_KEY: ['sb', 'publishable', 'fixture'].join('_'),
  };
  const hook = registerHooks({
    load(url, context, next) {
      if (url.endsWith('.css'))
        return { format: 'module', shortCircuit: true, source: '' };
      if (!url.endsWith('.tsx') && !url.endsWith('/config.ts'))
        return next(url, context);
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
            `(${JSON.stringify(environment)})`,
          ),
      };
    },
  });
  const dom = new JSDOM(
    '<button id="outside">Existing page control</button><div id="root"></div>',
    {
      url: 'https://extension.example.test/floating.html',
      pretendToBeVisual: true,
    },
  );
  const originals = new Map<string, PropertyDescriptor | undefined>();
  function expose(key: string, value: unknown) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
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
    'location',
    'localStorage',
    'sessionStorage',
    'HTMLElement',
    'HTMLTextAreaElement',
  ] as const)
    expose(key, dom.window[key]);
  expose('getComputedStyle', dom.window.getComputedStyle.bind(dom.window));
  dom.window.document.documentElement.style.fontSize = '16px';
  expose('IS_REACT_ACT_ENVIRONMENT', true);
  expose(
    'BroadcastChannel',
    class {
      onmessage: unknown;
      postMessage() {}
      close() {}
    },
  );
  expose(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  const noEvents = { addListener() {}, removeListener() {} };
  const status: AuthStatus = {
    phase: 'signed_in',
    account: { id: crypto.randomUUID(), email: 'member@example.test' },
    workspace: 'allowed',
    epoch: crypto.randomUUID(),
    attempt: null,
    error: null,
    logoutConfirmed: null,
  };
  const authCalls: AuthPanelMessage[] = [];
  expose('chrome', {
    runtime: {
      async sendMessage(message: AuthPanelMessage) {
        authCalls.push(message);
        return {
          ok: true,
          status,
          ...(message.type === 'auth:headers'
            ? { headers: { Authorization: 'Bearer synthetic-session' } }
            : {}),
        };
      },
      getURL(path: string) {
        return `https://extension.example.test/${path}`;
      },
      lastError: undefined,
    },
    commands: {
      async getAll() {
        return [{ name: 'toggle-voice', shortcut: 'Ctrl+Shift+Y' }];
      },
    },
    storage: { onChanged: noEvents },
    tabs: { async create() {} },
    sidePanel: { async open() {} },
  });
  dom.window.localStorage.setItem(
    'vsual:answer-preferences',
    JSON.stringify({ speechEnabled: false }),
  );
  const source: GroundedSnapshot = {
    snapshot_id: crypto.randomUUID(),
    document_key: crypto.randomUUID(),
    adapter_key: 'orders-fixture@1',
    captured_at: new Date().toISOString(),
    origin: 'http://127.0.0.1:3000',
    pathname: '/orders',
    title: 'Sample orders',
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
  const hostMessages: Record<string, unknown>[] = [];
  const messages = new Set<(value: unknown) => void>();
  let captures = 0;
  const port = {
    onMessage: {
      addListener(listener: (value: unknown) => void) {
        messages.add(listener);
      },
      removeListener(listener: (value: unknown) => void) {
        messages.delete(listener);
      },
    },
    onDisconnect: noEvents,
    disconnect() {},
    postMessage(value: Record<string, unknown>) {
      hostMessages.push(value);
      let reply: unknown;
      if (value.type === 'orders:capture') {
        captures++;
        reply = {
          type: 'orders:result',
          id: value.id,
          snapshot: { ...source, snapshot_id: crypto.randomUUID() },
        };
      } else if (value.type === 'orders:verify')
        reply = { type: 'orders:verified', id: value.id, current: true };
      if (reply)
        queueMicrotask(() => messages.forEach((listener) => listener(reply)));
    },
  } as unknown as chrome.runtime.Port;
  const { FloatingClient } = await import('./floating-client.ts');
  const floating = new FloatingClient(port, {
    supported: true,
    origin: source.origin,
    pathname: '/orders',
    tabId: 1,
    windowId: 2,
    reason: null,
  });
  const { browserDependencies } = await import('@adc/voice-ui');
  let microphoneCalls = 0;
  let stoppedTracks = 0;
  t.mock.method(browserDependencies, 'getMicrophone', async () => {
    microphoneCalls++;
    return {
      getTracks: () => [
        {
          stop: () => {
            stoppedTracks++;
          },
        },
      ],
    };
  });
  const observer = browserDependencies as Required<
    Pick<VoiceDependencies, 'observeAudioActivity'>
  >;
  t.mock.method(observer, 'observeAudioActivity', async () => () => {});
  t.mock.method(browserDependencies, 'createRecorder', (): Recorder => {
    let active = false;
    const recorder: Recorder = {
      mimeType: 'audio/webm',
      get state() {
        return active ? 'recording' : 'inactive';
      },
      ondata() {},
      onstop() {},
      onerror() {},
      start() {
        active = true;
      },
      stop() {
        active = false;
        recorder.ondata(new Blob(['final chunk']));
        recorder.onstop();
      },
    };
    return recorder;
  });
  const audio = { plays: 0, pauses: 0 };
  t.mock.method(browserDependencies, 'createObjectURL', () => 'blob:launcher');
  t.mock.method(browserDependencies, 'revokeObjectURL', () => {});
  t.mock.method(browserDependencies, 'createPlayback', () => ({
    currentTime: 0,
    playbackRate: 1,
    onended: null,
    onerror: null,
    async play() {
      audio.plays++;
    },
    pause() {
      audio.pauses++;
    },
    release() {},
  }));
  const network = { questions: 0, transcription: 0, speech: 0 };
  t.mock.method(
    globalThis,
    'fetch',
    async (url: RequestInfo | URL, options?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      if (path === '/api/voice/transcribe') {
        network.transcription++;
        return Response.json({
          transcript: 'Compare July and August orders.',
          request_id: crypto.randomUUID(),
        });
      }
      if (path === '/api/voice/speak') {
        network.speech++;
        return new Response(new Blob(['mp3'], { type: 'audio/mpeg' }), {
          headers: { 'Content-Type': 'audio/mpeg' },
        });
      }
      assert.equal(path, '/api/grounded-read');
      network.questions++;
      const request = JSON.parse(String(options?.body)) as GroundedRequest;
      return Response.json(
        calculateComparison(request, {
          answer_language: 'en',
          decision: 'comparison',
          operation: 'compare',
          metric: 'completed_orders',
          region: 'South',
          baseline_period: '2026-07',
          comparison_period: '2026-08',
          reason: null,
        }),
      );
    },
  );
  const { App } = await import('./App.tsx');
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root')!);
  const document = dom.window.document;
  const settle = async (action: () => void) =>
    act(async () => {
      action();
      await new Promise<void>((resolve) => setImmediate(resolve));
      await new Promise<void>((resolve) => setImmediate(resolve));
    });
  function visible(element: Element) {
    return !element.closest('[hidden]');
  }
  function button(name: string) {
    const found = [...document.querySelectorAll('button')].find(
      (element) =>
        visible(element) &&
        (element.getAttribute('aria-label') ?? element.textContent) === name,
    );
    assert.ok(found, `Missing visible button: ${name}`);
    return found;
  }
  const launcher = () => {
    const value =
      document.querySelector<HTMLButtonElement>('#floating-launcher');
    assert.ok(value && visible(value), 'The idle launcher must be visible');
    return value;
  };
  try {
    const outside = document.getElementById('outside')!;
    outside.focus();
    await settle(() =>
      root.render(
        createElement<{ floating: InstanceType<typeof FloatingClient> }>(App, {
          floating,
        }),
      ),
    );
    assert.equal(launcher().getAttribute('aria-label'), 'Open VSual companion');
    assert.equal(launcher().getAttribute('aria-expanded'), 'false');
    assert.equal(launcher().getAttribute('aria-controls'), 'floating-expanded');
    assert.equal(
      document.activeElement,
      outside,
      'Idle startup must not steal focus',
    );
    assert.equal(
      document.querySelector<HTMLElement>('#floating-expanded')!.hidden,
      true,
    );
    assert.equal(
      [...document.querySelectorAll('.floating-toolbar')].some(visible),
      false,
    );
    assert.deepEqual(network, { questions: 0, transcription: 0, speech: 0 });
    assert.equal(microphoneCalls, 0);
    assert.equal(captures, 0);
    assert.deepEqual(
      authCalls.map((call) => call.type),
      ['auth:status'],
    );
    assert.ok(
      hostMessages.some(
        (message) =>
          message.type === 'floating:layout' && message.launcher === true,
      ),
    );

    await settle(() => {
      launcher().focus();
      launcher().click();
    });
    const textarea = document.querySelector<HTMLTextAreaElement>(
      '#companion-content textarea',
    )!;
    assert.equal(
      document.activeElement,
      textarea,
      'An explicit opening focuses the question',
    );
    await settle(() => button('Allow page processing').click());
    await settle(() => button('Use example question').click());
    const draft = textarea.value;
    await settle(() => button('Collapse companion').click());
    assert.equal(
      document.activeElement,
      launcher(),
      'Collapse returns focus to the launcher',
    );
    await settle(() => launcher().click());
    assert.equal(document.querySelector('textarea'), textarea);
    assert.equal(textarea.value, draft);
    assert.equal(captures, 0);
    await settle(() => button('Ask VSual').click());
    const answer = document.querySelector('.answer-text')!;
    assert.match(answer.textContent!, /decreased by 300, or 25%/);
    assert.equal(network.questions, 1);
    assert.equal(network.speech, 0, 'Saved Speech OFF remains respected');
    await settle(() => button('Collapse companion').click());
    assert.equal(document.activeElement, launcher());
    await settle(() => launcher().click());
    assert.equal(document.querySelector('.answer-text'), answer);
    assert.equal(textarea.value, draft);
    assert.equal(captures, 1);
    assert.equal(network.questions, 1);

    // Active capture retains reachable controls instead of shrinking into an idle launcher.
    await settle(() => button('Record question').click());
    assert.equal(microphoneCalls, 1);
    await settle(() => button('Collapse companion').click());
    assert.equal(
      document.querySelector('#floating-launcher')?.closest('[hidden]') !==
        null || !document.querySelector('#floating-launcher'),
      true,
    );
    assert.equal(document.activeElement, button('Expand companion'));
    const stopRecording = button('Stop and review');
    await settle(() => {
      stopRecording.focus();
      stopRecording.click();
    });
    assert.equal(network.transcription, 1);
    assert.equal(network.questions, 1, 'Manual finish remains review-only');
    assert.equal(
      document.activeElement,
      launcher(),
      'Finishing work restores focus from a hidden compact control',
    );
    assert.ok(stoppedTracks > 0);
    await settle(() => launcher().click());
    assert.equal(document.querySelector('textarea'), textarea);
    assert.equal(textarea.value, 'Compare July and August orders.');
    assert.equal(document.querySelector('.answer-text'), answer);

    // Playback is another active compact state; collapsing cannot regenerate audio.
    await settle(() => button('Settings').click());
    const speechToggle = document.querySelector<HTMLInputElement>(
      '#answer-speech-enabled',
    )!;
    assert.ok(visible(speechToggle));
    await settle(() => speechToggle.click());
    await settle(() => button('Back to companion').click());
    await settle(() => button('Read answer').click());
    assert.equal(network.speech, 1);
    assert.equal(audio.plays, 1);
    await settle(() => button('Collapse companion').click());
    const stopSpeech = button('Stop speech');
    await settle(() => {
      stopSpeech.focus();
      stopSpeech.click();
    });
    assert.equal(document.activeElement, launcher());
    await settle(() => launcher().click());
    await settle(() => button('Read again').click());
    assert.equal(network.speech, 1);
    assert.equal(audio.plays, 2);
    assert.equal(captures, 1);
    const pausesBeforeTabChange = audio.pauses;
    await settle(() => {
      Object.defineProperty(document, 'hidden', {
        configurable: true,
        value: true,
      });
      document.dispatchEvent(new dom.window.Event('visibilitychange'));
    });
    assert.ok(
      audio.pauses > pausesBeforeTabChange,
      'Switching tabs stops speech',
    );
    assert.equal(document.querySelector('.answer-text'), null);
    assert.equal(
      textarea.value,
      '',
      'Hidden-tab cleanup clears transient content',
    );
    await settle(() => {
      Object.defineProperty(document, 'hidden', {
        configurable: true,
        value: false,
      });
      document.dispatchEvent(new dom.window.Event('visibilitychange'));
    });
    assert.equal(
      audio.plays,
      2,
      'Returning to the tab never replays an answer',
    );
    assert.equal(network.speech, 1);
    await settle(() => button('Collapse companion').click());
    assert.equal(document.activeElement, launcher());
    assert.equal(network.questions, 1);
  } finally {
    await act(async () => root.unmount());
    floating.dispose();
    t.mock.restoreAll();
    dom.window.close();
    hook.deregister();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
