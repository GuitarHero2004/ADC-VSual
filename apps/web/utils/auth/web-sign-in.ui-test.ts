import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { act, createElement } from 'react';
import { JSDOM } from 'jsdom';
import ts from 'typescript';
import type { AuthStatus, AuthWebsiteMessage } from '@adc/contracts';

test('actual website sign-in connects only the initiating extension account, announces access, cancels stale callbacks, and retains password fallback', async () => {
  const stubUrl = 'vsual-test:supabase-client';
  const hook = registerHooks({
    resolve(specifier, context, next) {
      if (specifier.endsWith('/utils/supabase/client'))
        return { url: stubUrl, shortCircuit: true };
      if (
        specifier.startsWith('.') &&
        context.parentURL?.startsWith('file:') &&
        !/\.[a-z]+$/.test(specifier)
      ) {
        for (const ending of ['.ts', '.tsx']) {
          const url = new URL(`${specifier}${ending}`, context.parentURL);
          if (existsSync(fileURLToPath(url))) return next(url.href, context);
        }
      }
      return next(specifier, context);
    },
    load(url, context, next) {
      if (url === stubUrl)
        return {
          format: 'module',
          shortCircuit: true,
          source:
            'export function createClient() { return globalThis.__vsualWebAuthMock; }',
        };
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
  const recipient = 'a'.repeat(32);
  let attemptId = randomUUID();
  const dom = new JSDOM('<div id="root"></div>', {
    url: `https://app.example.test/auth/sign-in?extension=${recipient}&attempt=${attemptId}&lang=en`,
    pretendToBeVisual: true,
  });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const expose = (name: string, value: unknown) => {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value,
    });
  };
  for (const name of [
    'window',
    'document',
    'navigator',
    'HTMLElement',
    'HTMLInputElement',
    'localStorage',
  ] as const)
    expose(name, dom.window[name]);
  expose('IS_REACT_ACT_ENVIRONMENT', true);
  const websiteAccount = { id: randomUUID(), email: 'website-b@example.test' };
  const extensionAccount = {
    id: randomUUID(),
    email: 'extension-a@example.test',
  };
  let websiteUnavailable = false;
  let websiteLogouts = 0;
  expose('__vsualWebAuthMock', {
    auth: {
      async getUser() {
        if (websiteUnavailable)
          return { data: { user: null }, error: new TypeError('offline') };
        return { data: { user: websiteAccount }, error: null };
      },
      onAuthStateChange() {
        return { data: { subscription: { unsubscribe() {} } } };
      },
      async signOut(options: { scope: string }) {
        assert.equal(options.scope, 'local');
        websiteLogouts++;
        return { error: new TypeError('offline') };
      },
    },
  });
  const proof = randomBytes(32).toString('hex');
  const messages: AuthWebsiteMessage[] = [];
  let passwordCalls = 0;
  let googleAvailable = false;
  let denied = false;
  let delay = false;
  let unverified = false;
  let release: (() => void) | undefined;
  const pending = (): AuthStatus => ({
    phase: 'signing_in',
    account: null,
    workspace: 'unknown',
    epoch: randomUUID(),
    attempt: { id: attemptId, expiresAt: Date.now() + 300_000 },
    error: null,
    logoutConfirmed: null,
  });
  const connected = (): AuthStatus =>
    unverified
      ? {
          ...pending(),
          phase: 'unverified',
          workspace: 'unavailable',
          error: 'UNAVAILABLE',
        }
      : {
          ...pending(),
          phase: 'signed_in',
          account: extensionAccount,
          workspace: denied ? 'denied' : 'allowed',
        };
  Object.defineProperty(dom.window, 'chrome', {
    value: {
      runtime: {
        sendMessage(
          target: string,
          message: AuthWebsiteMessage,
          callback: (reply: unknown) => void,
        ) {
          assert.equal(target, recipient);
          assert.equal(message.recipient, recipient);
          assert.equal(message.attemptId, attemptId);
          messages.push(message);
          if (message.type === 'auth:hello') {
            callback({
              ok: true,
              status: pending(),
              secret: proof,
              google: googleAvailable,
            });
            return;
          }
          assert.equal(message.secret, proof);
          if (message.type === 'auth:password') {
            passwordCalls++;
            if (passwordCalls === 1)
              callback({ ok: false, error: 'INVALID_CREDENTIALS' });
            else if (delay)
              release = () => callback({ ok: true, status: connected() });
            else callback({ ok: true, status: connected() });
            return;
          }
          if (message.type === 'auth:google') {
            callback({ ok: false, error: 'CANCELLED' });
            return;
          }
          callback({
            ok: true,
            status:
              message.type === 'auth:return' || message.type === 'auth:status'
                ? connected()
                : pending(),
          });
        },
      },
    },
  });
  const { createRoot } = await import('react-dom/client');
  const { default: SignIn } =
    await import('../../app/auth/sign-in/sign-in.tsx');
  const { default: SiteShell } = await import('../../app/site-shell.tsx');
  const root = createRoot(dom.window.document.getElementById('root')!);
  const document = dom.window.document;
  const button = (name: string) =>
    [...document.querySelectorAll('button')].find(
      (item) => item.textContent === name,
    );
  const fill = async (name: string, value: string) =>
    act(async () => {
      const input = document.querySelector<HTMLInputElement>(
        `input[name=${name}]`,
      )!;
      Object.getOwnPropertyDescriptor(
        dom.window.HTMLInputElement.prototype,
        'value',
      )!.set!.call(input, value);
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
  const submit = async () => {
    await fill('email', extensionAccount.email);
    await fill('password', randomBytes(16).toString('hex'));
    await act(async () => button('Sign in')!.click());
  };
  const render = async () => {
    await act(async () =>
      root.render(
        createElement(SiteShell, {
          children: createElement(SignIn, {
            key: attemptId,
            googleEnabled: false,
            siteUrl: 'https://app.example.test',
          }),
        }),
      ),
    );
  };
  const newAttempt = async () => {
    attemptId = randomUUID();
    dom.window.history.replaceState(
      null,
      '',
      `/auth/sign-in?extension=${recipient}&attempt=${attemptId}&lang=en`,
    );
    await render();
  };
  try {
    await render();
    assert.equal(messages.length, 1);
    assert.match(
      document.body.textContent!,
      /Website account: website-b@example.test/,
    );
    assert.match(
      document.body.textContent!,
      /website and extension sessions are separate/,
    );
    assert.match(document.body.textContent!, /Google sign-in is not available/);
    await fill('email', extensionAccount.email);
    const emailField =
      document.querySelector<HTMLInputElement>('input[name=email]')!;
    await act(async () => button('Language')!.click());
    const language =
      document.querySelector<HTMLSelectElement>('#website-language')!;
    await act(async () => {
      language.value = 'vi';
      language.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    });
    assert.ok(button('Đăng nhập'));
    assert.equal(document.querySelector('input[name=email]'), emailField);
    assert.equal(emailField.value, extensionAccount.email);
    assert.equal(
      messages.length,
      1,
      'language changes do not reconnect authentication',
    );
    await act(async () => {
      language.value = 'en';
      language.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    });
    await act(async () => button('Back to page')!.click());
    assert.equal(document.activeElement, button('Language'));
    await submit();
    assert.match(
      document.querySelector('[role=alert]')!.textContent!,
      /email or password was not accepted/,
    );
    assert.equal(
      document.querySelector<HTMLInputElement>('input[name=password]')!.value,
      '',
    );
    assert.equal(
      document.querySelector<HTMLInputElement>('input[name=email]')!.value,
      extensionAccount.email,
    );
    await submit();
    assert.match(
      document.body.textContent!,
      /Connected to VSual: extension-a@example.test/,
    );
    assert.match(document.body.textContent!, /Workspace access is available/);
    assert.equal(document.activeElement?.tagName, 'H1');
    assert.equal(document.body.innerHTML.includes(proof), false);
    await act(async () => button('Return to VSual')!.click());
    assert.equal(messages.at(-1)?.type, 'auth:return');
    assert.equal(
      messages.some((message) => !message.type.startsWith('auth:')),
      false,
    );

    denied = true;
    await newAttempt();
    await submit();
    assert.match(
      document.body.textContent!,
      /Signed in, but this account does not have access/,
    );
    assert.ok(button('Return to VSual'));

    unverified = true;
    await newAttempt();
    await submit();
    assert.match(document.body.textContent!, /Could not verify your session/);
    assert.equal(document.querySelector('input[name=password]'), null);
    unverified = false;
    await act(async () => button('Try again')!.click());
    assert.match(
      document.body.textContent!,
      /Connected to VSual: extension-a@example.test/,
    );

    delay = true;
    await newAttempt();
    await submit();
    await act(async () => button('Cancel sign-in')!.click());
    await act(async () => release?.());
    assert.match(document.body.textContent!, /Sign-in cancelled/);
    assert.equal(
      document.body.textContent!.includes(
        `Connected to VSual: ${extensionAccount.email}`,
      ),
      false,
    );

    googleAvailable = true;
    delay = false;
    await newAttempt();
    await act(async () => button('Continue with Google')!.click());
    assert.match(
      document.querySelector('[role=alert]')!.textContent!,
      /Sign-in was cancelled/,
    );
    assert.ok(button('Sign in'));
    assert.equal(
      document.querySelector<HTMLInputElement>('input[name=password]')!.type,
      'password',
    );
    websiteUnavailable = true;
    attemptId = randomUUID();
    dom.window.history.replaceState(null, '', '/auth/sign-in');
    await render();
    assert.ok(button('Try again'));
    assert.ok(button('Sign out of this website'));
    assert.equal(document.querySelector('input[name=password]'), null);
    await act(async () => button('Sign out of this website')!.click());
    assert.equal(websiteLogouts, 1);
    assert.match(document.body.textContent!, /Signed out on this device/);
    assert.ok(button('Sign in'));
  } finally {
    await act(async () => root.unmount());
    hook.deregister();
    dom.window.close();
    for (const [name, value] of originals) {
      if (value) Object.defineProperty(globalThis, name, value);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
