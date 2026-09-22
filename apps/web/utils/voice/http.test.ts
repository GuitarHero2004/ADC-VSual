import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AUDIO_MAX_BYTES,
  unicodeLength,
  voiceErrorResponseSchema,
  type SpeechSynthesisInput,
  type UsageLimit,
} from '@adc/contracts';
import { createVoiceHandler, voicePreflight } from './http.ts';
import { VoiceError } from './errors.ts';

const requestId = '11111111-1111-4111-8111-111111111111';
function setup() {
  const calls = {
    auth: 0,
    reserve: 0,
    provider: 0,
    speechInputs: [] as SpeechSynthesisInput[],
  };
  const dependencies = {
    async verifyVoiceUser() {
      calls.auth++;
      return { subject: 'subject', userId: 'user', workspaceId: 'workspace' };
    },
    async reserveVoiceRequest() {
      calls.reserve++;
    },
    requireVoiceConfiguration() {},
    async transcribeAudio(file: File) {
      calls.provider++;
      assert.equal(file.name, 'recording.webm');
      return { transcript: 'Q3: 1.250,50 ₫', detected_language: 'vie' };
    },
    async synthesiseSpeech(input: SpeechSynthesisInput) {
      calls.provider++;
      calls.speechInputs.push(input);
      return new Uint8Array([1, 2, 3]);
    },
  };
  return { calls, dependencies };
}
function json(value: unknown, extra: RequestInit = {}) {
  return new Request('https://app.example/api/voice/speak', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://app.example',
      'X-Request-ID': requestId,
    },
    body: JSON.stringify(value),
    ...extra,
  });
}
function audio(size = 16, type = 'audio/webm', validSignature = true) {
  const bytes = new Uint8Array(size);
  if (size >= 4 && validSignature) bytes.set([0x1a, 0x45, 0xdf, 0xa3]);
  const form = new FormData();
  form.set('audio', new Blob([bytes], { type }), '../../untrusted-name');
  return new Request('https://app.example/api/voice/transcribe', {
    method: 'POST',
    headers: { Origin: 'https://app.example' },
    body: form,
  });
}

test('unauthenticated input never reserves quota or reaches the provider', async () => {
  const { calls, dependencies } = setup();
  dependencies.verifyVoiceUser = async () => {
    throw new VoiceError('UNAUTHENTICATED', 'Sign in again.', 401);
  };
  const response = await createVoiceHandler(
    'speak',
    dependencies,
  )(json({ text: 'Hi' }));
  assert.equal(response.status, 401);
  assert.equal(calls.reserve, 0);
  assert.equal(calls.provider, 0);
});

test('application usage errors expose exact counts, retry metadata and only safe operational logs before any provider call', async (context) => {
  const logs: unknown[] = [];
  context.mock.method(console, 'info', (value: string) => {
    logs.push(JSON.parse(value));
  });
  const usage: UsageLimit = {
    minute_count: 30,
    minute_limit: 30,
    day_count: 84,
    day_limit: 1000,
    limited_by: 'minute',
    retry_after_seconds: 43,
    retry_at: '2026-09-21T12:00:43.000Z',
  };
  for (const feature of ['speak', 'transcribe'] as const) {
    const { calls, dependencies } = setup();
    dependencies.reserveVoiceRequest = async () => {
      throw new VoiceError(
        'APP_RATE_LIMITED',
        'VSual limit reached.',
        429,
        true,
        usage,
      );
    };
    const response = await createVoiceHandler(
      feature,
      dependencies,
    )(
      feature === 'speak' ? json({ text: 'private transcript text' }) : audio(),
    );
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('Retry-After'), '43');
    assert.ok(
      response.headers
        .get('Access-Control-Expose-Headers')
        ?.includes('Retry-After'),
    );
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const body = voiceErrorResponseSchema.parse(await response.json());
    assert.equal(body.error.code, 'APP_RATE_LIMITED');
    assert.deepEqual(body.error.usage, usage);
    assert.equal(calls.provider, 0);
    assert.deepEqual(logs.at(-1), {
      event: 'app_request_limit',
      request_id: body.request_id,
      route: `/api/voice/${feature}`,
      code: 'APP_RATE_LIMITED',
      ...usage,
    });
  }
  assert.equal(logs.length, 2);
  assert.ok(!JSON.stringify(logs).includes('private transcript text'));
});

test('provider and legacy throttling never inherit application counts or an invented retry time', async (context) => {
  const logs = context.mock.method(console, 'info', () => {});
  for (const code of [
    'PROVIDER_RATE_LIMITED',
    'RATE_LIMITED',
    'QUOTA_EXHAUSTED',
  ] as const) {
    const { dependencies } = setup();
    dependencies.synthesiseSpeech = async () => {
      throw new VoiceError(code, 'Provider unavailable.', 429, true);
    };
    const response = await createVoiceHandler(
      'speak',
      dependencies,
    )(json({ text: 'Read back' }));
    const result = voiceErrorResponseSchema.parse(await response.json());
    assert.equal(result.error.code, code);
    assert.equal(result.error.usage, undefined);
    assert.equal(response.headers.get('Retry-After'), null);
  }
  assert.equal(logs.mock.callCount(), 0);
});
test('malformed, empty, excessive Unicode and unrestricted options fail before provider or reservation', async () => {
  for (const input of [
    { text: '' },
    { text: '😀'.repeat(1001) },
    { text: 'hello', model: 'override' },
    { text: 'hello', language: 'fr' },
    { userId: 'forged' },
  ]) {
    const { calls, dependencies } = setup();
    assert.equal(
      (await createVoiceHandler('speak', dependencies)(json(input))).status,
      400,
    );
    assert.equal(calls.provider, 0);
    assert.equal(calls.reserve, 0);
  }
});
test('speak validates Unicode consistently and returns uncached playable audio', async () => {
  const { calls, dependencies } = setup();
  const response = await createVoiceHandler(
    'speak',
    dependencies,
  )(json({ text: '😀'.repeat(1000) }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('content-type'), 'audio/mpeg');
  assert.equal(response.headers.get('x-request-id'), requestId);
  assert.equal(calls.provider, 1);
});

test('speak prepares only a speech copy in the requested language before provider dispatch', async () => {
  for (const [language, expected] of [
    ['en', 'fifty-five US dollars per seat per month'],
    ['vi', 'năm mươi lăm đô la Mỹ mỗi chỗ mỗi tháng'],
  ] as const) {
    const input = { text: 'USD55/seat/month', language };
    const { calls, dependencies } = setup();
    const response = await createVoiceHandler(
      'speak',
      dependencies,
    )(json(input));
    assert.equal(response.status, 200);
    assert.deepEqual(calls.speechInputs, [{ text: expected, language }]);
    assert.equal(input.text, 'USD55/seat/month');
    assert.equal(calls.auth, 1);
    assert.equal(calls.reserve, 1);
    assert.equal(calls.provider, 1);
  }
});

test('speech expansion overflow is rejected before usage reservation or provider calls', async () => {
  const input = { text: 'USD55 '.repeat(100), language: 'en' };
  assert.ok(unicodeLength(input.text) <= 1000);
  const { calls, dependencies } = setup();
  const response = await createVoiceHandler('speak', dependencies)(json(input));
  assert.equal(response.status, 413);
  const body = voiceErrorResponseSchema.parse(await response.json());
  assert.equal(body.error.code, 'INPUT_TOO_LARGE');
  assert.equal(calls.auth, 1);
  assert.equal(calls.reserve, 0);
  assert.equal(calls.provider, 0);
});

test('expanded speech uses the exact Unicode code-point boundary without truncation', async () => {
  const expanded = 'fifty-five US dollars';
  const padding = '😀'.repeat(1000 - unicodeLength(expanded) - 1);
  const text = `${padding} USD55`;
  const expected = `${padding} ${expanded}`;
  const { calls, dependencies } = setup();
  const response = await createVoiceHandler(
    'speak',
    dependencies,
  )(json({ text, language: 'en' }));
  assert.equal(response.status, 200);
  assert.equal(unicodeLength(expected), 1000);
  assert.deepEqual(calls.speechInputs, [{ text: expected, language: 'en' }]);
  assert.equal(calls.reserve, 1);
  assert.equal(calls.provider, 1);

  const over = setup();
  const rejected = await createVoiceHandler(
    'speak',
    over.dependencies,
  )(json({ text: `😀${text}`, language: 'en' }));
  assert.equal(rejected.status, 413);
  assert.equal(over.calls.reserve, 0);
  assert.equal(over.calls.provider, 0);
});
test('same-origin browser calls use the destination Host when Next reconstructs an internal URL', async () => {
  const { dependencies } = setup();
  dependencies.verifyVoiceUser = async () => {
    throw new VoiceError('UNAUTHENTICATED', 'Sign in.', 401);
  };
  const request = new Request('http://localhost:3000/api/voice/speak', {
    method: 'POST',
    headers: {
      Host: '127.0.0.1:3000',
      Origin: 'http://127.0.0.1:3000',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: 'hello' }),
  });
  assert.equal(
    (await createVoiceHandler('speak', dependencies)(request)).status,
    401,
  );
});
test('audio limits, empty bodies, MIME lies and wrong signatures never reach provider', async () => {
  for (const request of [
    audio(0),
    audio(AUDIO_MAX_BYTES + 1),
    audio(16, 'application/octet-stream'),
    audio(16, 'audio/webm', false),
  ]) {
    const { calls, dependencies } = setup();
    const response = await createVoiceHandler(
      'transcribe',
      dependencies,
    )(request);
    assert.ok(response.status >= 400);
    assert.equal(calls.provider, 0);
    assert.equal(calls.reserve, 0);
  }
});
test('multipart fields reject URLs, repeated uploads and client duration claims', async () => {
  for (const extra of ['source_url', 'duration', 'audio']) {
    const form = new FormData();
    form.set(
      'audio',
      new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])], {
        type: 'audio/webm',
      }),
      'a.webm',
    );
    form.append(extra, 'untrusted');
    const { calls, dependencies } = setup();
    const response = await createVoiceHandler(
      'transcribe',
      dependencies,
    )(
      new Request('https://app.example/api/voice/transcribe', {
        method: 'POST',
        headers: { Origin: 'https://app.example' },
        body: form,
      }),
    );
    assert.equal(response.status, 400);
    assert.equal(calls.provider, 0);
  }
});
test('transcript preserved with request ID and no cache', async () => {
  const { dependencies } = setup();
  const response = await createVoiceHandler(
    'transcribe',
    dependencies,
  )(audio());
  const body = await response.json();
  assert.equal(body.transcript, 'Q3: 1.250,50 ₫');
  assert.equal(body.detected_language, 'vie');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(body.request_id, /^[0-9a-f-]{36}$/);
});
test('bounded multipart overhead and JSON bodies rejected before parsing/provider', async () => {
  const { calls, dependencies } = setup();
  const request = json({ text: 'Hi' });
  request.headers.set('content-length', '5000000');
  assert.equal(
    (await createVoiceHandler('speak', dependencies)(request)).status,
    413,
  );
  assert.equal(calls.provider, 0);
});
test('cancellation while reserving never calls provider afterwards', async () => {
  const abort = new AbortController();
  const { calls, dependencies } = setup();
  dependencies.reserveVoiceRequest = async () => {
    abort.abort();
  };
  assert.equal(
    (
      await createVoiceHandler(
        'speak',
        dependencies,
      )(json({ text: 'hello' }, { signal: abort.signal }))
    ).status,
    499,
  );
  assert.equal(calls.provider, 0);
});
test('cancellation while the request body stalls cancels its reader and sends nothing', async () => {
  const abort = new AbortController();
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
  });
  const { calls, dependencies } = setup();
  const request = new Request('https://app.example/api/voice/speak', {
    method: 'POST',
    headers: {
      Origin: 'https://app.example',
      'Content-Type': 'application/json',
    },
    body,
    signal: abort.signal,
    duplex: 'half',
  } as RequestInit);
  const pending = createVoiceHandler('speak', dependencies)(request);
  await new Promise((resolve) => setImmediate(resolve));
  abort.abort();
  assert.equal((await pending).status, 499);
  assert.equal(cancelled, true);
  assert.equal(calls.provider, 0);
});
test('provider errors are stable and unexpected details are sanitized', async () => {
  const { dependencies } = setup();
  dependencies.synthesiseSpeech = async () => {
    throw new Error('private provider payload');
  };
  const response = await createVoiceHandler(
    'speak',
    dependencies,
  )(json({ text: 'hello' }));
  assert.equal(response.status, 502);
  assert.doesNotMatch(await response.text(), /private provider payload/);
});
test('CORS handles configured extension preflight but never substitutes for auth', async () => {
  const previous = process.env.VOICE_ALLOWED_ORIGINS;
  const origin = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  process.env.VOICE_ALLOWED_ORIGINS = origin;
  try {
    const response = voicePreflight(
      new Request('https://app.example/api/voice/speak', {
        method: 'OPTIONS',
        headers: { Origin: origin },
      }),
    );
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
    const { calls, dependencies } = setup();
    const denied = json({ text: 'hello' });
    denied.headers.set('origin', 'https://untrusted.example');
    assert.equal(
      (await createVoiceHandler('speak', dependencies)(denied)).status,
      403,
    );
    assert.equal(calls.auth, 0);
    const allowed = json({ text: 'hello' });
    allowed.headers.set('origin', origin);
    dependencies.verifyVoiceUser = async () => {
      throw new VoiceError('UNAUTHENTICATED', 'Sign in.', 401);
    };
    assert.equal(
      (await createVoiceHandler('speak', dependencies)(allowed)).status,
      401,
    );
    assert.equal(calls.provider, 0);
  } finally {
    if (previous === undefined) delete process.env.VOICE_ALLOWED_ORIGINS;
    else process.env.VOICE_ALLOWED_ORIGINS = previous;
  }
});
