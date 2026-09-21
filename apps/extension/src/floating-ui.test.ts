import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { act, createElement, useCallback, useState } from 'react';
import { JSDOM } from 'jsdom';
import ts from 'typescript';
import {
  fingerprintSnapshot,
  type GroundedRequest,
  type GroundedSnapshot,
  type TranscriptResponse,
} from '@adc/contracts';
import type {
  MicrophoneStream,
  Playback,
  Recorder,
  VoiceDependencies,
  VoiceTransport,
} from '../../../packages/voice-ui/src/controller.ts';
import type { CompanionControls } from './GroundedPanel.tsx';
import type { GroundedController } from './grounded-controller.ts';
import { calculateComparison } from '../../web/utils/grounded/comparison.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('floating compact and expanded views keep one session and release all work when ended', async (t) => {
  const hook = registerHooks({
    load(url, context, next) {
      if (!url.endsWith('.tsx')) return next(url, context);
      const source = ts
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
        );
      return { format: 'module', shortCircuit: true, source };
    },
  });
  const dom = new JSDOM(
    '<button id="outside">Existing page control</button><div id="root"></div>',
    {
      url: 'https://extension.example.test/floating.html',
      pretendToBeVisual: true,
    },
  );
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    localStorage: dom.window.localStorage,
    HTMLElement: dom.window.HTMLElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value,
    });
  }
  const source: GroundedSnapshot = {
    snapshot_id: crypto.randomUUID(),
    document_key: crypto.randomUUID(),
    adapter_key: 'orders-fixture@1',
    captured_at: new Date().toISOString(),
    origin: 'http://127.0.0.1:3000',
    pathname: '/orders',
    title: 'Sample orders',
    table_title: 'Completed orders',
    region: 'South',
    year: 2026,
    metric: 'completed_orders',
    unit: 'orders',
    locale: 'en-US',
    is_complete: true,
    rows: [
      {
        id: 'july',
        period: '2026-07',
        region: 'South',
        raw_value: '1,200',
        value: 1200,
      },
      {
        id: 'august',
        period: '2026-08',
        region: 'South',
        raw_value: '900',
        value: 900,
      },
    ],
    fingerprint: '0'.repeat(64),
  };
  source.fingerprint = await fingerprintSnapshot(source);
  const calls = {
    pageFactories: 0,
    captures: 0,
    microphone: 0,
    stoppedTracks: 0,
    pageDisposals: 0,
    activity: 0,
  };
  const pageFactory = (): ConstructorParameters<
    typeof GroundedController
  >[0] => {
    calls.pageFactories++;
    return {
      async getContext() {
        return {
          supported: true,
          origin: source.origin,
          pathname: '/orders',
          tabId: 10,
          windowId: 20,
          reason: null,
        };
      },
      async capture() {
        calls.captures++;
        return { ...source, snapshot_id: crypto.randomUUID() };
      },
      async verify() {
        return true;
      },
      subscribe() {
        return () => {};
      },
      async returnToPage() {
        return { restored: true };
      },
      reset() {},
      dispose() {
        calls.pageDisposals++;
      },
    };
  };
  const { browserDependencies } = await import('@adc/voice-ui');
  const { GroundedPanel } = await import('./GroundedPanel.tsx');
  const { FloatingToolbar } = await import('./FloatingToolbar.tsx');
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root')!);
  const activityDependencies = browserDependencies as Required<
    Pick<VoiceDependencies, 'now' | 'observeAudioActivity'>
  >;
  let clock = 0;
  let nextTimer = 0;
  const timers = new Map<number, { due: number; callback(): void }>();
  let onAudioActivity: (() => void) | null = null;
  t.mock.method(activityDependencies, 'now', () => clock);
  t.mock.method(
    browserDependencies,
    'schedule',
    (callback: () => void, delay: number) => {
      const id = ++nextTimer;
      timers.set(id, { due: clock + delay, callback });
      return id;
    },
  );
  t.mock.method(browserDependencies, 'unschedule', (id: unknown) => {
    timers.delete(id as number);
  });
  t.mock.method(
    activityDependencies,
    'observeAudioActivity',
    async (_stream: MicrophoneStream, activity: () => void) => {
      onAudioActivity = activity;
      return () => {
        if (onAudioActivity === activity) onAudioActivity = null;
      };
    },
  );
  const stream: MicrophoneStream = {
    getTracks: () => [
      {
        stop: () => {
          calls.stoppedTracks++;
        },
      },
    ],
  };
  let permission: ReturnType<typeof deferred<MicrophoneStream>> | null = null;
  t.mock.method(browserDependencies, 'getMicrophone', async () => {
    calls.microphone++;
    return permission ? permission.promise : stream;
  });
  const recorders: Recorder[] = [];
  t.mock.method(browserDependencies, 'createRecorder', () => {
    let recording = false;
    const recorder: Recorder = {
      mimeType: 'audio/webm;codecs=opus',
      get state() {
        return recording ? 'recording' : 'inactive';
      },
      ondata() {},
      onstop() {},
      onerror() {},
      start() {
        recording = true;
      },
      stop() {
        recording = false;
        recorder.ondata(new Blob(['final chunk']));
        recorder.onstop();
      },
    };
    recorders.push(recorder);
    return recorder;
  });
  const audio = {
    plays: 0,
    pauses: 0,
    releases: 0,
    created: 0,
    revoked: [] as string[],
    rates: [] as number[],
  };
  t.mock.method(
    browserDependencies,
    'createObjectURL',
    () => `blob:floating-${++audio.created}`,
  );
  t.mock.method(browserDependencies, 'revokeObjectURL', (url: string) => {
    audio.revoked.push(url);
  });
  t.mock.method(browserDependencies, 'createPlayback', (): Playback => ({
    currentTime: 0,
    playbackRate: 1,
    onended: null,
    onerror: null,
    async play() {
      audio.plays++;
      audio.rates.push(this.playbackRate);
    },
    pause() {
      audio.pauses++;
    },
    release() {
      audio.releases++;
    },
  }));
  const uploads: { blob: Blob; signal: AbortSignal }[] = [];
  const speech: { text: string; signal: AbortSignal }[] = [];
  const questions: GroundedRequest[] = [];
  let transcription: ReturnType<typeof deferred<TranscriptResponse>> | null =
    null;
  let synthesis: ReturnType<typeof deferred<Blob>> | null = null;
  let answer: ReturnType<typeof deferred<Response>> | null = null;
  let questionSignal: AbortSignal | null = null;
  const transcript =
    'Compare completed orders in the South for August and July.';
  const transport: VoiceTransport = {
    async transcribe(blob, _filename, _language, signal) {
      uploads.push({ blob, signal });
      return transcription
        ? transcription.promise
        : { transcript, request_id: crypto.randomUUID() };
    },
    async speak(text, _language, signal) {
      speech.push({ text, signal });
      return synthesis
        ? synthesis.promise
        : new Blob(['generated audio'], { type: 'audio/mpeg' });
    },
  };
  const responseFor = (request: GroundedRequest) =>
    Response.json(
      calculateComparison(request, {
        answer_language: 'en',
        decision: 'comparison',
        operation: 'compare',
        metric: 'completed_orders',
        region: 'South',
        baseline_period: '2026-07',
        comparison_period: '2026-08',
        reason: null,
      }),
    );
  t.mock.method(
    globalThis,
    'fetch',
    async (_url: unknown, options?: RequestInit) => {
      const request = JSON.parse(String(options?.body)) as GroundedRequest;
      questions.push(request);
      questionSignal = options?.signal ?? null;
      return answer ? answer.promise : responseFor(request);
    },
  );
  let latest: CompanionControls | null = null;
  const onReady = () => () => {};
  const getHeaders = async () => ({
    Authorization: 'Bearer synthetic-session',
  });
  function Presentation({ sessionKey }: { sessionKey: string }) {
    const [controls, setControls] = useState<CompanionControls | null>(null);
    const [expanded, setExpanded] = useState(false);
    const [open, setOpen] = useState(true);
    const receiveControls = useCallback((next: CompanionControls | null) => {
      latest = next;
      setControls(next);
    }, []);
    if (!open) return createElement('p', null, 'Companion ended');
    return createElement(
      'div',
      null,
      createElement(
        'button',
        { id: 'toggle', onClick: () => setExpanded(!expanded) },
        expanded ? 'Collapse companion' : 'Expand companion',
      ),
      createElement(
        'button',
        { id: 'end', onClick: () => setOpen(false) },
        'End companion',
      ),
      createElement(
        'div',
        { id: 'expanded', hidden: !expanded },
        createElement(GroundedPanel, {
          sessionKey,
          language: 'en',
          voiceTransport: transport,
          backend: 'https://backend.example.test',
          getHeaders,
          onExpired() {
            assert.fail('No auth failures expected');
          },
          onReady,
          createPage: pageFactory,
          autoFocus: false,
          onControls: receiveControls,
        }),
      ),
      createElement(
        'div',
        { id: 'compact', hidden: expanded },
        controls
          ? createElement(FloatingToolbar, {
              controls,
              language: 'en',
              onExpand: () => setExpanded(true),
              onActivity: () => {
                calls.activity++;
              },
            })
          : null,
      ),
    );
  }
  const document = dom.window.document;
  const flush = () => new Promise<void>((done) => setImmediate(done));
  async function settle(action: () => void) {
    await act(async () => {
      action();
      await flush();
      await flush();
    });
  }
  function button(name: string, region = '') {
    const scope = region ? document.querySelector(region)! : document;
    const control = [...scope.querySelectorAll('button')].find(
      (item) => item.textContent === name,
    );
    assert.ok(control, `Missing ${name} in ${region || 'document'}`);
    return control;
  }
  function controls() {
    assert.ok(latest);
    return latest;
  }
  function advance(ms: number) {
    const until = clock + ms;
    while (true) {
      const due = [...timers.entries()]
        .filter(([, value]) => value.due <= until)
        .sort((a, b) => a[1].due - b[1].due)[0];
      if (!due) break;
      clock = due[1].due;
      timers.delete(due[0]);
      due[1].callback();
    }
    clock = until;
  }
  const mount = (sessionKey: string) =>
    settle(() =>
      root.render(createElement(Presentation, { key: sessionKey, sessionKey })),
    );
  const expand = () => settle(() => button('Expand companion').click());
  const collapse = () => settle(() => button('Collapse companion').click());
  const expandAndFill = async () => {
    await expand();
    assert.equal(
      [...document.querySelectorAll('button')].some(
        (control) => control.textContent === 'Allow page processing',
      ),
      false,
    );
    await settle(() => button('Use example question', '#expanded').click());
  };
  try {
    await t.test(
      'standby reads no content, records nothing and leaves existing focus alone',
      async () => {
        const outside = document.getElementById('outside')!;
        outside.focus();
        await mount('first-session');
        assert.ok(controls());
        assert.equal(document.activeElement, outside);
        assert.equal(
          document.querySelector<HTMLElement>('#expanded')!.hidden,
          true,
        );
        assert.equal(calls.pageFactories, 1);
        assert.equal(calls.captures, 0);
        assert.equal(calls.microphone, 0);
        assert.equal(questions.length, 0);
        assert.equal(uploads.length, 0);
        assert.equal(speech.length, 0);
      },
    );

    await t.test(
      'expansion and collapse retain the same draft, answer, evidence and audio session',
      async () => {
        const firstControls = controls();
        await expandAndFill();
        const textarea =
          document.querySelector<HTMLTextAreaElement>('textarea')!;
        const draft = textarea.value;
        await collapse();
        assert.equal(controls(), firstControls);
        assert.equal(controls().question.getSnapshot().text, draft);
        await expand();
        assert.equal(document.querySelector('textarea'), textarea);
        assert.equal(textarea.value, draft);
        await settle(() => button('Ask VSual', '#expanded').click());
        assert.equal(questions.length, 1);
        assert.equal(speech.length, 1);
        const answerText = document.querySelector('.answer-text')!;
        const value = answerText.textContent;
        assert.match(value!, /decreased by 300, or 25%/);
        const evidence = document.querySelector<HTMLDetailsElement>(
          '.evidence-disclosure',
        )!;
        await settle(() => evidence.querySelector('summary')!.click());
        assert.equal(evidence.open, true);
        const plays = audio.plays;
        await collapse();
        assert.equal(controls(), firstControls);
        assert.equal(controls().speech.getSnapshot().phase, 'speaking');
        await expand();
        assert.equal(document.querySelector('.answer-text'), answerText);
        assert.equal(answerText.textContent, value);
        assert.equal(document.querySelector('.evidence-disclosure'), evidence);
        assert.equal(evidence.open, true);
        assert.equal(speech.length, 1);
        assert.equal(audio.plays, plays);
        assert.equal(calls.pageFactories, 1);
        assert.equal(calls.captures, 1);
        assert.deepEqual(audio.rates, [0.9]);
      },
    );

    await t.test(
      'compact recording interrupts speech and manual Stop reviews without submitting',
      async () => {
        await collapse();
        const pauses = audio.pauses;
        await settle(() => button('Start recording', '#compact').click());
        assert.ok(audio.pauses > pauses);
        assert.equal(controls().speech.getSnapshot().phase, 'ready');
        assert.equal(controls().question.getSnapshot().phase, 'recording');
        recorders.at(-1)!.ondata(new Blob(['first phrase;']));
        await settle(() => button('Stop and review', '#compact').click());
        assert.equal(uploads.length, 1);
        assert.equal(await uploads[0]!.blob.text(), 'first phrase;final chunk');
        assert.equal(
          questions.length,
          1,
          'Manual Stop cannot silently submit a question',
        );
        assert.equal(speech.length, 1);
        assert.equal(controls().question.getSnapshot().text, transcript);
        await expand();
        assert.equal(
          document.querySelector<HTMLTextAreaElement>('textarea')!.value,
          transcript,
        );
        assert.equal(button('Ask VSual', '#expanded').disabled, false);
      },
    );

    await t.test(
      'compact silence completion submits once and uses the same expanded answer controls',
      async () => {
        await collapse();
        await settle(() => button('Start recording', '#compact').click());
        assert.ok(onAudioActivity);
        await settle(() => (onAudioActivity as () => void)());
        await settle(() => advance(4_000));
        await settle(() => (onAudioActivity as () => void)());
        await settle(() => advance(4_999));
        assert.equal(controls().question.getSnapshot().phase, 'recording');
        assert.equal(uploads.length, 1);
        await settle(() => advance(1));
        assert.equal(uploads.length, 2);
        assert.equal(questions.length, 2);
        assert.equal(questions.at(-1)!.question, transcript);
        assert.equal(speech.length, 2);
        assert.equal(calls.captures, 2);
        assert.equal(controls().speech.getSnapshot().phase, 'speaking');
        assert.equal(button('Stop speech', '#compact').disabled, false);
        await settle(() => button('Stop speech', '#compact').click());
        await expand();
        const plays = audio.plays;
        await settle(() => button('Read again', '#expanded').click());
        assert.equal(audio.plays, plays + 1);
        assert.equal(speech.length, 2, 'Repeat never generates another clip');
        const toggle = document.querySelector<HTMLInputElement>(
          '#answer-speech-enabled',
        )!;
        await settle(() => toggle.click());
        assert.equal(controls().speech.getSnapshot().speechEnabled, false);
        assert.equal(button('Read again', '#expanded').disabled, true);
        const stoppedPlays = audio.plays;
        await collapse();
        await expand();
        await settle(() => button('Read again', '#expanded').click());
        assert.equal(audio.plays, stoppedPlays);
        await settle(() => toggle.click());
        assert.equal(
          audio.plays,
          stoppedPlays,
          'Enabling Speech does not replay an old answer',
        );
        await settle(() => button('Read again', '#expanded').click());
        assert.equal(speech.length, 2);
        assert.equal(audio.rates.at(-1), 0.9);
      },
    );

    await t.test(
      'ending the floating surface aborts pending speech and a late clip stays silent',
      async () => {
        synthesis = deferred<Blob>();
        await settle(() => button('Ask VSual', '#expanded').click());
        assert.ok(document.querySelector('.answer-text'));
        const old = controls();
        assert.equal(old.speech.getSnapshot().phase, 'generating');
        await collapse();
        const plays = audio.plays;
        const allocated = audio.created;
        await settle(() => button('End companion').click());
        assert.equal(speech.at(-1)!.signal.aborted, true);
        assert.equal(old.question.getSnapshot().text, '');
        assert.equal(old.controller.getSnapshot().result, null);
        assert.equal(old.speech.getSnapshot().hasAudio, false);
        assert.equal(timers.size, 0);
        await settle(() =>
          synthesis!.resolve(new Blob(['late answer'], { type: 'audio/mpeg' })),
        );
        assert.equal(audio.plays, plays);
        assert.equal(audio.created, allocated);
        assert.equal(calls.pageDisposals, 1);
        assert.equal(latest, null);
        synthesis = null;
      },
    );

    await t.test(
      'ending during pending microphone permission releases the eventual stream',
      async () => {
        permission = deferred<MicrophoneStream>();
        await mount('second-session');
        await settle(() => button('Start recording', '#compact').click());
        assert.equal(
          controls().question.getSnapshot().phase,
          'requesting_permission',
        );
        const beforeRecorders = recorders.length;
        const beforeStops = calls.stoppedTracks;
        await settle(() => button('End companion').click());
        await settle(() => permission!.resolve(stream));
        assert.equal(calls.stoppedTracks, beforeStops + 1);
        assert.equal(recorders.length, beforeRecorders);
        assert.equal(timers.size, 0);
        permission = null;
      },
    );

    await t.test(
      'ending during transcription prevents late text from reappearing or submitting',
      async () => {
        transcription = deferred<TranscriptResponse>();
        await mount('third-session');
        await expandAndFill();
        await collapse();
        await settle(() => button('Start recording', '#compact').click());
        await settle(() => (onAudioActivity as () => void)());
        await settle(() => advance(5_000));
        const old = controls();
        assert.equal(old.question.getSnapshot().phase, 'transcribing');
        const requests = questions.length;
        await settle(() => button('End companion').click());
        assert.equal(uploads.at(-1)!.signal.aborted, true);
        await settle(() =>
          transcription!.resolve({
            transcript,
            request_id: crypto.randomUUID(),
          }),
        );
        assert.equal(old.question.getSnapshot().text, '');
        assert.equal(questions.length, requests);
        transcription = null;
      },
    );

    await t.test(
      'ending during an answer request prevents late evidence and audio from entering a reopened surface',
      async () => {
        answer = deferred<Response>();
        await mount('fourth-session');
        await expandAndFill();
        await settle(() => button('Ask VSual', '#expanded').click());
        const old = controls();
        const pendingRequest = questions.at(-1)!;
        const generated = speech.length;
        await settle(() => button('End companion').click());
        assert.equal((questionSignal as AbortSignal | null)?.aborted, true);
        await mount('new-account-session');
        assert.equal(controls().question.getSnapshot().text, '');
        await settle(() => answer!.resolve(responseFor(pendingRequest)));
        assert.equal(old.controller.getSnapshot().result, null);
        assert.equal(controls().controller.getSnapshot().result, null);
        assert.equal(document.querySelector('.answer-text'), null);
        assert.equal(speech.length, generated);
        assert.equal(controls().speech.getSnapshot().hasAudio, false);
      },
    );
  } finally {
    await act(async () => root.unmount());
    t.mock.restoreAll();
    dom.window.close();
    hook.deregister();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
