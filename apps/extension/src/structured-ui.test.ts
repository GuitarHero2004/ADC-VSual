import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { act, createElement } from 'react';
import { JSDOM } from 'jsdom';
import ts from 'typescript';
import {
  fingerprintStructuredSnapshot,
  type StructuredRequest,
  type StructuredSnapshot,
  type UiLanguage,
} from '@adc/contracts';
import type { CompanionControls } from './GroundedPanel.tsx';
import type { GroundedController } from './grounded-controller.ts';
import type { OrdersContext } from './page-context.ts';
import type {
  Playback,
  VoiceTransport,
} from '../../../packages/voice-ui/src/controller.ts';
import { ANSWER_PREFERENCES_KEY } from './answer-preferences.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test('article companion shows source excerpts, preserves Speech OFF, and separates answer success from audio lifecycle', async (t) => {
  const hook = registerHooks({
    load(url, context, next) {
      if (!url.endsWith('.tsx')) return next(url, context);
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
            '({ VITE_API_BASE_URL: "http://127.0.0.1:3000" })',
          ),
      };
    },
  });
  const dom = new JSDOM('<div id="root"></div>', {
    url: 'https://extension.example.test/floating.html',
    pretendToBeVisual: true,
  });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    localStorage: dom.window.localStorage,
    HTMLElement: dom.window.HTMLElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  dom.window.localStorage.setItem(
    ANSWER_PREFERENCES_KEY,
    JSON.stringify({ speechEnabled: false }),
  );
  const { browserDependencies } = await import('@adc/voice-ui');
  const { GroundedPanel } = await import('./GroundedPanel.tsx');
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root')!);
  const snapshot: StructuredSnapshot = {
    source_kind: 'structured_page',
    snapshot_id: crypto.randomUUID(),
    document_key: crypto.randomUUID(),
    captured_at: new Date().toISOString(),
    origin: 'https://article.example.test',
    pathname: '/meetings',
    title: 'Accessible meetings',
    tab_id: 10,
    window_id: 20,
    fingerprint: '0'.repeat(64),
    sections: [
      { id: 's1', heading: 'Preparation' },
      { id: 's2', heading: 'Follow-up' },
    ],
    blocks: [
      {
        id: 'b1',
        section_id: 's1',
        kind: 'paragraph',
        text: 'Share the agenda before the meeting.',
      },
      {
        id: 'b2',
        section_id: 's2',
        kind: 'paragraph',
        text: 'Publish the agreed actions afterwards.',
      },
    ],
    coverage: {
      partial: true,
      limitations: ['tables'],
      included_sections: ['s1', 's2'],
    },
  };
  snapshot.fingerprint = await fingerprintStructuredSnapshot(snapshot);
  const events = new Set<() => void>();
  let captures = 0,
    generations = 0,
    plays = 0,
    releases = 0,
    modelCalls = 0;
  const rates: number[] = [];
  let pendingAudio: ReturnType<typeof deferred<Blob>> | null = null;
  let pendingAnswer: ReturnType<typeof deferred<Response>> | null = null;
  let lastRequest: StructuredRequest | null = null;
  let rejectAudio = false;
  const articleContext: OrdersContext = {
    supported: true,
    sourceKind: 'structured_page',
    permission: 'granted',
    capability: 'supported',
    origin: snapshot.origin,
    pathname: snapshot.pathname,
    tabId: 10,
    windowId: 20,
    reason: null,
    title: snapshot.title,
  };
  let pageContext = { ...articleContext };
  let pendingContext: ReturnType<typeof deferred<OrdersContext>> | null = null;
  const page = (): ConstructorParameters<typeof GroundedController>[0] => ({
    getContext: async () =>
      pendingContext ? pendingContext.promise : { ...pageContext },
    capture: async () => {
      captures++;
      return { ...snapshot, snapshot_id: crypto.randomUUID() };
    },
    verify: async () => true,
    subscribe: (listener) => {
      const notify = () => listener('page');
      events.add(notify);
      return () => {
        events.delete(notify);
      };
    },
    reset() {},
    dispose() {},
    returnToPage: async () => ({ restored: true }),
  });
  const response = (request: StructuredRequest) =>
    Response.json({
      source_kind: 'structured_page',
      request_id: request.request_id,
      snapshot_id: request.snapshot.snapshot_id,
      fingerprint: request.snapshot.fingerprint,
      status: 'answer',
      answer_language: 'en',
      text: 'Share the agenda before the meeting.',
      evidence_ids: ['b1'],
      included_section_ids: request.section_id
        ? [request.section_id]
        : ['s1', 's2'],
      partial: true,
    });
  t.mock.method(
    globalThis,
    'fetch',
    async (url: unknown, options: RequestInit) => {
      assert.equal(url, 'https://backend.example.test/api/structured-read');
      assert.equal(
        new Headers(options.headers).get('authorization'),
        'Bearer synthetic-session',
      );
      modelCalls++;
      const request = JSON.parse(String(options.body)) as StructuredRequest;
      lastRequest = request;
      return pendingAnswer ? pendingAnswer.promise : response(request);
    },
  );
  const voice: VoiceTransport = {
    transcribe: async () => {
      assert.fail('No microphone work during typed journey');
    },
    speak: async () => {
      generations++;
      if (rejectAudio)
        throw Object.assign(new Error('Provider quota'), {
          code: 'QUOTA_EXHAUSTED',
        });
      return pendingAudio
        ? pendingAudio.promise
        : new Blob(['mock audio'], { type: 'audio/mpeg' });
    },
  };
  t.mock.method(browserDependencies, 'getMicrophone', async () => {
    assert.fail('No automatic microphone');
  });
  t.mock.method(
    browserDependencies,
    'createObjectURL',
    () => 'blob:structured-audio',
  );
  t.mock.method(browserDependencies, 'revokeObjectURL', () => {});
  t.mock.method(browserDependencies, 'createPlayback', (): Playback => ({
    currentTime: 0,
    playbackRate: 1,
    onended: null,
    onerror: null,
    play: async function () {
      plays++;
      rates.push(this.playbackRate);
    },
    pause() {},
    release() {
      releases++;
    },
  }));
  let controls: CompanionControls | null = null;
  const controlsNow = () => {
    assert.ok(controls);
    return controls;
  };
  const render = (
    sessionKey = 'account-A:workspace-A',
    language: UiLanguage = 'en',
  ) =>
    root.render(
      createElement(GroundedPanel, {
        sessionKey,
        language,
        voiceTransport: voice,
        backend: 'https://backend.example.test',
        getHeaders: async () => ({ Authorization: 'Bearer synthetic-session' }),
        onExpired() {},
        onReady: () => () => {},
        createPage: page,
        autoFocus: false,
        onControls: (next) => {
          controls = next;
        },
      }),
    );
  const click = async (text: string) => {
    const button = [...dom.window.document.querySelectorAll('button')].find(
      (button) => button.textContent === text,
    );
    assert.ok(button, text);
    assert.equal(button.disabled, false, text);
    await act(async () => {
      button.click();
      await flush();
    });
  };
  try {
    await act(async () => {
      render();
      await flush();
    });
    assert.equal(captures, 0);
    assert.equal(modelCalls, 0);
    assert.equal(generations, 0);
    assert.match(
      dom.window.document.body.textContent!,
      /Asking captures the page automatically/,
    );
    assert.match(
      dom.window.document.body.textContent!,
      /When you ask, your question and captured main-content text go through Avis to the configured model service\. Visiting a page does not send its content\./u,
    );
    await t.test(
      'unsupported surfaces explain blocked asking without blocking drafts or showing a disabled Allow control',
      async () => {
        const findButton = (text: string) =>
          [...dom.window.document.querySelectorAll('button')].find(
            (button) => button.textContent === text,
          );
        const question = dom.window.document.querySelector('textarea')!;
        question.focus();
        for (const [origin, pathname, expected] of [
          [
            'https://docs.google.com',
            '/document/d/example/edit',
            'Google Docs document reading is not supported yet.',
          ],
          [
            'https://docs.google.com',
            '/spreadsheets/d/example/edit',
            'Google Sheets spreadsheet reading is not supported yet.',
          ],
          [
            'https://docs.google.com',
            '/presentation/d/example/edit',
            'Google Slides presentation reading is not supported yet.',
          ],
          [
            'https://mail.google.com',
            '/mail/u/0/',
            'Gmail message reading is not supported yet.',
          ],
          [
            'https://article.example.test',
            '/notes.pdf',
            'PDF reading is not supported yet.',
          ],
          [
            'https://article.example.test',
            '/unstructured',
            'This page has no single supported article',
          ],
        ]) {
          await act(async () => {
            pageContext = {
              ...articleContext,
              origin: origin!,
              pathname: pathname!,
              supported: false,
              capability: 'unsupported',
              reason: 'unsupported',
            };
            await controlsNow().controller.refreshContext();
          });
          assert.ok(dom.window.document.body.textContent!.includes(expected!));
          assert.equal(findButton('Allow page processing'), undefined);
          assert.equal(
            dom.window.document.querySelector('.processing-consent'),
            null,
          );
          assert.equal(findButton('Ask VSual')!.disabled, true);
          assert.equal(
            findButton('Ask VSual')!.getAttribute('aria-describedby'),
            'ask-availability',
          );
          assert.equal(findButton('Record question')!.disabled, false);
          assert.equal(
            dom.window.document.querySelector('textarea')!.disabled,
            false,
          );
          assert.equal(findButton('Check active page')!.disabled, false);
          assert.equal(captures, 0);
          assert.equal(modelCalls, 0);
        }
        assert.equal(dom.window.document.activeElement, question);
        await act(async () => {
          controlsNow().question.editText('My draft remains editable.');
          pageContext = {
            ...articleContext,
            origin: 'https://mail.google.com',
            pathname: '/mail/u/0/',
            supported: false,
            capability: 'unsupported',
            reason: 'unsupported',
          };
          await controlsNow().controller.refreshContext();
          render('account-A:workspace-A', 'vi');
        });
        assert.match(
          dom.window.document.body.textContent!,
          /Chưa hỗ trợ đọc thư Gmail/u,
        );
        assert.match(
          dom.window.document.body.textContent!,
          /Bạn vẫn có thể nhập hoặc ghi âm bản nháp/u,
        );
        assert.equal(findButton('Cho phép xử lý trang'), undefined);
        assert.equal(findButton('Ghi âm câu hỏi')!.disabled, false);
        assert.equal(
          dom.window.document.querySelector('textarea')!.value,
          'My draft remains editable.',
        );
        await act(async () => {
          render();
          pageContext = { ...articleContext };
          await controlsNow().controller.refreshContext();
        });
      },
    );
    await t.test(
      'unsupported structure preserves the focused draft and never offers a processing grant',
      async () => {
        const textarea = dom.window.document.querySelector('textarea')!;
        textarea.focus();
        await act(async () => {
          pageContext = {
            ...articleContext,
            supported: false,
            capability: 'unsupported',
            reason: 'unsupported',
          };
          await controlsNow().controller.refreshContext();
        });
        assert.equal(dom.window.document.activeElement, textarea);
        assert.equal(textarea.disabled, false);
        assert.ok(
          ![...dom.window.document.querySelectorAll('button')].some((button) =>
            /Allow page processing|withdraw permission/u.test(
              button.textContent ?? '',
            ),
          ),
        );
        assert.equal(captures, 0);
        assert.equal(modelCalls, 0);
        await act(async () => {
          pageContext = { ...articleContext };
          await controlsNow().controller.refreshContext();
        });
        assert.equal(dom.window.document.activeElement, textarea);
        assert.equal(captures, 0);
        assert.equal(modelCalls, 0);
      },
    );
    assert.equal(captures, 0);
    await click('Capture page content');
    assert.equal(modelCalls, 0);
    assert.match(
      dom.window.document.body.textContent!,
      /Tables and their calculations/,
    );
    const section = dom.window.document.getElementById(
      'structured-section',
    ) as HTMLSelectElement;
    assert.ok(section.labels?.length);
    await act(async () => {
      section.value = 's1';
      section.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
      controlsNow().question.editText('Explain this section.');
    });
    await click('Ask VSual');
    assert.equal((lastRequest as StructuredRequest | null)?.section_id, 's1');
    assert.equal(generations, 0);
    assert.equal(plays, 0);
    const answer = dom.window.document.querySelector('.answer-text')!;
    assert.equal(answer.getAttribute('lang'), 'en');
    assert.equal(
      answer.closest('[aria-live], [role="status"], [role="alert"]'),
      null,
    );
    assert.ok(
      dom.window.document
        .querySelector('.evidence-disclosure blockquote')
        ?.textContent?.includes('agenda'),
    );
    await act(async () => {
      (
        dom.window.document.getElementById(
          'answer-speech-enabled',
        ) as HTMLInputElement
      ).click();
    });
    assert.equal(generations, 0, 'Speech ON does not read an old answer');
    pendingAudio = deferred<Blob>();
    await click('Ask VSual');
    assert.equal(generations, 1);
    assert.ok(dom.window.document.querySelector('.answer-text'));
    assert.match(dom.window.document.body.textContent!, /Preparing audio/);
    await click('Stop speech');
    await act(async () => {
      pendingAudio!.resolve(new Blob(['late']));
      await flush();
    });
    pendingAudio = null;
    assert.equal(plays, 0, 'Stopped synthesis cannot start playback');
    await click('Read answer');
    assert.equal(generations, 2);
    assert.equal(plays, 1);
    await click('Stop speech');
    await click('Read again');
    assert.equal(generations, 2);
    assert.equal(plays, 2);
    assert.deepEqual(rates, [0.9, 0.9]);
    await act(async () => {
      events.forEach((event) => event());
      await flush();
    });
    assert.ok(releases > 0);
    assert.equal(controlsNow().speech.getSnapshot().hasAudio, false);
    rejectAudio = true;
    await click('Ask VSual');
    assert.equal(controlsNow().controller.getSnapshot().phase, 'ready');
    assert.ok(dom.window.document.querySelector('.answer-text'));
    assert.match(
      dom.window.document.body.textContent!,
      /text answer is available/,
    );
    pendingAnswer = deferred<Response>();
    await click('Ask VSual');
    const obsolete = lastRequest!;
    await act(async () => {
      render('account-B:workspace-B');
      await flush();
    });
    await act(async () => {
      pendingAnswer!.resolve(response(obsolete));
      await flush();
    });
    assert.equal(controlsNow().controller.getSnapshot().result, null);
    assert.equal(controlsNow().question.getSnapshot().text, '');
    assert.equal(controlsNow().speech.getSnapshot().hasAudio, false);
    await t.test(
      'returning to a supported source preserves a reviewable draft without automatically capturing or asking',
      async () => {
        pendingAnswer = null;
        rejectAudio = false;
        dom.window.localStorage.setItem(
          ANSWER_PREFERENCES_KEY,
          JSON.stringify({ speechEnabled: false }),
        );
        const before = { captures, modelCalls, generations };
        const findButton = (text: string) =>
          [...dom.window.document.querySelectorAll('button')].find(
            (button) => button.textContent === text,
          );
        await act(async () => {
          pageContext = {
            ...articleContext,
            supported: false,
            capability: 'unsupported',
            reason: 'unsupported',
          };
          render('account-C:workspace-C');
          await flush();
        });
        await act(async () => {
          controlsNow().question.editText(
            'What should be shared before a meeting?',
          );
        });
        assert.equal(findButton('Ask VSual')!.disabled, true);
        assert.equal(findButton('Allow page processing'), undefined);
        const textarea = dom.window.document.querySelector('textarea')!;
        textarea.focus();
        await act(async () => {
          pageContext = { ...articleContext };
          await controlsNow().controller.refreshContext();
        });
        assert.equal(findButton('Ask VSual')!.disabled, false);
        assert.equal(findButton('Allow page processing'), undefined);
        assert.equal(dom.window.document.activeElement, textarea);
        assert.equal(textarea.value, 'What should be shared before a meeting?');
        assert.deepEqual(
          { captures, modelCalls, generations },
          before,
          'Regaining supported browser access does not submit, capture or speak',
        );
        await click('Ask VSual');
        assert.equal(captures, before.captures + 1);
        assert.equal(modelCalls, before.modelCalls + 1);
        assert.equal(
          generations,
          before.generations,
          'Saved Speech OFF remains respected',
        );
        assert.ok(dom.window.document.querySelector('.answer-text'));
      },
    );
    await t.test(
      'a deliberate Ask rechecks browser context before capture and cannot submit twice or resume after cancellation',
      async () => {
        await act(async () => {
          render('account-D:workspace-D');
          await flush();
        });
        await act(async () => {
          controlsNow().question.editText('What should be shared?');
        });
        const before = { captures, modelCalls, generations };
        pendingContext = deferred<OrdersContext>();
        const ask = [...dom.window.document.querySelectorAll('button')].find(
          (button) => button.textContent === 'Ask VSual',
        )!;
        await act(async () => {
          ask.click();
          ask.click();
          await flush();
        });
        assert.deepEqual({ captures, modelCalls, generations }, before);
        assert.equal(ask.disabled, true);
        await click('Cancel request');
        await act(async () => {
          pendingContext!.resolve({ ...articleContext });
          pendingContext = null;
          await flush();
        });
        assert.deepEqual(
          { captures, modelCalls, generations },
          before,
          'A late context check cannot revive a cancelled question',
        );
        assert.equal(
          dom.window.document.querySelector('textarea')!.value,
          'What should be shared?',
        );
        await click('Ask VSual');
        assert.equal(captures, before.captures + 1);
        assert.equal(modelCalls, before.modelCalls + 1);
        assert.equal(generations, before.generations);
        assert.ok(dom.window.document.querySelector('.answer-text'));
      },
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    hook.deregister();
    dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
