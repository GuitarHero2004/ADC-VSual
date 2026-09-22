import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { act, createElement, type ComponentType } from 'react';
import { JSDOM } from 'jsdom';
import ts from 'typescript';
import {
  fingerprintSnapshot,
  type AuthPanelMessage,
  type AuthStatus,
  type GroundedRequest,
  type GroundedSnapshot,
} from '@adc/contracts';
import type { Playback } from '../../../packages/voice-ui/src/controller.ts';
import { calculateComparison } from '../../web/utils/grounded/comparison.ts';
import { FloatingClient } from './floating-client.ts';
import type { FloatingSurfaceMessage } from './floating-protocol.ts';
import type { OrdersPageRequest } from './orders-adapter.ts';

class Events<T extends unknown[]> {
  listeners = new Set<(...args: T) => void>();
  addListener = (listener: (...args: T) => void) =>
    this.listeners.add(listener);
  removeListener = (listener: (...args: T) => void) =>
    this.listeners.delete(listener);
  emit = (...args: T) => {
    for (const listener of this.listeners) listener(...args);
  };
}

test('real floating Apps preserve accepted audio through tab visibility, peer mounting and stable auth updates', async (t) => {
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
  // Two real App trees exercise session effects and cross-surface cancellation.
  // Browser ports, visibility and audio are controlled boundaries, not a claim
  // that JSDOM implements separate extension frames or browser audio policies.
  const dom = new JSDOM('<div id="owner"></div><div id="peer"></div>', {
    url: 'https://extension.example.test/floating.html',
    pretendToBeVisual: true,
  });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const expose = (key: string, value: unknown) => {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  };
  for (const key of [
    'window',
    'document',
    'navigator',
    'location',
    'localStorage',
    'HTMLElement',
    'HTMLTextAreaElement',
  ] as const)
    expose(key, dom.window[key]);
  expose('getComputedStyle', dom.window.getComputedStyle.bind(dom.window));
  expose('IS_REACT_ACT_ENVIRONMENT', true);
  expose(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  const channels = new Set<{
    onmessage: ((event: { data: unknown }) => void) | null;
  }>();
  expose(
    'BroadcastChannel',
    class {
      onmessage: ((event: { data: unknown }) => void) | null = null;
      constructor() {
        channels.add(this);
      }
      postMessage(data: unknown) {
        for (const other of channels)
          if (other !== this) queueMicrotask(() => other.onmessage?.({ data }));
      }
      close() {
        channels.delete(this);
      }
    },
  );
  const storage = new Events<[Record<string, { newValue: unknown }>, string]>();
  let status: AuthStatus = {
    phase: 'signed_in',
    account: { id: crypto.randomUUID(), email: 'member@example.test' },
    workspace: 'allowed',
    epoch: crypto.randomUUID(),
    attempt: null,
    error: null,
    logoutConfirmed: null,
  };
  const publishAuth = () =>
    storage.emit({ 'adc:auth:owner': { newValue: { status } } }, 'session');
  const authCalls: AuthPanelMessage[] = [];
  const browser = {
    runtime: {
      async sendMessage(message: AuthPanelMessage) {
        authCalls.push(message);
        if (message.type === 'auth:logout') {
          status = {
            ...status,
            phase: 'signed_out',
            account: null,
            workspace: 'unknown',
            epoch: crypto.randomUUID(),
            logoutConfirmed: true,
          };
          publishAuth();
        }
        return {
          ok: true,
          status,
          ...(message.type === 'auth:headers'
            ? { headers: { Authorization: `Bearer ${crypto.randomUUID()}` } }
            : {}),
        };
      },
      getURL: (path: string) => `https://extension.example.test/${path}`,
    },
    commands: {
      async getAll() {
        return [{ name: 'toggle-voice', shortcut: 'Alt+Shift+A' }];
      },
    },
    storage: { onChanged: storage },
  } as unknown as typeof chrome;
  expose('chrome', browser);
  const source: GroundedSnapshot = {
    snapshot_id: crypto.randomUUID(),
    document_key: crypto.randomUUID(),
    adapter_key: 'orders-fixture@1',
    captured_at: new Date().toISOString(),
    origin: 'http://127.0.0.1:3000',
    pathname: '/orders',
    title: 'Synthetic orders',
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
  type Peer = {
    tabId: number;
    receive(message: FloatingSurfaceMessage): void;
    client: FloatingClient;
  };
  const peers: Peer[] = [];
  let speechOwner: number | null = null;
  let captures = 0;
  const publishSpeech = () => {
    for (const peer of peers)
      peer.receive({
        type: 'floating:speech-status',
        active: speechOwner !== null,
        other: speechOwner !== null && speechOwner !== peer.tabId,
      });
  };
  const stopRemote = () => {
    const owner = peers.find((peer) => peer.tabId === speechOwner);
    speechOwner = null;
    publishSpeech();
    owner?.receive({ type: 'floating:speech-stop' });
  };
  function makeClient(tabId: number): Peer {
    const messages = new Events<[unknown]>();
    const disconnects = new Events<[]>();
    const receive = (message: FloatingSurfaceMessage) => messages.emit(message);
    const port = {
      onMessage: messages,
      onDisconnect: disconnects,
      disconnect() {},
      postMessage(message: Record<string, unknown>) {
        if (message.type === 'floating:speech-state') {
          if (message.active === true) {
            if (speechOwner !== null && speechOwner !== tabId) stopRemote();
            speechOwner = tabId;
          } else if (speechOwner === tabId) speechOwner = null;
          publishSpeech();
        } else if (message.type === 'floating:stop-speech') stopRemote();
        else if (message.type === 'floating:claim') {
          if (speechOwner !== tabId) stopRemote();
          for (const peer of peers)
            if (peer.tabId !== tabId) peer.receive({ type: 'floating:cancel' });
        } else if (
          message.type === 'orders:capture' ||
          message.type === 'orders:verify'
        ) {
          const request = message as OrdersPageRequest;
          if (request.type === 'orders:capture') captures++;
          queueMicrotask(() =>
            receive(
              request.type === 'orders:capture'
                ? {
                    type: 'orders:result',
                    id: request.id,
                    snapshot: {
                      ...source,
                      snapshot_id: crypto.randomUUID(),
                    },
                  }
                : { type: 'orders:verified', id: request.id, current: true },
            ),
          );
        }
      },
    } as unknown as chrome.runtime.Port;
    const client = new FloatingClient(
      port,
      {
        supported: true,
        tabId,
        windowId: 1,
        origin: source.origin,
        pathname: source.pathname,
        title: source.title,
        reason: null,
      },
      browser,
    );
    const peer = { tabId, receive, client };
    peers.push(peer);
    return peer;
  }
  const audio: (Playback & {
    plays: number;
    pauses: number;
    releases: number;
  })[] = [];
  const { browserDependencies } = await import('@adc/voice-ui');
  t.mock.method(browserDependencies, 'getMicrophone', async () => {
    assert.fail(
      'Tab changes or peer mounting must not activate the microphone',
    );
  });
  t.mock.method(
    browserDependencies,
    'createObjectURL',
    () => `blob:${crypto.randomUUID()}`,
  );
  t.mock.method(browserDependencies, 'revokeObjectURL', () => {});
  t.mock.method(browserDependencies, 'createPlayback', () => {
    const player = {
      currentTime: 0,
      playbackRate: 1,
      onended: null,
      onerror: null,
      plays: 0,
      pauses: 0,
      releases: 0,
      async play() {
        this.plays++;
      },
      pause() {
        this.pauses++;
      },
      release() {
        this.releases++;
      },
    };
    audio.push(player);
    return player;
  });
  const questions: GroundedRequest[] = [];
  const speechSignals: AbortSignal[] = [];
  let deferSpeech = false;
  let completeSpeech: (() => void) | null = null;
  const speechResponse = () =>
    new Response(new Blob(['synthetic audio']), {
      headers: { 'Content-Type': 'audio/mpeg' },
    });
  t.mock.method(
    globalThis,
    'fetch',
    async (url: RequestInfo | URL, options?: RequestInit) => {
      const pathname = new URL(String(url)).pathname;
      if (pathname === '/api/grounded-read') {
        const request = JSON.parse(String(options?.body)) as GroundedRequest;
        questions.push(request);
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
      }
      assert.equal(pathname, '/api/voice/speak');
      assert.ok(options?.signal);
      speechSignals.push(options.signal);
      if (deferSpeech)
        return new Promise<Response>((resolve) => {
          completeSpeech = () => resolve(speechResponse());
        });
      return speechResponse();
    },
  );
  const { App } = await import('./App.tsx');
  const FloatingApp = App as ComponentType<{ floating: FloatingClient }>;
  const { createRoot } = await import('react-dom/client');
  const ownerElement = dom.window.document.getElementById('owner')!;
  const peerElement = dom.window.document.getElementById('peer')!;
  const ownerRoot = createRoot(ownerElement),
    peerRoot = createRoot(peerElement);
  const owner = makeClient(1);
  const settle = async (action: () => void) =>
    act(async () => {
      action();
      for (let turn = 0; turn < 6; turn++)
        await new Promise<void>((resolve) => setImmediate(resolve));
    });
  const button = (element: Element, label: string) => {
    const found = [...element.querySelectorAll('button')].find(
      (candidate) => candidate.textContent === label,
    );
    assert.ok(found, `Missing ${label}`);
    return found;
  };
  const visible = (hidden: boolean) => {
    Object.defineProperty(dom.window.document, 'hidden', {
      configurable: true,
      value: hidden,
    });
    dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));
  };
  const ask = async (element: Element) => {
    await settle(() => button(element, 'Use example question').click());
    await settle(() => button(element, 'Ask VSual').click());
  };
  try {
    await settle(() =>
      ownerRoot.render(createElement(FloatingApp, { floating: owner.client })),
    );
    await settle(() =>
      owner.receive({
        type: 'floating:activate',
        id: crypto.randomUUID(),
        record: false,
      }),
    );
    assert.equal(questions.length, 0);
    assert.equal(audio.length, 0);
    await ask(ownerElement);
    const first = audio[0]!;
    assert.equal(first.plays, 1);
    assert.equal(first.playbackRate, 0.9);
    assert.equal(speechOwner, 1);
    const pauses = first.pauses,
      releases = first.releases;
    await settle(() => {
      owner.receive({ type: 'floating:invalidated', reason: 'tab' });
      visible(true);
    });
    assert.equal(
      first.pauses,
      pauses,
      'Already-playing audio survives both tab and visibility callbacks',
    );
    assert.equal(first.releases, releases);
    const peer = makeClient(2);
    await settle(() =>
      peerRoot.render(createElement(FloatingApp, { floating: peer.client })),
    );
    await settle(() => {
      publishAuth();
      publishSpeech();
      peer.receive({ type: 'floating:resume', expanded: true });
    });
    assert.equal(
      authCalls.filter((call) => call.type === 'auth:status').length,
      2,
    );
    assert.equal(
      first.pauses,
      pauses,
      'A new signed-in App and stable auth updates must not cancel the owner',
    );
    assert.equal(first.releases, releases);
    assert.equal(speechSignals.length, 1);
    assert.equal(captures, 1);
    assert.match(
      peerElement.textContent!,
      /Reading an answer from another tab/,
    );
    await settle(() => button(peerElement, 'Stop speech in other tab').click());
    assert.ok(first.pauses > pauses);
    assert.equal(
      first.releases,
      releases,
      'Explicit remote Stop keeps valid cached audio',
    );
    assert.ok(ownerElement.querySelector('.answer-text'));
    await settle(() => {
      visible(false);
      owner.receive({ type: 'floating:resume', expanded: true });
    });
    await settle(() => button(ownerElement, 'Read again').click());
    assert.equal(first.plays, 2);
    assert.equal(speechSignals.length, 1, 'Repeat uses the existing clip');

    deferSpeech = true;
    await ask(ownerElement);
    assert.equal(speechSignals.length, 2);
    const pendingSignal = speechSignals[1]!;
    const playersBeforeCompletion = audio.length;
    await settle(() => {
      owner.receive({ type: 'floating:invalidated', reason: 'tab' });
      visible(true);
      peer.receive({ type: 'floating:resume', expanded: true });
      publishAuth();
      publishSpeech();
    });
    assert.equal(
      pendingSignal.aborted,
      false,
      'Accepted-answer TTS stays owned by the original frame',
    );
    assert.ok(completeSpeech);
    await settle(() => completeSpeech?.());
    assert.equal(audio.length, playersBeforeCompletion + 1);
    const second = audio.at(-1)!;
    assert.equal(second.plays, 1);
    assert.equal(second.playbackRate, 0.9);
    const secondPauses = second.pauses;
    await settle(() => {
      publishAuth();
      publishSpeech();
    });
    assert.equal(second.pauses, secondPauses);
    assert.equal(speechSignals.length, 2);

    // Deliberate work in another surface supersedes old audio, unlike following it.
    deferSpeech = false;
    await settle(() => visible(false));
    await ask(peerElement);
    assert.ok(second.pauses > secondPauses);
    assert.equal(speechSignals.length, 3);
    assert.equal(speechOwner, 2);
    const last = audio.at(-1)!;
    const beforeLogout = last.pauses;
    await settle(() =>
      button(peerElement, 'Sign out of VSual extension').click(),
    );
    assert.ok(last.pauses > beforeLogout);
    assert.ok(last.releases > 0);
    assert.equal(ownerElement.querySelector('textarea'), null);
    assert.equal(peerElement.querySelector('textarea'), null);
    assert.equal(ownerElement.querySelector('.answer-text'), null);
    assert.equal(peerElement.querySelector('.answer-text'), null);
    assert.equal(speechOwner, null);
  } finally {
    await act(async () => {
      ownerRoot.unmount();
      peerRoot.unmount();
    });
    for (const peer of peers) peer.client.dispose();
    hook.deregister();
    dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
