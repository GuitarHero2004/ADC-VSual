import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { act, createElement, StrictMode } from 'react';
import { JSDOM } from 'jsdom';
import ts from 'typescript';
import type {
  DesktopBridge,
  DesktopPreferences,
  DesktopState,
} from '../bridge.ts';

const initialState: DesktopState = {
  preferences: { language: 'en', shortcut: 'Control+Alt+Space' },
  shortcutRegistered: true,
  preferencesSaved: true,
  issue: null,
};

async function renderDesktop(overrides: Partial<DesktopBridge> = {}) {
  const hook = registerHooks({
    load(url, context, next) {
      if (url.endsWith('.png'))
        return {
          format: 'module',
          shortCircuit: true,
          source: `export default ${JSON.stringify(url)};`,
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
  const dom = new JSDOM('<div id="root"></div>', {
    url: 'https://desktop.example.test/',
    pretendToBeVisual: true,
  });
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
    'HTMLElement',
    'Element',
  ] as const)
    expose(key, dom.window[key]);
  expose('IS_REACT_ACT_ENVIRONMENT', true);
  const stateListeners = new Set<(state: DesktopState) => void>();
  const activationListeners = new Set<() => void>();
  const calls = { hide: 0, quit: 0, saves: [] as DesktopPreferences[] };
  const bridge: DesktopBridge = {
    getState: async () => initialState,
    updatePreferences: async (preferences) => {
      calls.saves.push(preferences);
      return { ...initialState, preferences };
    },
    hide: async () => {
      calls.hide++;
    },
    quit: async () => {
      calls.quit++;
    },
    onState(listener) {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    onActivate(listener) {
      activationListeners.add(listener);
      return () => activationListeners.delete(listener);
    },
    ...overrides,
  };
  const { App } = await import('./App.tsx');
  const { createRoot } = await import('react-dom/client');
  const container = dom.window.document.getElementById('root');
  assert.ok(container);
  const root = createRoot(container);
  let unmounted = false;
  await act(async () => {
    root.render(createElement(StrictMode, {}, createElement(App, { bridge })));
  });
  function button(label: string) {
    const result = Array.from(
      dom.window.document.querySelectorAll('button'),
    ).find((item) => item.textContent === label);
    assert.ok(result, `Expected button: ${label}`);
    return result;
  }
  function select(id: string) {
    const result = dom.window.document.querySelector<HTMLSelectElement>(
      `#${id}`,
    );
    assert.ok(result);
    const label = dom.window.document.querySelector(`label[for="${id}"]`);
    assert.ok(label?.textContent, `${id} needs a visible label`);
    return result;
  }
  async function choose(id: string, value: string) {
    const control = select(id);
    await act(async () => {
      control.value = value;
      control.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    });
  }
  async function unmount() {
    if (!unmounted) {
      await act(async () => root.unmount());
      unmounted = true;
    }
  }
  return {
    dom,
    calls,
    bridge,
    stateListeners,
    activationListeners,
    button,
    select,
    choose,
    unmount,
    text: () => dom.window.document.body.textContent ?? '',
    status: () =>
      dom.window.document.querySelector('[role="status"]')?.textContent ?? '',
    async dispose() {
      await unmount();
      dom.window.close();
      hook.deregister();
      for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}

test('desktop labels real controls, saves language explicitly, reports failures and preserves focus', async () => {
  const page = await renderDesktop();
  const document = page.dom.window.document;
  try {
    assert.match(page.text(), /Desktop foundation/);
    assert.match(
      page.text(),
      /Screen reading and voice are not connected in this desktop build\./,
    );
    assert.match(page.text(), /No account is needed/);
    assert.match(page.text(), /Ctrl \+ Alt \+ Space/);
    assert.match(page.text(), /Shortcut is ready/);
    assert.equal(document.activeElement?.id, 'desktop-title');
    assert.equal(document.querySelector('textarea, input, audio, video'), null);
    assert.equal(document.querySelectorAll('[role="status"]').length, 1);
    assert.equal(
      page.stateListeners.size,
      1,
      'StrictMode must clean up its first subscription',
    );
    assert.equal(page.activationListeners.size, 1);

    const settings = document.querySelector('details');
    assert.ok(settings);
    assert.equal(settings.querySelector('summary')?.textContent, 'Settings');
    settings.open = true;
    assert.deepEqual(
      Array.from(
        page.select('desktop-shortcut').options,
        (option) => option.value,
      ),
      ['Control+Alt+Space', 'Control+Alt+V', 'Control+Shift+Space'],
    );
    await page.choose('desktop-language', 'vi');
    await page.choose('desktop-shortcut', 'Control+Alt+V');
    assert.equal(document.documentElement.lang, 'vi');
    assert.equal(
      page.calls.saves.length,
      0,
      'Preview changes must not silently persist',
    );
    assert.match(page.status(), /thay đổi chưa lưu/);
    assert.equal(page.button('Lưu cài đặt').disabled, false);
    page.button('Lưu cài đặt').focus();
    await act(async () => page.button('Lưu cài đặt').click());
    assert.deepEqual(page.calls.saves, [
      { language: 'vi', shortcut: 'Control+Alt+V' },
    ]);
    assert.equal(document.activeElement, page.button('Lưu cài đặt'));
    assert.match(page.status(), /Đã lưu cài đặt/);

    await act(async () => {
      for (const listener of page.stateListeners)
        listener({
          preferences: { language: 'vi', shortcut: 'Control+Alt+V' },
          shortcutRegistered: false,
          preferencesSaved: false,
          issue: 'shortcut_unavailable',
        });
    });
    assert.match(page.status(), /Không thể sử dụng phím tắt/);
    assert.match(page.status(), /Không thể lưu cài đặt/);
    assert.equal(document.activeElement, page.button('Lưu cài đặt'));
    await act(async () => page.button('Lưu cài đặt').click());
    assert.doesNotMatch(page.status(), /Không thể/);

    await page.choose('desktop-shortcut', 'Control+Shift+Space');
    await act(async () => {
      for (const listener of page.stateListeners)
        listener({
          ...initialState,
          preferences: { language: 'vi', shortcut: 'Control+Alt+V' },
        });
    });
    assert.equal(page.select('desktop-shortcut').value, 'Control+Shift+Space');
    assert.equal(
      page.calls.saves.length,
      2,
      'Incoming state must preserve the unsaved draft',
    );

    await act(async () => {
      for (const listener of page.activationListeners) listener();
    });
    assert.equal(document.activeElement?.id, 'desktop-title');
    await act(async () => page.button('Ẩn xuống khay hệ thống').click());
    assert.equal(page.calls.hide, 1);
    await act(async () => {
      page.select('desktop-language').dispatchEvent(
        new page.dom.window.KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
        }),
      );
    });
    assert.equal(page.calls.hide, 1, 'Escape in a select belongs to its popup');
    await act(async () => {
      document.getElementById('desktop-title')?.dispatchEvent(
        new page.dom.window.KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
        }),
      );
    });
    assert.equal(page.calls.hide, 2);
    await act(async () => page.button('Thoát VSual').click());
    assert.equal(page.calls.quit, 1);

    await page.unmount();
    assert.equal(page.stateListeners.size, 0);
    assert.equal(page.activationListeners.size, 0);
    page.dom.window.dispatchEvent(
      new page.dom.window.KeyboardEvent('keydown', { key: 'Escape' }),
    );
    assert.equal(page.calls.hide, 2, 'Unmount removes the Escape handler');
  } finally {
    await page.dispose();
  }
});

test('desktop loading failure offers recovery and action failures stay visible', async () => {
  let loadFails = true;
  const page = await renderDesktop({
    getState: async () => {
      if (loadFails) throw new Error('IPC unavailable');
      return initialState;
    },
    updatePreferences: async () => {
      throw new Error('IPC unavailable');
    },
    hide: async () => {
      throw new Error('IPC unavailable');
    },
    quit: async () => {
      throw new Error('IPC unavailable');
    },
  });
  try {
    assert.match(page.status(), /Could not load desktop settings/);
    assert.ok(page.button('Hide to tray'));
    assert.ok(page.button('Quit VSual'));
    loadFails = false;
    await act(async () => page.button('Try again').click());
    assert.equal(page.dom.window.document.querySelectorAll('select').length, 2);
    assert.doesNotMatch(page.status(), /Could not load/);
    const details = page.dom.window.document.querySelector('details');
    assert.ok(details);
    details.open = true;
    await page.choose('desktop-shortcut', 'Control+Alt+V');
    await act(async () => page.button('Save settings').click());
    assert.match(page.status(), /Could not update settings/);
    assert.equal(page.select('desktop-shortcut').value, 'Control+Alt+V');
    assert.equal(
      page.button('Save settings').getAttribute('aria-disabled'),
      'false',
    );
    await act(async () => page.button('Hide to tray').click());
    assert.match(page.status(), /Could not hide this window/);
    await act(async () => page.button('Quit VSual').click());
    assert.match(page.status(), /Could not quit VSual/);
  } finally {
    await page.dispose();
  }
});

test('a rejected replacement keeps the working shortcut and the unsaved choice without announcing success', async () => {
  const submitted: DesktopPreferences[] = [];
  const page = await renderDesktop();
  page.bridge.updatePreferences = async (preferences) => {
    submitted.push(preferences);
    const next: DesktopState =
      preferences.shortcut === 'Control+Alt+V'
        ? { ...initialState, issue: 'shortcut_unavailable' }
        : { ...initialState, preferences };
    for (const listener of page.stateListeners) listener(next);
    return next;
  };
  try {
    const details = page.dom.window.document.querySelector('details');
    assert.ok(details);
    details.open = true;
    await page.choose('desktop-shortcut', 'Control+Alt+V');
    page.button('Save settings').focus();
    await act(async () => page.button('Save settings').click());
    assert.deepEqual(submitted, [
      { language: 'en', shortcut: 'Control+Alt+V' },
    ]);
    assert.equal(page.select('desktop-shortcut').value, 'Control+Alt+V');
    assert.equal(
      page.dom.window.document.querySelector('kbd')?.textContent,
      'Ctrl + Alt + Space',
      'The current shortcut remains the registered working shortcut',
    );
    assert.match(page.text(), /Shortcut is ready/);
    assert.match(page.status(), /requested shortcut is unavailable/);
    assert.match(page.status(), /changes to save/);
    assert.doesNotMatch(page.status(), /Settings saved/);
    assert.equal(
      page.dom.window.document.activeElement,
      page.button('Save settings'),
    );

    await page.choose('desktop-shortcut', 'Control+Shift+Space');
    await act(async () => page.button('Save settings').click());
    assert.equal(
      page.dom.window.document.querySelector('kbd')?.textContent,
      'Ctrl + Shift + Space',
    );
    assert.match(page.status(), /Settings saved/);
    assert.doesNotMatch(page.status(), /unavailable|changes to save/);
  } finally {
    await page.dispose();
  }
});

test('desktop keeps a newer state event when the initial read finishes late', async () => {
  const reads: ((state: DesktopState) => void)[] = [];
  const page = await renderDesktop({
    getState: () => new Promise((resolve) => reads.push(resolve)),
  });
  try {
    assert.match(page.status(), /Loading desktop settings/);
    await act(async () => {
      for (const listener of page.stateListeners)
        listener({
          ...initialState,
          preferences: { language: 'vi', shortcut: 'Control+Alt+V' },
        });
      for (const resolve of reads) resolve(initialState);
    });
    assert.equal(page.dom.window.document.documentElement.lang, 'vi');
    assert.equal(page.select('desktop-shortcut').value, 'Control+Alt+V');
    assert.doesNotMatch(page.status(), /Loading/);
  } finally {
    await page.dispose();
  }
});
