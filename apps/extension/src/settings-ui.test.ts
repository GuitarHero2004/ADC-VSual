import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { act, createElement } from 'react';
import { JSDOM } from 'jsdom';
import ts from 'typescript';
import type { AuthPanelMessage, AuthStatus } from '@adc/contracts';

test('actual extension Settings preserves drafts, exposes session recovery on access loss and clears work on logout', async () => {
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
  const dom = new JSDOM('<div id="root"></div>', {
    url: 'https://extension.example.test/index.html',
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
    'sessionStorage',
    'HTMLElement',
    'HTMLTextAreaElement',
  ] as const)
    expose(key, dom.window[key]);
  expose('IS_REACT_ACT_ENVIRONMENT', true);
  const noEvents = { addListener() {}, removeListener() {} };
  const changed = new Set<
    (changes: Record<string, { newValue: unknown }>, area: string) => void
  >();
  let status: AuthStatus = {
    phase: 'signed_in',
    account: { id: crypto.randomUUID(), email: 'member@example.test' },
    workspace: 'allowed',
    epoch: crypto.randomUUID(),
    attempt: null,
    error: null,
    logoutConfirmed: null,
  };
  const authCalls: AuthPanelMessage[] = [];
  const activationMessages: unknown[] = [];
  const activationListeners = new Set<(message: unknown) => void>();
  let pageChecks = 0;
  let captures = 0;
  let networkCalls = 0;
  let microphoneCalls = 0;
  let expectMicrophone = false;
  let resolveMicrophone!: (stream: { getTracks(): { stop(): void }[] }) => void;
  let stoppedTracks = 0;
  expose('fetch', () => {
    networkCalls += 1;
    assert.fail(
      'Settings and draft editing must not request assistant, STT or TTS services',
    );
  });
  Object.defineProperty(dom.window.navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia() {
        microphoneCalls += 1;
        assert.ok(expectMicrophone, 'Settings must not request the microphone');
        return new Promise((resolve) => {
          resolveMicrophone = resolve;
        });
      },
    },
  });
  expose(
    'BroadcastChannel',
    class {
      onmessage: ((event: MessageEvent) => void) | null = null;
      postMessage() {}
      close() {}
    },
  );
  expose('chrome', {
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
          for (const listener of changed)
            listener({ 'adc:auth:owner': { newValue: { status } } }, 'session');
        }
        return { ok: true, status };
      },
      connect() {
        return {
          onMessage: {
            addListener(listener: (message: unknown) => void) {
              activationListeners.add(listener);
            },
          },
          onDisconnect: noEvents,
          disconnect() {
            activationListeners.clear();
          },
          postMessage(message: unknown) {
            activationMessages.push(message);
          },
        };
      },
      getURL(path: string) {
        return `https://extension.example.test/${path}`;
      },
    },
    commands: {
      async getAll() {
        return [{ name: 'toggle-voice', shortcut: 'Ctrl+Shift+Y' }];
      },
    },
    storage: {
      onChanged: {
        addListener(
          listener: (
            changes: Record<string, { newValue: unknown }>,
            area: string,
          ) => void,
        ) {
          changed.add(listener);
        },
        removeListener(
          listener: (
            changes: Record<string, { newValue: unknown }>,
            area: string,
          ) => void,
        ) {
          changed.delete(listener);
        },
      },
    },
    tabs: {
      onActivated: noEvents,
      onUpdated: noEvents,
      onRemoved: noEvents,
      async query() {
        pageChecks += 1;
        return [
          {
            id: 1,
            windowId: 2,
            url: 'http://127.0.0.1:3000/orders',
            title: 'Orders dashboard',
          },
        ];
      },
      connect() {
        captures += 1;
        assert.fail('Settings must not connect to capture page content');
      },
      async create() {},
    },
    windows: {
      async getCurrent() {
        return { id: 2 };
      },
    },
  });
  const { createRoot } = await import('react-dom/client');
  const { App } = await import('./App.tsx');
  const document = dom.window.document;
  const activeElement = (): Element | null => document.activeElement;
  const root = createRoot(document.getElementById('root')!);
  const settle = async (action: () => void) =>
    act(async () => {
      action();
      await new Promise<void>((resolve) => setImmediate(resolve));
      await new Promise<void>((resolve) => setImmediate(resolve));
    });
  const button = (name: string) => {
    const found = [...document.querySelectorAll('button')].find(
      (item) => item.textContent === name,
    );
    assert.ok(found, `Missing button: ${name}`);
    return found;
  };
  const select = (label: string) => {
    const found = [...document.querySelectorAll('label')].find(
      (item) => item.textContent === label,
    );
    assert.ok(found, `Missing label: ${label}`);
    return document.getElementById(found.htmlFor) as HTMLSelectElement;
  };
  const change = async (field: HTMLSelectElement, value: string) =>
    settle(() => {
      field.focus();
      field.value = value;
      field.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    });
  const publishStatus = (next: AuthStatus) => {
    status = next;
    for (const listener of changed)
      listener({ 'adc:auth:owner': { newValue: { status } } }, 'session');
  };
  try {
    await settle(() => root.render(createElement(App)));
    assert.deepEqual(
      authCalls.map((message) => message.type),
      ['auth:status'],
    );
    assert.ok(
      activationMessages.some(
        (message) =>
          typeof message === 'object' &&
          message !== null &&
          'type' in message &&
          message.type === 'ready',
      ),
    );
    await settle(() => button('Allow page processing').click());
    await settle(() => button('Use example question').click());
    const textarea = document.querySelector('textarea')!;
    assert.ok(textarea.value);
    textarea.setSelectionRange(3, 8);
    const draft = textarea.value;
    const checksBeforeSettings = pageChecks;
    const settingsButton = button('Settings');
    await settle(() => settingsButton.click());
    const settings = document.getElementById('companion-settings')!;
    const companion = document.getElementById('companion-content')!;
    assert.equal(settings.hidden, false);
    assert.equal(companion.hidden, true);
    assert.equal(document.activeElement?.id, 'settings-heading');
    assert.equal(settingsButton.getAttribute('aria-expanded'), 'true');
    assert.ok(settings.contains(select('Recognition and speech language')));
    assert.ok(settings.contains(document.getElementById('answer-speed')));
    assert.match(settings.textContent!, /Ctrl\+Shift\+Y/);
    assert.ok(
      !Array.from(settings.querySelectorAll('label')).some((label) =>
        /^(Theme|Text size)$/.test(label.textContent?.trim() ?? ''),
      ),
      'The fixed light, large interface has no appearance controls',
    );
    await change(select('Recognition and speech language'), 'vi');
    await change(
      document.getElementById('answer-speed') as HTMLSelectElement,
      '1.5',
    );
    await settle(() =>
      document.getElementById('answer-speech-enabled')!.click(),
    );
    assert.equal(
      (document.getElementById('answer-speech-enabled') as HTMLInputElement)
        .checked,
      true,
    );
    const uiLanguage = document.getElementById(
      'interface-language',
    ) as HTMLSelectElement;
    await change(uiLanguage, 'vi');
    assert.equal(document.documentElement.lang, 'vi');
    assert.equal(document.activeElement, uiLanguage);
    assert.match(settings.textContent!, /Ngôn ngữ giao diện/);
    await change(uiLanguage, 'en');
    assert.equal(document.querySelector('textarea'), textarea);
    assert.equal(textarea.value, draft);
    assert.equal(textarea.selectionStart, 3);
    assert.equal(textarea.selectionEnd, 8);
    assert.equal(pageChecks, checksBeforeSettings);
    assert.deepEqual(
      authCalls.map((message) => message.type),
      ['auth:status'],
    );
    assert.equal(captures, 0);
    assert.equal(networkCalls, 0);
    assert.equal(microphoneCalls, 0);
    await settle(() => button('Back to companion').click());
    assert.equal(document.activeElement, settingsButton);
    assert.equal(settings.hidden, true);
    assert.equal(companion.hidden, false);
    assert.equal(document.querySelector('textarea'), textarea);
    assert.equal(textarea.value, draft);
    assert.equal(button('Ask VSual').disabled, false);
    await settle(() => settingsButton.click());
    await settle(() =>
      settings.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    assert.equal(document.activeElement, settingsButton);
    assert.equal(textarea.value, draft);
    assert.ok(
      !document
        .querySelector('.grounded-panel > .status')
        ?.textContent?.includes('cancelled'),
      'Escape in Settings returns without cancelling companion work',
    );

    // An explicit browser command may start recording, but cannot leave focus in hidden Settings.
    await settle(() => settingsButton.click());
    uiLanguage.focus();
    expectMicrophone = true;
    const activation = { type: 'activate', id: crypto.randomUUID() };
    await settle(() => {
      for (const listener of activationListeners) listener(activation);
    });
    assert.equal(settings.hidden, true);
    assert.equal(
      (document.activeElement as Element | null)?.closest('[hidden]'),
      null,
    );
    assert.equal(document.activeElement, button('Cancel recording'));
    assert.equal(microphoneCalls, 1);
    await settle(() => {
      for (const listener of activationListeners) listener(activation);
    });
    assert.equal(
      microphoneCalls,
      1,
      'Redelivering one activation must not request the microphone twice',
    );
    assert.ok(button('Cancel recording'));
    await settle(() => button('Cancel recording').click());
    await settle(() =>
      resolveMicrophone({
        getTracks: () => [
          {
            stop() {
              stoppedTracks += 1;
            },
          },
        ],
      }),
    );
    assert.equal(stoppedTracks, 1);
    assert.equal(textarea.value, draft);
    assert.equal(document.activeElement, button('Record question'));
    assert.equal(pageChecks, checksBeforeSettings);
    assert.deepEqual(
      authCalls.map((message) => message.type),
      ['auth:status'],
    );

    // Losing access while a session-specific setting is focused must expose
    // recovery, rather than leaving focus in a removed portal or hidden account.
    const connectedStatus = status;
    await settle(() => settingsButton.click());
    select('Recognition and speech language').focus();
    await settle(() =>
      publishStatus({
        ...connectedStatus,
        phase: 'unverified',
        workspace: 'unavailable',
        error: 'UNAVAILABLE',
      }),
    );
    assert.equal(settings.hidden, true);
    assert.equal(companion.hidden, false);
    assert.equal(activeElement()?.id, 'session-heading');
    assert.equal(activeElement()?.closest('[hidden]'), null);
    assert.match(companion.textContent!, /Could not verify your session/);
    assert.match(companion.textContent!, /member@example\.test/);
    assert.ok(button('Try again'));
    assert.equal(document.querySelector('textarea'), null);
    assert.equal(document.getElementById('answer-speed'), null);
    assert.deepEqual(
      authCalls.map((message) => message.type),
      ['auth:status'],
    );

    await settle(() => publishStatus(connectedStatus));
    await settle(() => settingsButton.click());
    select('Recognition and speech language').focus();
    await settle(() =>
      publishStatus({
        ...connectedStatus,
        phase: 'signed_out',
        account: null,
        workspace: 'unknown',
        epoch: crypto.randomUUID(),
        error: 'SESSION_EXPIRED',
      }),
    );
    assert.equal(settings.hidden, true);
    assert.equal(companion.hidden, false);
    assert.equal(activeElement()?.id, 'session-heading');
    assert.equal(activeElement()?.closest('[hidden]'), null);
    assert.match(companion.textContent!, /session is no longer valid/i);
    assert.ok(button('Sign in on the VSual website'));
    assert.equal(document.querySelector('textarea'), null);

    // Settings remains available when deliberately opened while already blocked.
    await settle(() => settingsButton.click());
    assert.equal(settings.hidden, false);
    assert.equal(activeElement()?.id, 'settings-heading');
    await change(
      document.getElementById('interface-language') as HTMLSelectElement,
      'vi',
    );
    assert.equal(settings.hidden, false);
    await change(
      document.getElementById('interface-language') as HTMLSelectElement,
      'en',
    );
    await settle(() => button('Back to companion').click());
    assert.equal(document.activeElement, settingsButton);
    await settle(() => publishStatus(connectedStatus));
    await settle(() => button('Use example question').click());
    const logoutDraft = document.querySelector('textarea')!;
    assert.ok(logoutDraft.value);

    // Sign-out removes the real composer and its portalled session controls.
    const account = document.querySelector<HTMLDetailsElement>(
      '.account-summary details',
    )!;
    account.open = true;
    await settle(() => button('Sign out of VSual extension').click());
    assert.equal(logoutDraft.isConnected, false);
    assert.equal(textarea.isConnected, false);
    assert.equal(document.querySelector('textarea'), null);
    assert.equal(document.getElementById('answer-speed'), null);
    assert.ok(button('Sign in on the VSual website'));
    assert.equal(
      document.body.textContent?.includes('member@example.test'),
      false,
    );
    assert.equal(networkCalls, 0);
    assert.equal(microphoneCalls, 1);
    assert.equal(captures, 0);
    const saved = Array.from(
      { length: dom.window.localStorage.length },
      (_, index) =>
        dom.window.localStorage.getItem(dom.window.localStorage.key(index)!)!,
    ).join(' ');
    assert.ok(
      !saved.includes(draft),
      'Drafts must not enter preference storage',
    );
    assert.match(saved, /"language":"vi"/);
    assert.match(saved, /"playbackRate":1.5/);
  } finally {
    await act(async () => root.unmount());
    hook.deregister();
    dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
