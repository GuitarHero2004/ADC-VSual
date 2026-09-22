import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { act, createElement, StrictMode } from 'react';
import { JSDOM } from 'jsdom';
import ts from 'typescript';
import type {
  DesktopActivationEvent,
  DesktopBridge,
  DesktopPreferences,
  DesktopState,
} from '../bridge.ts';
import type { AssistantDependencies } from './assistant-controller.ts';
import type { GuideDependencies } from './guide.ts';
import { assistantHarness, deferred, session, settle } from './test-helpers.ts';

const initialState: DesktopState = {
  preferences: { language: 'en', shortcut: 'Control+Alt+Space' },
  shortcutRegistered: true,
  stopShortcutRegistered: true,
  preferencesSaved: true,
  issue: null,
};

function guideHarness() {
  const calls = { spoken: 0, active: false, texts: [] as string[] };
  const dependencies: GuideDependencies = {
    getVoices: () =>
      [
        { lang: 'en-US', localService: true, default: true },
        { lang: 'vi-VN', localService: true, default: false },
      ] as SpeechSynthesisVoice[],
    createUtterance: (text) => ({ text }) as SpeechSynthesisUtterance,
    speak: (utterance) => {
      calls.spoken++;
      calls.active = true;
      calls.texts.push(utterance.text);
    },
    cancel: () => {
      calls.active = false;
    },
    onVoicesChanged: () => () => {},
    schedule: (callback, delay) => {
      const timer = setTimeout(callback, delay);
      return () => clearTimeout(timer);
    },
  };
  return { calls, dependencies };
}

async function renderDesktop(
  overrides: Partial<DesktopBridge> = {},
  dependencies?: AssistantDependencies,
  guideDependencies?: GuideDependencies,
) {
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
  const activationListeners = new Set<
    (event: DesktopActivationEvent) => void
  >();
  const calls = { hide: 0, quit: 0, saves: [] as DesktopPreferences[] };
  const fixture = assistantHarness();
  const bridge: DesktopBridge = {
    ...fixture.bridge,
    getSession: async () => ({
      ...session,
      phase: 'signed_out',
      account: null,
      workspace: 'unknown',
    }),
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
    root.render(
      createElement(
        StrictMode,
        {},
        createElement(App, {
          bridge,
          assistantDependencies: dependencies ?? fixture.dependencies,
          guideDependencies: guideDependencies ?? guideHarness().dependencies,
        }),
      ),
    );
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
      dom.window.document.querySelector('.desktop-status')?.textContent ?? '',
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
    assert.match(page.text(), /Desktop assistant/);
    assert.match(
      page.text(),
      /Ask about one selected window using a screenshot\./,
    );
    assert.ok(page.button('Sign in'));
    assert.ok(page.button('Hide to tray'));
    const guide = document.querySelector('.desktop-guide');
    assert.equal(guide, null, 'Instructions belong to the signed-in screen');
    assert.match(page.text(), /Ctrl \+ Alt \+ Space/);
    assert.equal(document.activeElement?.id, 'desktop-title');
    assert.equal(document.querySelector('textarea, audio, video'), null);
    assert.equal(document.querySelectorAll('.desktop-status').length, 1);
    assert.equal(
      page.stateListeners.size,
      1,
      'StrictMode must clean up its first subscription',
    );
    assert.equal(page.activationListeners.size, 2);

    const settings =
      document.querySelector<HTMLDetailsElement>('.desktop-settings');
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
          stopShortcutRegistered: true,
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
      for (const listener of page.activationListeners)
        listener({ id: crypto.randomUUID(), kind: 'open' });
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
  const page = await renderDesktop({ getSession: async () => session });
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
    const talkRow = page.dom.window.document.querySelector(
      '.desktop-hotkeys dl > div',
    );
    assert.match(talkRow?.textContent ?? '', /Ctrl \+ Alt \+ SpaceAvailable/);
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

test('signed-in desktop captures explicitly, exposes evidence, keeps audio across focus changes and clears on logout', async () => {
  const h = assistantHarness();
  const page = await renderDesktop(h.bridge, h.dependencies);
  const document = page.dom.window.document;
  try {
    assert.match(
      page.text(),
      /Private information is not automatically masked/,
    );
    assert.match(page.text(), /does not read the window’s DOM/);
    assert.equal(h.calls.captures, 0);
    assert.equal(h.sessionListeners.size, 1);
    assert.equal(h.suspendListeners.size, 2);
    assert.match(
      document.querySelector('.desktop-current-source')?.textContent ?? '',
      /Quarterly report/,
    );
    assert.match(page.text(), /press Ctrl \+ Alt \+ Space to start listening/);
    assert.equal(document.querySelector('#desktop-source'), null);
    assert.equal(document.querySelector('.desktop-source-fallback'), null);
    assert.equal(document.querySelector('input[type="checkbox"]'), null);
    assert.match(page.text(), /Answers are spoken automatically/);
    assert.match(page.text(), /NVDA is separate/);
    assert.match(page.text(), /Maximum recording: 60 seconds/);
    assert.doesNotMatch(page.text(), /30 seconds|Refresh windows/);
    assert.equal(h.calls.captures, 0);
    assert.ok(document.querySelector('label[for="desktop-question"]'));
    await act(async () => page.button('Record question').click());
    await act(async () => {
      h.advance(300);
      h.activity();
    });
    const countdown = document.querySelector('.desktop-countdown');
    assert.match(countdown?.textContent ?? '', /5 seconds/);
    assert.equal(countdown?.getAttribute('aria-live'), 'off');
    assert.equal(countdown?.closest('[role="status"]'), null);
    await act(async () => h.advance(1_500));
    assert.match(countdown?.textContent ?? '', /4 seconds/);
    assert.doesNotMatch(
      Array.from(
        document.querySelectorAll('[role="status"]'),
        (node) => node.textContent,
      ).join(' '),
      /Sending after 4 seconds/,
      'Numerical countdown must not interrupt local cues with a live announcement',
    );
    await act(async () => {
      page.button('Stop and review').click();
      await settle();
    });
    assert.equal(
      document.querySelector('textarea')?.value,
      'What is the revenue?',
    );
    assert.equal(h.calls.captures, 0);
    await act(async () => {
      page.button('Ask VSual').click();
      await settle();
    });
    assert.equal(h.calls.captures, 1);
    const answer = document.querySelector('.answer-text');
    assert.equal(answer?.textContent, 'Revenue is 1,200.');
    assert.equal(answer?.getAttribute('lang'), 'en');
    assert.equal(answer?.closest('[aria-live], [role="status"]'), null);
    assert.match(page.text(), /Revenue appears in the report summary/);
    assert.match(page.text(), /Request reference/);
    assert.equal(h.calls.speech.length, 1);
    const pauses = h.playbacks[0]!.pauses;
    page.dom.window.dispatchEvent(new page.dom.window.Event('blur'));
    document.dispatchEvent(new page.dom.window.Event('visibilitychange'));
    assert.equal(
      h.playbacks[0]!.pauses,
      pauses,
      'Ordinary app focus changes do not stop accepted audio',
    );
    const stop = page.button('Stop answer audio');
    stop.focus();
    await act(async () => stop.click());
    assert.equal(
      document.activeElement,
      stop,
      'Stop remains mounted and focused',
    );
    assert.equal(stop.getAttribute('aria-disabled'), 'true');
    await act(async () => page.button('Play / Repeat answer').click());
    assert.equal(h.calls.speech.length, 1);
    await act(async () => {
      for (const listener of h.suspendListeners) listener();
    });
    assert.equal(
      document.querySelector('textarea')?.value,
      'What is the revenue?',
    );
    assert.ok(h.playbacks[0]!.pauses > pauses);
    await act(async () => page.button('Sign out').click());
    assert.equal(document.querySelector('textarea'), null);
    assert.equal(document.querySelector('.answer-text'), null);
    assert.ok(page.button('Sign in'));
    assert.equal(h.suspendListeners.size, 2);
    assert.equal(
      h.activationListeners.size,
      2,
      'Signed-out activation remains available for sign-in guidance without a recording controller',
    );
    assert.equal(h.playbacks[0]!.releases, 1);
    await page.unmount();
    assert.equal(h.sessionListeners.size, 0);
    assert.equal(h.activationListeners.size, 0);
  } finally {
    await page.dispose();
  }
});

test('activation without a foreground source requires returning to the app and using the shortcut', async () => {
  const h = assistantHarness();
  const page = await renderDesktop(h.bridge, h.dependencies);
  try {
    assert.match(
      page.dom.window.document.querySelector('.desktop-current-source')
        ?.textContent ?? '',
      /Quarterly report/,
    );
    h.bridge.getActiveSource = async () => null;
    // The injected bridge is the object captured by the component.
    page.bridge.getActiveSource = h.bridge.getActiveSource;
    await act(async () => {
      for (const listener of h.activationListeners)
        listener({ id: crypto.randomUUID(), kind: 'open' });
      await settle();
    });
    assert.match(page.text(), /No window is selected/);
    assert.match(page.text(), /press the VSual shortcut again/);
    assert.doesNotMatch(
      page.dom.window.document.querySelector('.desktop-current-source')
        ?.textContent ?? '',
      /Quarterly report/,
    );
    assert.equal(
      page.dom.window.document.querySelector('#desktop-source'),
      null,
    );
    assert.equal(
      page.dom.window.document.querySelector('.desktop-source-fallback'),
      null,
    );
    assert.equal(page.button('Record question').disabled, true);
    assert.equal(h.calls.captures, 0);
    assert.equal(h.calls.transcriptions, 0);
    assert.equal(h.calls.speech.length, 0);
  } finally {
    await page.dispose();
  }
});

test('desktop duration-limit status says 60 seconds and leaves the transcript for review', async () => {
  const h = assistantHarness();
  const transcript =
    deferred<Awaited<ReturnType<DesktopBridge['transcribe']>>>();
  h.bridge.transcribe = () => transcript.promise;
  const page = await renderDesktop(h.bridge, h.dependencies);
  try {
    await act(async () => page.button('Record question').click());
    await act(async () => h.advance(59_999));
    assert.ok(page.button('Stop and review'));
    await act(async () => {
      h.advance(1);
      await settle();
    });
    assert.match(
      page.text(),
      /60-second limit reached\. Transcribing for review/,
    );
    assert.doesNotMatch(page.text(), /30-second limit/);
    await act(async () => {
      transcript.resolve({
        request_id: crypto.randomUUID(),
        transcript: 'Review this question.',
      });
      await settle();
    });
    assert.equal(
      page.dom.window.document.querySelector('textarea')?.value,
      'Review this question.',
    );
    assert.equal(h.calls.captures, 0);
  } finally {
    transcript.resolve({ request_id: crypto.randomUUID(), transcript: '' });
    await page.dispose();
  }
});

test('screen failures show safe request details and never describe the model failure as a voice failure', async () => {
  for (const captureFailed of [false, true]) {
    const h = assistantHarness();
    if (captureFailed)
      h.dependencies.capture = async () => {
        throw { code: 'CAPTURE_DENIED' };
      };
    else
      h.bridge.readScreen = async () => {
        throw { code: 'PROVIDER_FAILURE' };
      };
    const page = await renderDesktop(h.bridge, h.dependencies);
    try {
      await act(async () => page.button('Record question').click());
      await act(async () => {
        page.button('Stop and review').click();
        await settle();
      });
      await act(async () => {
        page.button('Ask VSual').click();
        await settle();
      });
      const details = page.dom.window.document.querySelector(
        '.desktop-request-details',
      );
      assert.ok(details);
      assert.match(
        details.textContent ?? '',
        /Request details.*Last step.*Error code.*Request reference/s,
      );
      assert.match(
        details.textContent ?? '',
        captureFailed ? /capture_denied/ : /provider_failure/,
      );
      assert.equal(details.closest('[role=status], [aria-live]'), null);
      assert.equal(
        details.textContent?.includes('The screen image was not sent'),
        captureFailed,
      );
      assert.match(
        page.text(),
        captureFailed
          ? /Screen capture was not allowed/
          : /screen-reading service could not complete/,
      );
      assert.doesNotMatch(page.text(), /The voice service could not finish/);
      assert.equal(
        page.dom.window.document.querySelector('textarea')?.value,
        'What is the revenue?',
      );
      assert.equal(h.calls.speech.length, 0);
    } finally {
      await page.dispose();
    }
  }
});

test('cold Talk waits for authenticated controller readiness and duplicate intent records once', async () => {
  const h = assistantHarness();
  const pendingSession = deferred<typeof session>();
  const intent: DesktopActivationEvent = {
    id: crypto.randomUUID(),
    kind: 'talk',
  };
  let readyCalls = 0;
  h.bridge.getSession = () => pendingSession.promise;
  h.bridge.activationReady = async () => {
    readyCalls++;
    for (const listener of h.activationListeners) listener(intent);
  };
  const page = await renderDesktop(h.bridge, h.dependencies);
  try {
    assert.equal(readyCalls, 0);
    assert.equal(h.recorders.length, 0);
    await act(async () => {
      pendingSession.resolve(session);
      await settle();
    });
    assert.ok(readyCalls > 0);
    assert.equal(h.recorders.length, 1);
    assert.ok(page.button('Stop and review'));
    assert.equal(
      page.dom.window.document.activeElement?.id,
      'desktop-question',
    );
    await act(async () => {
      for (const listener of h.activationListeners) listener(intent);
    });
    assert.equal(h.recorders.length, 1);
    assert.equal(h.calls.captures, 0);
  } finally {
    await page.dispose();
  }
});

test('signed-out Talk guides sign-in but successful authentication requires a fresh activation', async () => {
  const h = assistantHarness();
  h.bridge.getSession = async () => ({
    ...session,
    phase: 'signed_out',
    account: null,
    workspace: 'unknown',
  });
  const page = await renderDesktop(h.bridge, h.dependencies);
  try {
    await act(async () => {
      const intent: DesktopActivationEvent = {
        id: crypto.randomUUID(),
        kind: 'talk',
      };
      for (const listener of h.activationListeners) listener(intent);
    });
    assert.match(page.text(), /Recording has not started/);
    assert.equal(
      page.dom.window.document.activeElement?.id,
      'desktop-signin-title',
    );
    await act(async () => {
      for (const listener of h.sessionListeners) listener(session);
    });
    assert.equal(h.recorders.length, 0);
    assert.equal(h.calls.captures, 0);
    await act(async () => {
      const intent: DesktopActivationEvent = {
        id: crypto.randomUUID(),
        kind: 'talk',
      };
      for (const listener of h.activationListeners) listener(intent);
      await settle();
    });
    assert.equal(h.recorders.length, 1);
  } finally {
    await page.dispose();
  }
});

test('cancelled Talk does not move focus or record when microphone permission later resolves', async () => {
  const h = assistantHarness();
  const permission =
    deferred<Awaited<ReturnType<typeof h.dependencies.voice.getMicrophone>>>();
  h.dependencies.voice.getMicrophone = () => permission.promise;
  const page = await renderDesktop(h.bridge, h.dependencies);
  try {
    await act(async () => {
      const intent: DesktopActivationEvent = {
        id: crypto.randomUUID(),
        kind: 'talk',
      };
      for (const listener of h.activationListeners) listener(intent);
      await settle();
    });
    await act(async () => page.button('Cancel operation').click());
    const focus = page.button('Hide to tray');
    focus.focus();
    let stops = 0;
    await act(async () => {
      permission.resolve({
        getTracks: () => [
          {
            stop: () => {
              stops++;
            },
          },
        ],
      });
      await settle();
    });
    assert.equal(stops, 1);
    assert.equal(h.recorders.length, 0);
    assert.equal(page.dom.window.document.activeElement, focus);
    assert.equal(h.calls.reads.length, 0);
  } finally {
    await page.dispose();
  }
});

test('Stop, account loss and logout cancel shortcut recording and never rearm on recovery', async () => {
  const h = assistantHarness();
  const page = await renderDesktop(h.bridge, h.dependencies);
  const activate = () => {
    const intent: DesktopActivationEvent = {
      id: crypto.randomUUID(),
      kind: 'talk',
    };
    for (const listener of h.activationListeners) listener(intent);
  };
  try {
    await act(async () => {
      activate();
      await settle();
    });
    await act(async () => h.bridge.stopWork());
    assert.equal(h.recorders[0]?.state, 'inactive');
    await act(async () => {
      activate();
      await settle();
    });
    await act(async () => {
      for (const listener of h.sessionListeners)
        listener({ ...session, phase: 'unavailable' });
    });
    assert.equal(h.recorders[1]?.state, 'inactive');
    await act(async () => {
      for (const listener of h.sessionListeners) listener(session);
    });
    assert.equal(h.recorders.length, 2);
    await act(async () => {
      activate();
      await settle();
    });
    await act(async () => page.button('Sign out').click());
    assert.equal(h.recorders[2]?.state, 'inactive');
    assert.equal(h.calls.transcriptions, 0);
    assert.equal(h.calls.captures, 0);
  } finally {
    await page.dispose();
  }
});

test('local Windows welcome speaks after login and stops before recording without provider calls', async () => {
  const h = assistantHarness();
  const guide = guideHarness();
  const getMicrophone = h.dependencies.voice.getMicrophone;
  h.dependencies.voice.getMicrophone = async () => {
    assert.equal(
      guide.calls.active,
      false,
      'Introduction stops before microphone capture',
    );
    return getMicrophone();
  };
  const page = await renderDesktop(
    h.bridge,
    h.dependencies,
    guide.dependencies,
  );
  const activate = (kind: DesktopActivationEvent['kind']) => {
    for (const listener of h.activationListeners)
      listener({ id: crypto.randomUUID(), kind });
  };
  try {
    assert.equal(guide.calls.spoken, 0);
    await act(async () => {
      activate('open');
      await settle();
    });
    assert.equal(guide.calls.spoken, 1);
    await act(async () => {
      activate('open');
      await settle();
    });
    assert.equal(
      guide.calls.spoken,
      1,
      'Opening again does not replay the welcome',
    );
    await act(async () => {
      activate('talk');
      await settle();
    });
    assert.equal(guide.calls.active, false);
    assert.equal(h.recorders.length, 1);
    await act(async () => {
      page.button('Hear instructions again').click();
      await settle();
    });
    assert.equal(h.recorders[0]?.state, 'inactive');
    assert.equal(guide.calls.spoken, 2);
    await act(async () => h.bridge.stopWork());
    assert.equal(guide.calls.active, false);
    assert.equal(h.calls.transcriptions, 0);
    assert.equal(
      h.calls.speech.length,
      0,
      'Windows instructions make no ElevenLabs requests',
    );
    assert.equal(h.calls.captures, 0);
  } finally {
    await page.dispose();
  }
});

test('instructions appear only after sign-in, stay expanded, and disappear on logout', async () => {
  const h = assistantHarness();
  const guide = guideHarness();
  h.bridge.getSession = async () => ({
    ...session,
    phase: 'signed_out',
    account: null,
    workspace: 'unknown',
  });
  const page = await renderDesktop(
    h.bridge,
    h.dependencies,
    guide.dependencies,
  );
  try {
    const document = page.dom.window.document;
    assert.equal(document.querySelector('.desktop-guide'), null);
    assert.equal(
      document.querySelector('a[href="#desktop-welcome-title"]'),
      null,
    );
    await act(async () => {
      for (const listener of h.activationListeners)
        listener({ id: crypto.randomUUID(), kind: 'talk' });
      await settle();
    });
    assert.equal(guide.calls.spoken, 0);
    await act(async () => {
      for (const listener of h.sessionListeners)
        listener({ ...session, workspace: 'denied' });
      await settle();
    });
    const surface = document.querySelector('.desktop-guide');
    assert.ok(
      surface,
      'Local help is available to a signed-in account even when workspace access is denied',
    );
    assert.equal(surface.querySelectorAll('ol > li').length, 3);
    assert.equal(
      surface.querySelector('details, summary'),
      null,
      'Instructions and Talk states are not collapsed',
    );
    assert.equal(
      surface.closest('[aria-live], [role="status"], [role="alert"]'),
      null,
    );
    assert.deepEqual(
      [...surface.querySelectorAll('kbd')].map((node) => node.textContent),
      [
        'Ctrl + Alt + Space',
        'Ctrl + Alt + Backspace',
        'Escape',
        'Tab',
        'Shift + Tab',
        'Enter',
        'Space',
      ],
    );
    assert.ok(
      document.querySelector(
        '.desktop-guide-return[href="#desktop-assistant"]',
      ),
    );
    assert.ok(document.querySelector('.desktop-window-actions'));
    assert.doesNotMatch(surface.textContent ?? '', /Back to sign-in/);
    assert.match(surface.textContent ?? '', /local Windows voice/);
    assert.equal(
      guide.calls.spoken,
      1,
      'Returning users hear local guidance without a saved-marker blocker',
    );
    assert.equal(guide.calls.active, true);
    await act(async () => page.button('Sign out').click());
    assert.equal(guide.calls.active, false);
    assert.equal(document.querySelector('.desktop-guide'), null);
    assert.equal(h.calls.speech.length, 0);
  } finally {
    await page.dispose();
  }
});
