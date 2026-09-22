import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { act, createElement } from 'react';
import { JSDOM } from 'jsdom';
import ts from 'typescript';
import type { TranscriptResponse } from '@adc/contracts';
import type {
  MicrophoneStream,
  Recorder,
  VoiceController,
} from './controller.ts';

test('question composer retains text, focus and explicit actions across recording, cancellation and Settings', async () => {
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
  const dom = new JSDOM(
    '<main><div id="root"></div><section id="settings"></section><button id="outside">Settings navigation</button></main>',
    { url: 'https://app.example.test/companion', pretendToBeVisual: true },
  );
  const original = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    localStorage: dom.window.localStorage,
    HTMLElement: dom.window.HTMLElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
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
  const { VoiceTest } = await import('./VoiceTest.tsx');
  const { browserDependencies } = await import('./browser.ts');
  const dependencies = { ...browserDependencies };
  const root = createRoot(dom.window.document.getElementById('root')!);
  let controller!: VoiceController;
  let microphoneCalls = 0;
  let stoppedTracks = 0;
  let resolvePermission!: (stream: MicrophoneStream) => void;
  let resolveTranscript!: (response: TranscriptResponse) => void;
  let rejectTranscript!: (reason: unknown) => void;
  let speechCalls = 0;
  const uploads: Blob[] = [];
  const stream: MicrophoneStream = {
    getTracks: () => [
      {
        stop: () => {
          stoppedTracks += 1;
        },
      },
    ],
  };
  let recorder!: Recorder;
  browserDependencies.getMicrophone = () => {
    microphoneCalls += 1;
    return new Promise((resolve) => {
      resolvePermission = resolve;
    });
  };
  browserDependencies.createRecorder = () => {
    let state = 'inactive';
    recorder = {
      mimeType: 'audio/webm;codecs=opus',
      get state() {
        return state;
      },
      ondata() {},
      onstop() {},
      onerror() {},
      start() {
        state = 'recording';
      },
      stop() {
        state = 'inactive';
        recorder.ondata(new Blob(['final chunk']));
        recorder.onstop();
      },
    };
    return recorder;
  };
  const transport = {
    transcribe: async (audio: Blob) => {
      uploads.push(audio);
      return new Promise<TranscriptResponse>((resolve, reject) => {
        resolveTranscript = resolve;
        rejectTranscript = reject;
      });
    },
    speak: async () => {
      speechCalls += 1;
      return new Blob(['audio'], { type: 'audio/mpeg' });
    },
  };
  const onController = (value: VoiceController) => {
    controller = value;
  };
  const document = dom.window.document;
  const settings = document.getElementById('settings')!;
  const outside = document.getElementById('outside')!;
  const button = (name: string) =>
    [...document.querySelectorAll('button')].find(
      (item) => item.textContent === name,
    )!;
  const render = (
    language: 'en' | 'vi' = 'en',
    mode: 'question' | 'test' = 'question',
  ) =>
    act(async () => {
      root.render(
        createElement(VoiceTest, {
          transport,
          sessionKey: 'test-session',
          mode,
          uiLanguage: language,
          preferencesTarget: settings,
          onController,
        }),
      );
    });
  try {
    await render();
    const textarea = document.querySelector('textarea')!;
    assert.equal(
      document.querySelector(`label[for="${textarea.id}"]`)?.textContent,
      'Your question',
    );
    assert.equal(button('Read back'), undefined);
    assert.equal(microphoneCalls, 0);
    assert.equal(speechCalls, 0);
    assert.equal(uploads.length, 0);
    assert.ok(settings.querySelector('select'));
    assert.equal(document.querySelector('.voice-test select'), null);
    assert.equal(controller.getSnapshot().speechEnabled, false);
    assert.equal(textarea.closest('[aria-live], [role=status]'), null);
    assert.ok(
      textarea.compareDocumentPosition(button('Record question')) &
        dom.window.Node.DOCUMENT_POSITION_FOLLOWING,
    );
    await act(async () => {
      textarea.focus();
      Object.getOwnPropertyDescriptor(
        dom.window.HTMLTextAreaElement.prototype,
        'value',
      )!.set!.call(textarea, 'Compare completed orders\nin July and August.');
      textarea.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
    assert.equal(controller.getSnapshot().text, textarea.value);
    const enter = new dom.window.KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
      isComposing: true,
    });
    textarea.dispatchEvent(enter);
    assert.equal(enter.defaultPrevented, false);
    assert.equal(uploads.length, 0);
    await act(async () => {
      button('Record question').focus();
      button('Record question').click();
    });
    assert.ok(button('Cancel recording'));
    await act(async () => resolvePermission(stream));
    assert.equal(controller.getSnapshot().phase, 'recording');
    assert.ok(button('Stop and review'));
    recorder.ondata(new Blob(['first chunk;']));
    await act(async () => {
      button('Stop and review').click();
      button('Stop and review')?.click();
    });
    assert.equal(uploads.length, 1);
    assert.equal(await uploads[0]!.text(), 'first chunk;final chunk');
    assert.equal(controller.getSnapshot().phase, 'transcribing');
    outside.focus();
    await act(async () =>
      resolveTranscript({
        transcript: 'Lọc doanh thu tháng chín.',
        request_id: 'test-request',
      }),
    );
    assert.equal(document.activeElement, outside);
    assert.equal(document.querySelector('textarea'), textarea);
    assert.equal(textarea.value, 'Lọc doanh thu tháng chín.');
    assert.match(
      document.querySelector('[role=status]')!.textContent!,
      /ready to review/,
    );
    assert.equal(uploads.length, 1);
    assert.equal(speechCalls, 0);

    // Preferences preserve the same composer and do not trigger any provider.
    const recognition = settings.querySelector('select')!;
    await act(async () => {
      recognition.focus();
      recognition.value = 'vi';
      recognition.dispatchEvent(
        new dom.window.Event('change', { bubbles: true }),
      );
    });
    assert.equal(document.activeElement, recognition);
    assert.equal(textarea.value, 'Lọc doanh thu tháng chín.');
    await render('vi');
    assert.equal(document.querySelector('textarea'), textarea);
    assert.equal(document.activeElement, recognition);
    assert.ok(button('Ghi âm câu hỏi'));
    await render();
    assert.equal(uploads.length, 1);
    assert.equal(speechCalls, 0);

    // Cancelling while permission is pending discards a later stream and returns focus.
    await act(async () => button('Record question').click());
    await act(async () => {
      button('Cancel recording').focus();
      button('Cancel recording').click();
    });
    assert.equal(document.activeElement, button('Record question'));
    const stopsBefore = stoppedTracks;
    await act(async () => resolvePermission(stream));
    assert.equal(stoppedTracks, stopsBefore + 1);
    assert.equal(uploads.length, 1);
    assert.equal(textarea.value, 'Lọc doanh thu tháng chín.');

    // A recoverable asynchronous error keeps both draft and unrelated focus.
    await act(async () => button('Record question').click());
    await act(async () => resolvePermission(stream));
    await act(async () => button('Stop and review').click());
    outside.focus();
    await act(async () =>
      rejectTranscript(
        Object.assign(new Error('timeout'), { code: 'timeout' }),
      ),
    );
    assert.equal(document.activeElement, outside);
    assert.equal(textarea.value, 'Lọc doanh thu tháng chín.');
    assert.match(
      document.querySelector('[role=status]')!.textContent!,
      /timed out/,
    );
    assert.equal(button('Record question').disabled, false);

    await act(async () => button('Record question').click());
    await act(async () => resolvePermission(stream));
    await act(async () => button('Stop and review').click());
    const usage = {
      minute_count: 24,
      minute_limit: 24,
      day_count: 73,
      day_limit: 240,
      limited_by: 'minute',
      retry_after_seconds: 42,
      retry_at: '2026-09-21T00:01:00.000Z',
    };
    await act(async () =>
      rejectTranscript({ code: 'APP_RATE_LIMITED', usage }),
    );
    assert.match(
      document.querySelector('[role=status]')!.textContent!,
      /^Transcription could not finish\./,
    );
    const usageNotice = document.querySelector('.usage-limit-notice')!;
    assert.match(usageNotice.textContent!, /24 \/ 24 requests/);
    assert.equal(
      usageNotice.closest('[role=status], [role=alert], [aria-live]'),
      null,
    );
    assert.equal(usageNotice.querySelector('time')!.dateTime, usage.retry_at);
    assert.equal(textarea.value, 'Lọc doanh thu tháng chín.');

    await act(async () => controller.editText('😀'.repeat(1001)));
    assert.equal(document.querySelector('.usage-limit-notice'), null);
    assert.equal(textarea.getAttribute('aria-invalid'), 'true');
    assert.match(
      document.getElementById(
        textarea.getAttribute('aria-describedby')!.split(' ')[1]!,
      )!.textContent!,
      /1001 \/ 1000 characters.*before asking/,
    );
    await act(async () => button('Clear question').click());
    assert.equal(textarea.value, '');
    assert.equal(document.activeElement, textarea);
    assert.equal(textarea.getAttribute('aria-invalid'), null);

    // A silence completion must not remove the review choice while STT runs.
    const beforeReviewUploads = uploads.length;
    await act(async () => button('Record question').click());
    await act(async () => resolvePermission(stream));
    const review = button('Stop and review');
    await act(async () => {
      review.focus();
      controller.finish('silence');
    });
    assert.equal(controller.getSnapshot().phase, 'transcribing');
    assert.equal(button('Stop and review'), review);
    assert.equal(review.disabled, false);
    assert.equal(document.activeElement, review);
    await act(async () => review.click());
    await act(async () =>
      resolveTranscript({
        transcript: 'Inspect this chart after I review the transcript.',
        request_id: 'silence-review',
      }),
    );
    assert.equal(uploads.length, beforeReviewUploads + 1);
    assert.equal(await uploads.at(-1)!.text(), 'final chunk');
    assert.equal(
      textarea.value,
      'Inspect this chart after I review the transcript.',
    );
    assert.equal(controller.claimAutomaticQuestion(), null);

    // Standalone voice setup also announces asynchronous outcomes without stealing focus.
    await render('en', 'test');
    await act(async () => button('Start recording').click());
    recognition.focus();
    await act(async () => resolvePermission(stream));
    assert.equal(
      document.activeElement,
      recognition,
      'Permission resolution must not move focus out of preferences',
    );
    await act(async () => {
      button('Finish and transcribe').focus();
      button('Finish and transcribe').click();
    });
    assert.equal(
      document.activeElement,
      button('Cancel operation'),
      'Removing the focused Finish control restores a reachable action',
    );
    recognition.focus();
    await act(async () =>
      resolveTranscript({
        transcript: 'Review this recording.',
        request_id: 'setup-test',
      }),
    );
    assert.equal(
      document.activeElement,
      recognition,
      'Standalone transcription must preserve Settings focus',
    );
    assert.equal(
      document.querySelector('textarea')!.value,
      'Review this recording.',
    );
    await act(async () => button('Start recording').click());
    outside.focus();
    await act(async () => resolvePermission(stream));
    assert.equal(document.activeElement, outside);
    await act(async () => button('Finish and transcribe').click());
    outside.focus();
    await act(async () =>
      rejectTranscript(
        Object.assign(new Error('timeout'), { code: 'timeout' }),
      ),
    );
    assert.equal(
      document.activeElement,
      outside,
      'Standalone failure must not steal focus',
    );
    assert.equal(
      document.querySelector('textarea')!.value,
      'Review this recording.',
    );
    await act(async () => button('Start recording').click());
    await act(async () => resolvePermission(stream));
    await act(async () => {
      button('Finish and transcribe').focus();
      button('Finish and transcribe').click();
    });
    assert.equal(document.activeElement, button('Cancel operation'));
    await act(async () =>
      resolveTranscript({ transcript: 'Ready.', request_id: 'setup-complete' }),
    );
    assert.equal(
      document.activeElement,
      button('Start recording'),
      'Removing focused Cancel recovers focus without moving it from another control',
    );
  } finally {
    await act(async () => root.unmount());
    Object.assign(browserDependencies, dependencies);
    dom.window.close();
    hook.deregister();
    for (const [name, value] of original) {
      if (value) Object.defineProperty(globalThis, name, value);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
