import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AUDIO_MAX_BYTES,
  VISUAL_LIMITS,
  desktopRequestSchema,
  type DesktopRequest,
} from '@adc/contracts';
import {
  DesktopAssistant,
  DesktopRequestError,
  type AssistantDependencies,
  type NativeSource,
} from './assistant.ts';
import type { DesktopScreenInput, DesktopTranscribeInput } from './bridge.ts';
import type { DesktopSessionState } from './session-types.ts';

// Generated 2x2 green JPEG. No captured application content or credentials.
const jpeg =
  '/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABQb/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCIAGIh/9k=';
const imageBytes = () => Uint8Array.from(Buffer.from(jpeg, 'base64')).buffer;
const wiped = (bytes: ArrayBuffer) =>
  assert.ok(new Uint8Array(bytes).every((byte) => byte === 0));
const isCode = (code: string) => (error: unknown) =>
  error instanceof DesktopRequestError && error.code === code;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function responseFor(input: DesktopRequest) {
  return {
    source_kind: 'desktop_window',
    request_id: input.request_id,
    source_id: input.snapshot.source_id,
    snapshot_id: input.snapshot.snapshot_id,
    fingerprint: input.snapshot.fingerprint,
    captured_at: input.snapshot.captured_at,
    status: 'answer',
    answer_language: 'en',
    text: 'A green area is visible.',
    evidence: [
      {
        image_id: 'image-1',
        region: { x: 0, y: 0, width: 1, height: 1 },
        description: 'The captured window is green.',
      },
    ],
  };
}
function fixture() {
  let now = Date.now();
  let available: NativeSource[] = [
    { id: 'window:7:0', name: 'Synthetic document' },
    { id: 'window:9:0', name: 'VSual' },
    { id: 'screen:1:0', name: 'Whole display' },
  ];
  let state: DesktopSessionState = {
    phase: 'signed_in',
    workspace: 'allowed',
    epoch: crypto.randomUUID(),
    account: { id: crypto.randomUUID(), email: 'reader@example.test' },
    errorCode: null,
    logoutConfirmed: null,
  };
  const events: string[] = [];
  const requests: Request[] = [];
  let respond = async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname;
    if (path === '/api/desktop-read')
      return Response.json(
        responseFor(desktopRequestSchema.parse(await request.json())),
      );
    if (path === '/api/voice/transcribe')
      return Response.json({
        request_id: request.headers.get('x-request-id'),
        transcript: 'Synthetic transcript',
      });
    return new Response(new Uint8Array([73, 68, 51, 1]), {
      headers: { 'content-type': 'audio/mpeg' },
    });
  };
  const dependencies: AssistantDependencies = {
    auth: {
      snapshot: () => ({ ...state }),
      async authorized(signal) {
        events.push('authorize');
        signal.throwIfAborted();
        if (state.phase !== 'signed_in' || state.workspace !== 'allowed')
          throw new DesktopRequestError(
            'UNAUTHENTICATED',
            'Session unavailable.',
          );
        return {
          epoch: state.epoch,
          userId: state.account!.id,
          headers: { Authorization: 'Bearer synthetic-unusable' },
        };
      },
    },
    configuration: () => ({
      ok: true,
      value: {
        apiBaseUrl: 'https://backend.example.test',
        supabaseUrl: 'https://auth.example.test',
        publishableKey: 'synthetic-public-configuration',
      },
    }),
    async sources() {
      events.push('enumerate');
      return available.map((source) => ({ ...source }));
    },
    excludedSourceId: () => 'window:9:1',
    now: () => now,
    async fetch(input, init) {
      events.push('fetch');
      const request = new Request(input, init);
      requests.push(request.clone());
      return respond(request);
    },
  };
  const assistant = new DesktopAssistant(dependencies);
  return {
    assistant,
    dependencies,
    events,
    requests,
    setSources(value: NativeSource[]) {
      available = value;
    },
    setState(value: Partial<DesktopSessionState>) {
      state = { ...state, ...value };
    },
    setResponse(value: typeof respond) {
      respond = value;
    },
    advance(ms: number) {
      now += ms;
    },
    async prepared(grant = true): Promise<DesktopScreenInput> {
      const source = (await assistant.listSources())[0];
      assert.ok(source);
      const ticket = await assistant.prepareCapture(
        source.id,
        crypto.randomUUID(),
      );
      if (grant)
        assert.equal((await assistant.claimCaptureSource())?.id, 'window:7:0');
      return {
        captureId: ticket.captureId,
        requestId: ticket.requestId,
        question: 'What is visible?',
        bytes: imageBytes(),
        width: 2,
        height: 2,
        capturedAt: new Date(now).toISOString(),
      };
    },
  };
}
const recording = (): DesktopTranscribeInput => ({
  requestId: crypto.randomUUID(),
  bytes: new Uint8Array([1, 2, 3]).buffer,
  mimeType: 'audio/webm;codecs=opus',
  filename: 'recording.webm',
  language: 'auto',
});

test('foreground resolution matches native identity rather than title or ordering without capture', async () => {
  const f = fixture();
  f.setSources([
    { id: 'window:8:0', name: 'Synthetic document' },
    { id: 'window:7:0', name: 'Synthetic document' },
    { id: 'window:9:0', name: 'VSual' },
  ]);
  const selected = await f.assistant.sourceForNative('window:7:1');
  assert.ok(selected);
  const ticket = await f.assistant.prepareCapture(
    selected.id,
    crypto.randomUUID(),
  );
  assert.equal((await f.assistant.claimCaptureSource())?.id, 'window:7:0');
  f.assistant.cancel(ticket.requestId);
  assert.equal(await f.assistant.sourceForNative('window:9:1'), null);
  assert.equal(await f.assistant.sourceForNative('window:100:0'), null);
  assert.equal(await f.assistant.sourceForNative(null), null);
  assert.equal(await f.assistant.sourceForNative('screen:7:0'), null);
  assert.equal(f.requests.length, 0);
  f.assistant.dispose();
});

test('idle enumeration exposes opaque selected windows, excludes own window across native flags and never fetches', async () => {
  const f = fixture();
  assert.equal(f.assistant.hasCaptureGrant(), false);
  assert.equal(await f.assistant.claimCaptureSource(), null);
  const sources = await f.assistant.listSources();
  assert.equal(sources.length, 1);
  assert.equal(sources[0]!.title, 'Synthetic document');
  assert.match(sources[0]!.id, /^[a-f0-9-]{36}$/);
  assert.deepEqual(await f.assistant.listSources(), sources);
  assert.deepEqual(f.events, ['enumerate', 'enumerate']);
  assert.equal(f.requests.length, 0);
});

test('signed-out and denied-workspace states cannot enumerate or acquire a capture grant', async () => {
  for (const state of [
    { phase: 'signed_out' as const },
    { workspace: 'denied' as const },
  ]) {
    const f = fixture();
    f.setState(state);
    await assert.rejects(f.assistant.listSources(), isCode('UNAUTHENTICATED'));
    await assert.rejects(
      f.assistant.prepareCapture(crypto.randomUUID(), crypto.randomUUID()),
      isCode('UNAUTHENTICATED'),
    );
    assert.deepEqual(f.events, []);
  }
});

test('capture authorization precedes source recheck and normalized titles remain selectable', async () => {
  const f = fixture();
  f.setSources([{ id: 'window:7:0', name: `  Synthetic\n${'x'.repeat(180)}` }]);
  const sources = await f.assistant.listSources();
  assert.equal(sources[0]!.title.length, 160);
  assert.ok(!sources[0]!.title.includes('\n'));
  f.events.length = 0;
  await f.assistant.prepareCapture(sources[0]!.id, crypto.randomUUID());
  assert.deepEqual(f.events, ['authorize', 'enumerate']);
  assert.equal((await f.assistant.claimCaptureSource())?.id, 'window:7:0');
  assert.equal(await f.assistant.claimCaptureSource(), null);
  assert.equal(f.requests.length, 0);
});

test('disappeared or renamed selected windows cannot be prepared or submitted', async () => {
  for (const available of [[], [{ id: 'window:7:0', name: 'Changed title' }]]) {
    const f = fixture();
    const source = (await f.assistant.listSources())[0]!;
    f.setSources(available);
    await assert.rejects(
      f.assistant.prepareCapture(source.id, crypto.randomUUID()),
      isCode('SOURCE_UNAVAILABLE'),
    );
    assert.equal(await f.assistant.claimCaptureSource(), null);
    const g = fixture();
    const input = await g.prepared();
    g.setSources(available);
    await assert.rejects(
      g.assistant.readScreen(input),
      isCode('SOURCE_UNAVAILABLE'),
    );
    wiped(input.bytes);
    assert.equal(g.requests.length, 0);
  }
});

test('capture grant is single use and expires without provider work', async () => {
  const f = fixture();
  const input = await f.prepared(false);
  const first = f.assistant.claimCaptureSource();
  assert.equal(await f.assistant.claimCaptureSource(), null);
  assert.equal((await first)?.id, 'window:7:0');
  f.advance(VISUAL_LIMITS.captureStageTimeoutMs + 1);
  assert.equal(f.assistant.hasCaptureGrant(), false);
  await assert.rejects(f.assistant.readScreen(input), isCode('CANCELLED'));
  wiped(input.bytes);
  assert.equal(f.requests.length, 0);
});

test('account invalidation during native enumeration cannot grant or publish old sources', async () => {
  const f = fixture();
  await f.prepared(false);
  const pendingSources = deferred<NativeSource[]>();
  f.dependencies.sources = () => pendingSources.promise;
  const claim = f.assistant.claimCaptureSource();
  f.setState({ epoch: crypto.randomUUID(), phase: 'signed_out' });
  pendingSources.resolve([{ id: 'window:7:0', name: 'Synthetic document' }]);
  assert.equal(await claim, null);
  const g = fixture();
  const listing = deferred<NativeSource[]>();
  g.dependencies.sources = () => listing.promise;
  const pending = g.assistant.listSources();
  g.assistant.reset();
  listing.resolve([{ id: 'window:7:0', name: 'Synthetic document' }]);
  await assert.rejects(pending, isCode('CANCELLED'));
});

test('one screenshot dispatch uses a fixed originless bearer route, binds source and clears pixels', async () => {
  const f = fixture();
  const input = await f.prepared();
  const answer = await f.assistant.readScreen(input);
  assert.equal(answer.request_id, input.requestId);
  assert.equal(f.requests.length, 1);
  const request = f.requests[0]!;
  assert.equal(request.url, 'https://backend.example.test/api/desktop-read');
  assert.equal(request.headers.get('origin'), null);
  assert.equal(
    request.headers.get('authorization'),
    'Bearer synthetic-unusable',
  );
  assert.equal(request.redirect, 'error');
  assert.equal(request.cache, 'no-store');
  const body = desktopRequestSchema.parse(await request.json());
  assert.equal(body.images[0].base64, jpeg);
  assert.equal(body.snapshot.source_id, answer.source_id);
  assert.equal(body.snapshot.fingerprint, answer.fingerprint);
  assert.deepEqual(body.snapshot.limitations, [
    'current_view_only',
    'masking_unavailable',
    'document_not_retrieved',
  ]);
  wiped(input.bytes);
  const duplicate = { ...input, bytes: imageBytes() };
  await assert.rejects(f.assistant.readScreen(duplicate), isCode('CANCELLED'));
  wiped(duplicate.bytes);
  assert.equal(f.requests.length, 1);
});

test('follow-up context comes only from the latest native-owned accepted exchange and a fresh capture', async () => {
  const f = fixture();
  const first = await f.prepared();
  const answer = await f.assistant.readScreen(first);
  f.assistant.suspend(); // Hiding the panel cancels work, not the accepted exchange.
  assert.equal(
    (await f.assistant.sourceForNative('window:7:1'))?.id,
    answer.source_id,
  );
  const second = {
    ...(await f.prepared()),
    question: 'What does that area show?',
    followUpRequestId: first.requestId,
  };
  await f.assistant.readScreen(second);
  const request = desktopRequestSchema.parse(await f.requests[1]!.json());
  assert.deepEqual(request.follow_up_context, {
    request_id: first.requestId,
    source_id: answer.source_id,
    question: first.question,
    answer: answer.text,
  });
  assert.notEqual(request.snapshot.snapshot_id, answer.snapshot_id);
  assert.equal(request.images[0].base64, jpeg);
  wiped(second.bytes);
  const stale = { ...(await f.prepared()), followUpRequestId: first.requestId };
  await assert.rejects(
    f.assistant.readScreen(stale),
    isCode('SOURCE_UNAVAILABLE'),
  );
  wiped(stale.bytes);
  assert.equal(f.requests.length, 2);
  const newQuestion = await f.prepared();
  await f.assistant.readScreen(newQuestion);
  assert.equal(
    desktopRequestSchema.parse(await f.requests[2]!.json()).follow_up_context,
    undefined,
  );
  f.assistant.dispose();
});

test('forged context or a wrong previous request cannot reach the backend', async () => {
  const f = fixture();
  const first = await f.prepared();
  await f.assistant.readScreen(first);
  const forged = {
    ...(await f.prepared()),
    followUpRequestId: first.requestId,
    follow_up_context: { answer: 'Renderer-invented answer' },
  };
  await assert.rejects(f.assistant.readScreen(forged));
  wiped(forged.bytes);
  const wrong = {
    ...(await f.prepared()),
    followUpRequestId: crypto.randomUUID(),
  };
  await assert.rejects(
    f.assistant.readScreen(wrong),
    isCode('SOURCE_UNAVAILABLE'),
  );
  wiped(wrong.bytes);
  assert.equal(f.requests.length, 1);
  f.assistant.dispose();
});

test('switching away and back or changing the source title invalidates follow-up context', async () => {
  for (const change of ['source', 'title'] as const) {
    const f = fixture();
    const first = await f.prepared();
    await f.assistant.readScreen(first);
    if (change === 'source') {
      f.setSources([
        { id: 'window:7:0', name: 'Synthetic document' },
        { id: 'window:8:0', name: 'Another synthetic document' },
      ]);
      assert.ok(await f.assistant.sourceForNative('window:8:1'));
      assert.ok(await f.assistant.sourceForNative('window:7:1'));
    } else {
      f.setSources([
        { id: 'window:7:0', name: 'A renamed synthetic document' },
      ]);
    }
    const followUp = {
      ...(await f.prepared()),
      followUpRequestId: first.requestId,
    };
    await assert.rejects(
      f.assistant.readScreen(followUp),
      isCode('SOURCE_UNAVAILABLE'),
    );
    wiped(followUp.bytes);
    assert.equal(f.requests.length, 1);
    f.assistant.dispose();
  }
});

test('account, workspace and session reset cannot reuse the previous account context', async () => {
  for (const change of ['epoch', 'account', 'workspace', 'reset'] as const) {
    const f = fixture();
    const first = await f.prepared();
    await f.assistant.readScreen(first);
    if (change === 'epoch') f.setState({ epoch: crypto.randomUUID() });
    if (change === 'account')
      f.setState({
        account: { id: crypto.randomUUID(), email: 'other@example.test' },
      });
    if (change === 'workspace') {
      const previous = f.dependencies.configuration();
      assert.ok(previous.ok);
      const workspaceId = crypto.randomUUID();
      f.dependencies.configuration = () => ({
        ok: true,
        value: { ...previous.value, workspaceId },
      });
    }
    if (change === 'reset') f.assistant.reset();
    const followUp = {
      ...(await f.prepared()),
      followUpRequestId: first.requestId,
    };
    await assert.rejects(
      f.assistant.readScreen(followUp),
      isCode('SOURCE_UNAVAILABLE'),
    );
    assert.equal(f.requests.length, 1);
    f.assistant.dispose();
  }
});

test('ungranted and malformed screenshot submissions wipe bytes before returning', async () => {
  const f = fixture();
  const input = await f.prepared(false);
  await assert.rejects(f.assistant.readScreen(input), isCode('CANCELLED'));
  wiped(input.bytes);
  const malformed = { ...input, bytes: imageBytes(), width: -1 };
  await assert.rejects(f.assistant.readScreen(malformed));
  wiped(malformed.bytes);
  assert.equal(f.requests.length, 0);
});

test('image byte/pixel/question limits and invalid capture time reject before network and wipe pixels', async () => {
  for (const patch of [
    { bytes: new Uint8Array(VISUAL_LIMITS.imageBytes + 1).fill(5).buffer },
    { width: 2000, height: 2000 },
    { question: 'x'.repeat(1001) },
    { capturedAt: new Date(0).toISOString() },
  ]) {
    const f = fixture();
    const input = { ...(await f.prepared()), ...patch };
    await assert.rejects(f.assistant.readScreen(input));
    wiped(input.bytes);
    assert.equal(f.requests.length, 0);
  }
});

test('Stop and replacement selection suppress late screenshot answers with no duplicate dispatch', async () => {
  for (const action of ['cancel', 'replace', 'reset'] as const) {
    const f = fixture();
    const input = await f.prepared();
    const started = deferred<void>();
    const response = deferred<Response>();
    let captured!: DesktopRequest;
    f.setResponse(async (request) => {
      captured = desktopRequestSchema.parse(await request.json());
      started.resolve();
      return response.promise;
    });
    const pending = f.assistant.readScreen(input);
    const rejected = assert.rejects(pending, isCode('CANCELLED'));
    await started.promise;
    const duplicate = { ...input, bytes: imageBytes() };
    await assert.rejects(
      f.assistant.readScreen(duplicate),
      isCode('CANCELLED'),
    );
    wiped(duplicate.bytes);
    if (action === 'cancel') f.assistant.cancel(input.requestId);
    if (action === 'reset') {
      f.setState({ epoch: crypto.randomUUID() });
      f.assistant.reset();
    }
    if (action === 'replace')
      await f.assistant.prepareCapture(
        captured.snapshot.source_id,
        crypto.randomUUID(),
      );
    response.resolve(Response.json(responseFor(captured)));
    await rejected;
    wiped(input.bytes);
    assert.equal(f.requests.length, 1);
    const followUp = {
      ...(await f.prepared()),
      followUpRequestId: input.requestId,
    };
    await assert.rejects(
      f.assistant.readScreen(followUp),
      isCode('SOURCE_UNAVAILABLE'),
    );
    wiped(followUp.bytes);
    assert.equal(f.requests.length, 1);
    f.assistant.dispose();
  }
});

test('a window renamed during processing cannot publish an answer or retain follow-up context', async () => {
  const f = fixture();
  const input = await f.prepared();
  const started = deferred<void>();
  const response = deferred<Response>();
  let captured!: DesktopRequest;
  f.setResponse(async (request) => {
    captured = desktopRequestSchema.parse(await request.json());
    started.resolve();
    return response.promise;
  });
  const pending = f.assistant.readScreen(input);
  const rejected = assert.rejects(pending, isCode('SOURCE_UNAVAILABLE'));
  await started.promise;
  f.setSources([{ id: 'window:7:0', name: 'A different document' }]);
  response.resolve(Response.json(responseFor(captured)));
  await rejected;
  wiped(input.bytes);
  const followUp = {
    ...(await f.prepared()),
    followUpRequestId: input.requestId,
  };
  await assert.rejects(
    f.assistant.readScreen(followUp),
    isCode('SOURCE_UNAVAILABLE'),
  );
  assert.equal(f.requests.length, 1);
  f.assistant.dispose();
});

test('cancelled follow-up does not replace the last accepted native context', async () => {
  const f = fixture();
  const first = await f.prepared();
  await f.assistant.readScreen(first);
  const second = {
    ...(await f.prepared()),
    question: 'Explain the area.',
    followUpRequestId: first.requestId,
  };
  const started = deferred<void>();
  const response = deferred<Response>();
  let captured!: DesktopRequest;
  f.setResponse(async (request) => {
    captured = desktopRequestSchema.parse(await request.json());
    started.resolve();
    return response.promise;
  });
  const pending = f.assistant.readScreen(second);
  const rejected = assert.rejects(pending, isCode('CANCELLED'));
  await started.promise;
  f.assistant.cancel(second.requestId);
  response.resolve(Response.json(responseFor(captured)));
  await rejected;
  f.setResponse(async (request) =>
    Response.json(
      responseFor(desktopRequestSchema.parse(await request.json())),
    ),
  );
  const third = {
    ...(await f.prepared()),
    followUpRequestId: first.requestId,
  };
  await f.assistant.readScreen(third);
  const body = desktopRequestSchema.parse(await f.requests[2]!.json());
  assert.equal(body.follow_up_context?.request_id, first.requestId);
  assert.equal(body.follow_up_context?.question, first.question);
  f.assistant.dispose();
});

test('forged screenshot response identities and evidence cannot reach the renderer', async () => {
  for (const patch of [
    { request_id: crypto.randomUUID() },
    { source_id: crypto.randomUUID() },
    { snapshot_id: crypto.randomUUID() },
    { fingerprint: 'f'.repeat(64) },
    { captured_at: new Date(0).toISOString() },
    { evidence: [] },
    {
      evidence: [
        {
          image_id: 'image-2',
          region: { x: 0, y: 0, width: 1, height: 1 },
          description: 'Wrong image.',
        },
      ],
    },
  ]) {
    const f = fixture();
    const input = await f.prepared();
    f.setResponse(async (request) =>
      Response.json({
        ...responseFor(desktopRequestSchema.parse(await request.json())),
        ...patch,
      }),
    );
    await assert.rejects(f.assistant.readScreen(input));
    wiped(input.bytes);
  }
});

test('transcription uses bounded multipart data, clears audio and rejects unrelated response IDs', async () => {
  const f = fixture();
  const input = recording();
  const result = await f.assistant.transcribe(input);
  assert.equal(result.request_id, input.requestId);
  wiped(input.bytes);
  assert.equal(
    f.requests[0]!.url,
    'https://backend.example.test/api/voice/transcribe',
  );
  const form = await f.requests[0]!.formData();
  assert.equal(form.get('language'), 'auto');
  const audio = form.get('audio');
  assert.ok(audio instanceof File);
  assert.equal(audio.name, 'recording.webm');
  assert.equal(audio.size, 3);
  const invalid = recording();
  f.setResponse(async () =>
    Response.json({
      request_id: crypto.randomUUID(),
      transcript: 'Wrong request.',
    }),
  );
  await assert.rejects(f.assistant.transcribe(invalid), isCode('CANCELLED'));
  wiped(invalid.bytes);
});

test('audio limits and unsupported formats reject before authorization/fetch and wipe audio', async () => {
  for (const patch of [
    { bytes: new Uint8Array(AUDIO_MAX_BYTES + 1).fill(9).buffer },
    { mimeType: 'text/plain' },
    { filename: '../private.webm' },
  ]) {
    const f = fixture();
    const input = { ...recording(), ...patch };
    await assert.rejects(f.assistant.transcribe(input));
    wiped(input.bytes);
    assert.deepEqual(f.events, []);
  }
});

test('speech text bounds reject before fetch; successful audio is bounded and malformed types fail', async () => {
  const f = fixture();
  await assert.rejects(
    f.assistant.speak({
      requestId: crypto.randomUUID(),
      text: 'x'.repeat(1001),
      language: 'en',
    }),
  );
  assert.equal(f.requests.length, 0);
  const bytes = await f.assistant.speak({
    requestId: crypto.randomUUID(),
    text: 'Synthetic answer.',
    language: 'en',
  });
  assert.equal(bytes.byteLength, 4);
  for (const response of [
    new Response('not audio', { headers: { 'content-type': 'text/html' } }),
    new Response(new Uint8Array(0), {
      headers: { 'content-type': 'audio/mpeg' },
    }),
    new Response(new Uint8Array(4 * 1024 * 1024 + 1), {
      headers: { 'content-type': 'audio/mpeg' },
    }),
  ]) {
    f.setResponse(async () => response);
    await assert.rejects(
      f.assistant.speak({
        requestId: crypto.randomUUID(),
        text: 'Synthetic answer.',
        language: 'auto',
      }),
    );
  }
});

test('verified application usage errors preserve safe details and duplicate speech IDs do not dispatch', async () => {
  const f = fixture();
  const id = crypto.randomUUID();
  const usage = {
    minute_count: 2,
    minute_limit: 2,
    day_count: 2,
    day_limit: 20,
    limited_by: 'minute',
    retry_after_seconds: 30,
    retry_at: new Date(Date.now() + 30_000).toISOString(),
  };
  f.setResponse(async () =>
    Response.json(
      {
        request_id: id,
        error: {
          code: 'APP_RATE_LIMITED',
          message: 'Wait before asking again.',
          retryable: true,
          usage,
        },
      },
      { status: 429 },
    ),
  );
  await assert.rejects(
    f.assistant.speak({
      requestId: id,
      text: 'Synthetic answer.',
      language: 'en',
    }),
    (error: unknown) => {
      assert.ok(error instanceof DesktopRequestError);
      assert.equal(error.code, 'APP_RATE_LIMITED');
      assert.equal(error.requestId, id);
      assert.deepEqual(error.usage, usage);
      return true;
    },
  );
  await assert.rejects(
    f.assistant.speak({
      requestId: id,
      text: 'Synthetic answer.',
      language: 'en',
    }),
    isCode('CANCELLED'),
  );
  assert.equal(f.requests.length, 1);
});

test('authorization rejection and missing configuration never dispatch paid calls', async () => {
  const f = fixture();
  f.dependencies.auth.authorized = async () => {
    throw new DesktopRequestError('FORBIDDEN', 'No workspace access.');
  };
  const source = (await f.assistant.listSources())[0]!;
  await assert.rejects(
    f.assistant.prepareCapture(source.id, crypto.randomUUID()),
    isCode('FORBIDDEN'),
  );
  await assert.rejects(
    f.assistant.speak({
      requestId: crypto.randomUUID(),
      text: 'Synthetic answer.',
      language: 'en',
    }),
    isCode('FORBIDDEN'),
  );
  const audio = recording();
  await assert.rejects(f.assistant.transcribe(audio), isCode('FORBIDDEN'));
  wiped(audio.bytes);
  assert.equal(f.requests.length, 0);
  f.dependencies.configuration = () => ({
    ok: false,
    errorCode: 'SETUP_REQUIRED',
  });
  await assert.rejects(
    f.assistant.speak({
      requestId: crypto.randomUUID(),
      text: 'Synthetic answer.',
      language: 'en',
    }),
    isCode('SETUP_REQUIRED'),
  );
  assert.equal(f.requests.length, 0);
});

test('logout epoch change and disposal reject late speech and all future operations', async () => {
  const f = fixture();
  const started = deferred<void>();
  const response = deferred<Response>();
  f.setResponse(async () => {
    started.resolve();
    return response.promise;
  });
  const pending = f.assistant.speak({
    requestId: crypto.randomUUID(),
    text: 'Synthetic answer.',
    language: 'en',
  });
  const rejected = assert.rejects(pending, isCode('CANCELLED'));
  await started.promise;
  f.setState({ epoch: crypto.randomUUID(), phase: 'signed_out' });
  response.resolve(
    new Response(new Uint8Array([73, 68, 51]), {
      headers: { 'content-type': 'audio/mpeg' },
    }),
  );
  await rejected;
  f.assistant.dispose();
  f.assistant.dispose();
  await assert.rejects(f.assistant.listSources(), isCode('UNAUTHENTICATED'));
  assert.equal(await f.assistant.claimCaptureSource(), null);
});
