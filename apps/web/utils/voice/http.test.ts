import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AUDIO_MAX_BYTES } from '@adc/contracts';
import { createVoiceHandler, voicePreflight } from './http.ts';
import { VoiceError } from './errors.ts';

const requestId = '11111111-1111-4111-8111-111111111111';
function setup() {
  const calls = { auth: 0, reserve: 0, provider: 0 };
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
    async synthesiseSpeech() {
      calls.provider++;
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
