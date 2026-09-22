import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { act, createElement } from 'react';
import { JSDOM } from 'jsdom';
import ts from 'typescript';
import type { AuthStatus } from '@adc/contracts';
import type { FloatingClient } from './floating-client.ts';

// This focused boundary test renders the actual App and FloatingToolbar. The
// companion controller is driven deterministically; no microphone/provider or
// browser screenshot APIs are represented as live-tested by this UI harness.
const companionHarness = `
import {createElement as h, useEffect, useSyncExternalStore} from 'react';
const listeners = new Set();
const idleVoice = {phase:'idle',text:'Private question draft',errorCode:null,notice:'idle',silenceSecondsRemaining:null};
let page = {reader:'visual_page',phase:'idle',error:null,result:null,stale:false,context:{supported:true,permission:'granted'}};
const publish = () => listeners.forEach(fn => fn());
export const surfaceHarness = {mounts:0,unmounts:0,cancels:0,
  phase(phase) {page={...page,phase}; publish();},
  notify(){publish();}
};
const controller = {
  subscribe(fn){listeners.add(fn); return () => listeners.delete(fn);},
  getSnapshot(){return page;},
  get busy(){return ['reading','understanding'].includes(page.phase);},
  cancel(){surfaceHarness.cancels++; surfaceHarness.phase('idle');},
  discardAutomaticSpeech(){},clearTransient(){}
};
const voice={subscribe(){return () => {};},getSnapshot(){return idleVoice;},cancel(){},stopPlayback(){},start(){},finish(){}};
const controls={controller,question:voice,speech:voice};
export function GroundedPanel(props){
  const state=useSyncExternalStore(controller.subscribe,controller.getSnapshot);
  useEffect(() => {
    surfaceHarness.mounts++; props.onControls(controls);
    const remove=props.onReady(() => {}, () => controller.cancel());
    return () => {surfaceHarness.unmounts++; remove(); props.onControls(null);};
  },[props.onControls,props.onReady]);
  const busy=['reading','understanding'].includes(state.phase);
  return h('section',{id:'surface-private-content'},
    h('h2',{id:'surface-answer-heading',tabIndex:-1},'Current page'),
    h('label',{htmlFor:'surface-question'},'Question'),
    h('textarea',{id:'surface-question',defaultValue:'Private question draft',disabled:busy}),
    h('button',{id:'surface-ask',type:'button',disabled:busy,onClick:()=>surfaceHarness.phase('reading')},'Ask VSual'),
    h('p',null,'Private previous answer and evidence'));
}
`;

test('actual floating App keeps the private companion mounted while capture cancellation and focus remain usable', async () => {
  const environment = {
    VITE_API_BASE_URL: 'http://127.0.0.1:3000',
    VITE_SUPABASE_URL: 'https://auth.example.test',
    VITE_SUPABASE_PUBLISHABLE_KEY: ['sb', 'publishable', 'fixture'].join('_'),
  };
  const hooks = registerHooks({
    load(url, context, next) {
      if (url.endsWith('/GroundedPanel.tsx'))
        return {
          format: 'module',
          shortCircuit: true,
          source: companionHarness,
        };
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
    url: 'https://extension.example.test/floating.html',
    pretendToBeVisual: true,
  });
  const original = new Map<string, PropertyDescriptor | undefined>();
  const expose = (key: string, value: unknown) => {
    original.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
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
  expose('getComputedStyle', dom.window.getComputedStyle.bind(dom.window));
  expose('IS_REACT_ACT_ENVIRONMENT', true);
  expose(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  expose(
    'BroadcastChannel',
    class {
      onmessage: unknown;
      postMessage() {}
      close() {}
    },
  );
  expose('fetch', () =>
    assert.fail('Capture surface presentation must not make provider requests'),
  );
  const status: AuthStatus = {
    phase: 'signed_in',
    account: { id: crypto.randomUUID(), email: 'member@example.test' },
    workspace: 'allowed',
    epoch: crypto.randomUUID(),
    attempt: null,
    error: null,
    logoutConfirmed: null,
  };
  const noEvents = { addListener() {}, removeListener() {} };
  expose('chrome', {
    runtime: {
      async sendMessage() {
        return { ok: true, status };
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
    storage: { onChanged: noEvents },
    tabs: { async create() {} },
  });
  const floating = {
    subscribe() {
      return () => {};
    },
    ready() {},
    reportSpeech() {},
    stopSpeech() {},
    layout() {},
    claim() {},
    async preparePage() {},
    createPage() {
      assert.fail('Mock controller must not read a page');
    },
    async openSidePanel() {
      return true;
    },
  } as unknown as FloatingClient;
  const { App } = await import('./App.tsx');
  const { surfaceHarness } =
    (await import('./GroundedPanel.tsx')) as unknown as {
      surfaceHarness: {
        mounts: number;
        unmounts: number;
        cancels: number;
        phase(phase: string): void;
        notify(): void;
      };
    };
  const { createRoot } = await import('react-dom/client');
  const document = dom.window.document;
  const root = createRoot(document.getElementById('root')!);
  const settle = async (action: () => void) =>
    act(async () => {
      action();
      await new Promise<void>((resolve) => setImmediate(resolve));
      await new Promise<void>((resolve) => setImmediate(resolve));
    });
  const visible = (element: Element) => !element.closest('[hidden]');
  const button = (name: string) => {
    const value = [...document.querySelectorAll('button')].find(
      (element) =>
        visible(element) &&
        (element.getAttribute('aria-label') ?? element.textContent) === name,
    );
    assert.ok(value, `Missing visible control: ${name}`);
    return value;
  };
  try {
    await settle(() =>
      root.render(
        createElement<{ floating: FloatingClient }>(App, { floating }),
      ),
    );
    await settle(() => button('Open VSual companion').click());
    const main = document.getElementById('floating-expanded')!;
    const privateContent = document.getElementById('surface-private-content')!;
    const draft = document.getElementById(
      'surface-question',
    ) as HTMLTextAreaElement;
    const ask = document.getElementById('surface-ask') as HTMLButtonElement;
    const capture = document.querySelector<HTMLElement>(
      '.visual-capture-controls',
    )!;
    const cancel = capture.querySelector<HTMLButtonElement>('button')!;
    let cancelFocus = 0;
    cancel.addEventListener('focus', () => {
      cancelFocus++;
    });

    await settle(() => {
      ask.focus();
      ask.click();
    });
    assert.equal(main.hidden, true);
    assert.equal(privateContent.isConnected, true);
    assert.equal(document.getElementById('surface-question'), draft);
    assert.equal(draft.value, 'Private question draft');
    assert.equal(capture.hidden, false);
    assert.equal(cancel.disabled, false);
    assert.equal(document.activeElement, cancel);
    assert.equal(cancelFocus, 1);
    assert.equal(
      document.querySelector<HTMLElement>('.panel-header')!.hidden,
      true,
    );
    assert.equal(surfaceHarness.mounts, 1);
    assert.equal(surfaceHarness.unmounts, 0);
    await settle(() => {
      surfaceHarness.notify();
      root.render(
        createElement<{ floating: FloatingClient }>(App, { floating }),
      );
    });
    assert.equal(cancelFocus, 1, 'Rerenders must not repeatedly focus Cancel');

    await settle(() => cancel.click());
    assert.equal(surfaceHarness.cancels, 1);
    assert.equal(capture.hidden, true);
    assert.equal(main.hidden, false);
    assert.equal(
      document.activeElement,
      ask,
      'Cancellation restores the now-enabled previous Ask control',
    );

    await settle(() => {
      ask.focus();
      ask.click();
    });
    await settle(() => surfaceHarness.phase('understanding'));
    assert.equal(ask.disabled, true);
    assert.equal(draft.disabled, true);
    assert.equal(capture.hidden, true);
    assert.equal(
      document.activeElement?.tagName,
      'H2',
      'Pending model work restores a readable heading instead of disabled Ask',
    );
    assert.equal(document.activeElement?.getAttribute('tabindex'), '-1');
    assert.equal(document.activeElement?.closest('[hidden]'), null);

    await settle(() => surfaceHarness.phase('idle'));
    await settle(() => button('Collapse companion').click());
    const launcher = button('Open VSual companion');
    launcher.focus();
    await settle(() => surfaceHarness.phase('reading'));
    assert.equal(document.activeElement, cancel);
    assert.equal(privateContent.isConnected, true);
    assert.equal(main.hidden, true);
    await settle(() => surfaceHarness.phase('understanding'));
    assert.equal(main.hidden, true);
    assert.equal(
      document.activeElement?.closest('[hidden]'),
      null,
      'Collapsed capture must not focus the hidden main content',
    );
    assert.equal(document.activeElement, button('Expand companion'));

    await settle(() => surfaceHarness.phase('reading'));
    const beforeEscape = surfaceHarness.cancels;
    await settle(() =>
      cancel.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    assert.equal(
      surfaceHarness.cancels,
      beforeEscape + 1,
      'Escape cancels once and does not bubble into a second cancellation',
    );
    assert.equal(capture.hidden, true);
    assert.equal(document.activeElement?.closest('[hidden]'), null);
    assert.equal(surfaceHarness.mounts, 1);
    assert.equal(surfaceHarness.unmounts, 0);
  } finally {
    await act(async () => root.unmount());
    hooks.deregister();
    dom.window.close();
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
