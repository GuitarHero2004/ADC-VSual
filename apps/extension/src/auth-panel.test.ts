import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { act, createElement, useEffect, useRef } from 'react';
import { JSDOM } from 'jsdom';
import ts from 'typescript';
import type { AuthPanelMessage, AuthStatus } from '@adc/contracts';

test('panel restores account without login, keeps identity separate from access, and clears work on logout/account change', async () => {
  const hook = registerHooks({
    load(url, context, next) {
      if (!url.endsWith('.tsx')) return next(url, context);
      return {
        format: 'module',
        shortCircuit: true,
        source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), {
          compilerOptions: {
            module: ts.ModuleKind.ESNext,
            jsx: ts.JsxEmit.ReactJSX,
            target: ts.ScriptTarget.ES2022,
          },
        }).outputText,
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
  for (const key of ['window', 'document', 'navigator', 'HTMLElement'] as const)
    expose(key, dom.window[key]);
  expose('IS_REACT_ACT_ENVIRONMENT', true);
  const listeners = new Set<
    (changes: Record<string, { newValue: unknown }>, area: string) => void
  >();
  const accountA = { id: crypto.randomUUID(), email: 'member-a@example.test' };
  const accountB = { id: crypto.randomUUID(), email: 'member-b@example.test' };
  let status: AuthStatus = {
    phase: 'signed_in',
    account: accountA,
    workspace: 'allowed',
    epoch: crypto.randomUUID(),
    attempt: null,
    error: null,
    logoutConfirmed: null,
  };
  const messages: AuthPanelMessage[] = [];
  const publish = (next: AuthStatus) => {
    status = next;
    for (const listener of listeners)
      listener({ 'adc:auth:owner': { newValue: { status } } }, 'session');
  };
  let release!: () => void;
  let pauseValidation = false;
  let releaseValidation!: () => void;
  expose('chrome', {
    runtime: {
      async sendMessage(message: AuthPanelMessage) {
        messages.push(message);
        if (message.type === 'auth:status' && pauseValidation) {
          const oldStatus = status;
          await new Promise<void>((resolve) => {
            releaseValidation = resolve;
          });
          return { ok: true, status: oldStatus };
        }
        if (message.type === 'auth:logout') {
          publish({
            ...status,
            phase: 'signed_out',
            account: null,
            workspace: 'unknown',
            epoch: crypto.randomUUID(),
            logoutConfirmed: null,
          });
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          publish({ ...status, logoutConfirmed: false });
        }
        if (message.type === 'auth:start')
          publish({
            ...status,
            phase: 'signing_in',
            logoutConfirmed: null,
            attempt: {
              id: crypto.randomUUID(),
              expiresAt: Date.now() + 300_000,
            },
          });
        if (message.type === 'auth:cancel')
          publish({
            ...status,
            phase: 'signed_out',
            attempt: null,
            error: 'CANCELLED',
          });
        return { ok: true, status };
      },
    },
    storage: {
      onChanged: {
        addListener(
          listener: typeof listeners extends Set<infer T> ? T : never,
        ) {
          listeners.add(listener);
        },
        removeListener(
          listener: typeof listeners extends Set<infer T> ? T : never,
        ) {
          listeners.delete(listener);
        },
      },
    },
  });
  const { createRoot } = await import('react-dom/client');
  const { AuthPanel, useExtensionSession } = await import('./auth-panel.tsx');
  const root = createRoot(dom.window.document.getElementById('root')!);
  let cleared = 0;
  let disposed = 0;
  const clear = () => {
    cleared++;
  };
  function Companion({ id }: { id: string }) {
    useEffect(
      () => () => {
        disposed++;
      },
      [],
    );
    return createElement('p', { id: 'sensitive' }, `Private draft ${id}`);
  }
  function Surface() {
    const session = useExtensionSession(true, clear);
    const signInRef = useRef<HTMLButtonElement>(null);
    return createElement(
      'main',
      null,
      createElement(AuthPanel, { session, language: 'en', signInRef }),
      session.allowed && session.status?.account
        ? createElement(Companion, {
            key: session.status.epoch,
            id: session.status.account.id,
          })
        : null,
    );
  }
  const document = dom.window.document;
  const button = (name: string) =>
    [...document.querySelectorAll('button')].find(
      (item) => item.textContent === name,
    )!;
  try {
    await act(async () => root.render(createElement(Surface)));
    assert.deepEqual(
      messages.map((m) => m.type),
      ['auth:status'],
    );
    assert.match(
      document.body.textContent!,
      /Signed in: member-a@example.test/,
    );
    assert.ok(document.getElementById('sensitive'));
    assert.equal(document.activeElement?.id, 'session-heading');
    await act(async () =>
      publish({
        ...status,
        phase: 'unverified',
        workspace: 'unavailable',
        error: 'UNAVAILABLE',
      }),
    );
    assert.equal(document.getElementById('sensitive'), null);
    assert.ok(button('Try again'));
    assert.match(document.body.textContent!, /member-a@example.test/);
    await act(async () =>
      publish({
        ...status,
        phase: 'signed_in',
        workspace: 'denied',
        error: null,
      }),
    );
    assert.match(document.body.textContent!, /does not have access/);
    assert.equal(document.getElementById('sensitive'), null);
    await act(async () => publish({ ...status, workspace: 'allowed' }));
    await act(async () => {
      button('Sign out of VSual extension').click();
      button('Sign out of VSual extension')?.click();
    });
    assert.ok(cleared >= 1);
    assert.equal(messages.filter((m) => m.type === 'auth:logout').length, 1);
    assert.equal(document.getElementById('sensitive'), null);
    assert.equal(document.body.textContent?.includes(accountA.email), false);
    await act(async () => release());
    assert.match(
      document.body.textContent!,
      /Server sign-out could not be confirmed/,
    );
    await act(async () => {
      button('Sign in on the VSual website').click();
      button('Sign in on the VSual website')?.click();
    });
    assert.equal(messages.filter((m) => m.type === 'auth:start').length, 1);
    assert.ok(button('Cancel sign-in'));
    await act(async () =>
      publish({
        ...status,
        phase: 'signed_in',
        account: accountB,
        workspace: 'allowed',
        epoch: crypto.randomUUID(),
        attempt: null,
      }),
    );
    assert.match(document.body.textContent!, /member-b@example.test/);
    assert.equal(document.body.textContent?.includes(accountA.id), false);
    assert.equal(document.activeElement?.id, 'session-heading');
    assert.ok(disposed >= 2);
    assert.equal(document.querySelector('input[type=password]'), null);
    await act(async () =>
      publish({
        ...status,
        phase: 'unverified',
        account: null,
        workspace: 'unavailable',
        error: 'UNAVAILABLE',
      }),
    );
    assert.ok(button('Try again'));
    assert.ok(button('Sign out of VSual extension'));
    pauseValidation = true;
    await act(async () => button('Try again').click());
    assert.equal(button('Sign out of VSual extension').disabled, false);
    await act(async () => button('Sign out of VSual extension').click());
    await act(async () => release());
    await act(async () => releaseValidation());
    assert.equal(document.getElementById('sensitive'), null);
    assert.ok(button('Sign in on the VSual website'));
    assert.equal(document.body.textContent?.includes(accountB.email), false);
  } finally {
    await act(async () => root.unmount());
    hook.deregister();
    dom.window.close();
    for (const [key, value] of originals) {
      if (value) Object.defineProperty(globalThis, key, value);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
