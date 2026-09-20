import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { act, createElement, Fragment } from 'react';
import { JSDOM } from 'jsdom';
import ts from 'typescript';
import type { GroundedSnapshot } from '@adc/contracts';

test('website language preserves mounted content, restores focus and leaves captured source evidence unchanged without appearance controls', async () => {
  const hook = registerHooks({
    resolve(specifier, context, next) {
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
    url: 'https://vsual.example.test/orders',
    pretendToBeVisual: true,
  });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  function expose(name: string, value: unknown) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value,
    });
  }
  for (const name of [
    'window',
    'document',
    'navigator',
    'HTMLElement',
    'localStorage',
  ] as const)
    expose(name, dom.window[name]);
  expose('IS_REACT_ACT_ENVIRONMENT', true);
  const { createRoot } = await import('react-dom/client');
  const { default: SiteShell } = await import('../../app/site-shell.tsx');
  const { default: OrdersDemo } =
    await import('../../app/orders/orders-demo.tsx');
  const adapterUrl = new URL(
    '../../../extension/src/orders-adapter.ts',
    import.meta.url,
  );
  const { captureOrdersDocument } = (await import(adapterUrl.href)) as {
    captureOrdersDocument: (
      document: Document,
      options: {
        url: string;
        origins: string[];
        documentKey: string;
        now: () => Date;
      },
    ) => Promise<GroundedSnapshot>;
  };
  const root = createRoot(dom.window.document.getElementById('root')!);
  const document = dom.window.document;
  const button = (name: string) =>
    [...document.querySelectorAll('button')].find(
      (item) => item.textContent === name,
    )!;
  const change = async (input: HTMLSelectElement, value: string) =>
    act(async () => {
      input.value = value;
      input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    });
  const capture = () =>
    captureOrdersDocument(document, {
      url: dom.window.location.href,
      origins: [dom.window.location.origin],
      documentKey: '87c6928a-d6ab-4234-8d95-6fdf9e4e3c5c',
      now: () => new Date('2026-09-01T00:00:00Z'),
    });
  try {
    dom.window.localStorage.setItem('vsual.website.language', 'invalid');
    await act(async () =>
      root.render(
        createElement(SiteShell, {
          children: createElement(
            Fragment,
            null,
            createElement(OrdersDemo),
            createElement('textarea', {
              id: 'retained-draft',
              'aria-label': 'Fixture draft',
              defaultValue: 'My editable question',
            }),
          ),
        }),
      ),
    );
    const draft = document.getElementById(
      'retained-draft',
    ) as HTMLTextAreaElement;
    const sourceBefore = await capture();
    assert.equal(document.documentElement.lang, 'en');
    const trigger = button('Language');
    await act(async () => trigger.click());
    assert.equal(document.activeElement?.id, 'website-settings-heading');
    assert.equal(trigger.getAttribute('aria-expanded'), 'true');
    const selects = document.querySelectorAll<HTMLSelectElement>(
      '#website-settings select',
    );
    assert.equal(selects.length, 1, 'language is the only website setting');
    const language =
      document.querySelector<HTMLSelectElement>('#website-language')!;
    assert.deepEqual(
      [...language.options].map((option) => option.value),
      ['en', 'vi'],
    );
    assert.equal(
      document.querySelector(
        '[value="dark"], [value="system"], [value="high-contrast"], [value="extra-large"]',
      ),
      null,
    );
    language.focus();
    await change(language, 'vi');
    assert.equal(document.activeElement, language);
    assert.equal(document.documentElement.lang, 'vi');
    assert.match(document.body.textContent!, /Dữ liệu bản mẫu giả lập/);
    assert.equal(document.getElementById('retained-draft'), draft);
    assert.equal(draft.value, 'My editable question');
    const sourceAfter = await capture();
    assert.deepEqual(sourceAfter.rows, sourceBefore.rows);
    assert.equal(sourceAfter.locale, 'en-US');
    assert.equal(sourceAfter.fingerprint, sourceBefore.fingerprint);
    assert.equal(sourceAfter.title, 'Completed orders');
    assert.equal(
      dom.window.localStorage.getItem('vsual.website.appearance'),
      null,
    );
    assert.equal(
      dom.window.localStorage.getItem('vsual.website.language'),
      'vi',
    );
    await act(async () => button('Quay lại trang').click());
    assert.equal(document.activeElement, trigger);
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
    assert.equal(
      document.querySelector<HTMLElement>('#website-settings')!.hidden,
      true,
    );
    assert.equal(document.getElementById('retained-draft'), draft);
  } finally {
    await act(async () => root.unmount());
    hook.deregister();
    dom.window.close();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
