import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { act, createElement } from 'react';
import { JSDOM } from 'jsdom';
import ts from 'typescript';

test('shared sign-in form supports labels, password managers, validation, show/hide, duplicate protection and Vietnamese errors', async () => {
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
  const dom = new JSDOM('<main><div id="root"></div></main>', {
    url: 'https://app.example.test/auth/sign-in',
    pretendToBeVisual: true,
  });
  const original = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    original.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value,
    });
  }
  const { createRoot } = await import('react-dom/client');
  const { SignInForm } = await import('./SignInForm.tsx');
  const root = createRoot(dom.window.document.getElementById('root')!);
  let calls = 0;
  let finish!: () => void;
  const submitted: string[] = [];
  const onSubmit = async (email: string, supplied: string) => {
    calls += 1;
    submitted.push(email, supplied);
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
  };
  try {
    await act(async () =>
      root.render(
        createElement(SignInForm, {
          language: 'en',
          onSubmit,
          googleUnavailable: true,
        }),
      ),
    );
    const document = dom.window.document;
    const email =
      document.querySelector<HTMLInputElement>('input[name=email]')!;
    const password = document.querySelector<HTMLInputElement>(
      'input[name=password]',
    )!;
    const form = document.querySelector('form')!;
    const button = (name: string) =>
      [...document.querySelectorAll('button')].find(
        (item) => item.textContent === name,
      )!;
    assert.equal(
      document.querySelector(`label[for="${email.id}"]`)?.textContent,
      'Email',
    );
    assert.equal(email.autocomplete, 'username');
    assert.equal(password.autocomplete, 'current-password');
    assert.equal(
      document.querySelector('button')?.getAttribute('type'),
      'button',
    );
    assert.match(document.body.textContent!, /Google sign-in is not available/);
    assert.equal(button('Continue with Google'), undefined);
    await act(async () =>
      form.dispatchEvent(
        new dom.window.Event('submit', { bubbles: true, cancelable: true }),
      ),
    );
    assert.equal(calls, 0);
    assert.equal(document.activeElement, email);
    assert.equal(email.getAttribute('aria-invalid'), 'true');
    assert.equal(
      document.getElementById(email.getAttribute('aria-describedby')!)
        ?.textContent,
      'Enter a valid email address.',
    );
    const setValue = async (input: HTMLInputElement, value: string) =>
      act(async () => {
        Object.getOwnPropertyDescriptor(
          dom.window.HTMLInputElement.prototype,
          'value',
        )!.set!.call(input, value);
        input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      });
    await setValue(email, 'member@example.test');
    const supplied = randomBytes(16).toString('hex');
    await setValue(password, supplied);
    await act(async () => button('Show password').click());
    assert.equal(password.type, 'text');
    assert.equal(button('Hide password').getAttribute('aria-pressed'), 'true');
    await act(async () => {
      form.dispatchEvent(
        new dom.window.Event('submit', { bubbles: true, cancelable: true }),
      );
      form.dispatchEvent(
        new dom.window.Event('submit', { bubbles: true, cancelable: true }),
      );
    });
    assert.equal(calls, 1);
    assert.deepEqual(submitted, ['member@example.test', supplied]);
    assert.equal(password.value, '');
    assert.equal(password.type, 'password');
    assert.equal(email.value, 'member@example.test');
    assert.equal(form.getAttribute('aria-busy'), 'true');
    await act(async () => finish());
    await act(async () =>
      root.render(
        createElement(SignInForm, {
          language: 'vi',
          onSubmit,
          error: 'Email hoặc mật khẩu chưa đúng.',
        }),
      ),
    );
    assert.equal(email.value, 'member@example.test');
    assert.equal(
      document.querySelector('[role=alert]')?.textContent,
      'Email hoặc mật khẩu chưa đúng.',
    );
    assert.equal(
      password.getAttribute('aria-describedby'),
      document.querySelector('[role=alert]')?.id,
    );
    assert.ok(button('Đăng nhập'));
    assert.ok(button('Hiện mật khẩu'));
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    hook.deregister();
    for (const [name, value] of original) {
      if (value) Object.defineProperty(globalThis, name, value);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
