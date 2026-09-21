import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createVoiceTransport, VoiceTransportError } from './transport.ts';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const id = '11111111-1111-4111-8111-111111111111';
test('explicit transcription preserves matching MIME/name/language and validates response', async () => {
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(String(url), 'https://backend.example/api/voice/transcribe');
    const form = init?.body as FormData;
    const file = form.get('audio') as File;
    assert.equal(file.name, 'recording.webm');
    assert.equal(file.type, 'audio/webm;codecs=opus');
    assert.equal(form.get('language'), 'vi');
    assert.equal(
      new Headers(init?.headers).get('authorization'),
      'Bearer synthetic',
    );
    return Response.json({ transcript: '1.250,50 ₫', request_id: id });
  };
  const transport = createVoiceTransport({
    baseUrl: 'https://backend.example',
    getHeaders: () => ({ Authorization: 'Bearer synthetic' }),
  });
  assert.equal(calls, 0);
  const result = await transport.transcribe(
    new Blob(['test'], { type: 'audio/webm;codecs=opus' }),
    'recording.webm',
    'vi',
    new AbortController().signal,
  );
  assert.equal(result.transcript, '1.250,50 ₫');
  assert.equal(calls, 1);
});
test('session expiry reported once without retries; deployment protection distinguished', async () => {
  let expired = 0,
    calls = 0;
  const transport = createVoiceTransport({
    baseUrl: 'https://backend.example',
    getHeaders: () => ({}),
    onUnauthenticated: () => {
      expired++;
    },
  });
  globalThis.fetch = async () => {
    calls++;
    return Response.json(
      {
        request_id: id,
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Sign in.',
          retryable: false,
        },
      },
      { status: 401 },
    );
  };
  await assert.rejects(
    transport.speak('hello', 'auto', new AbortController().signal),
    { code: 'UNAUTHENTICATED' },
  );
  assert.equal(expired, 1);
  assert.equal(calls, 1);
  globalThis.fetch = async () =>
    new Response('<html>Vercel Authentication</html>', { status: 401 });
  await assert.rejects(
    transport.speak('hello', 'auto', new AbortController().signal),
    /Vercel deployment protection/,
  );
  assert.equal(expired, 1);
});
test('cancelled response is discarded before consuming audio', async () => {
  const abort = new AbortController();
  globalThis.fetch = async () => {
    abort.abort();
    return new Response('audio', { headers: { 'Content-Type': 'audio/mpeg' } });
  };
  const transport = createVoiceTransport({
    baseUrl: 'https://backend.example',
    getHeaders: () => ({}),
  });
  await assert.rejects(transport.speak('hello', 'en', abort.signal), {
    name: 'AbortError',
  });
});

test('application usage errors preserve validated counts and retry metadata without retrying', async () => {
  const usage = {
    minute_count: 24,
    minute_limit: 24,
    day_count: 73,
    day_limit: 240,
    limited_by: 'minute',
    retry_after_seconds: 42,
    retry_at: '2026-09-21T00:01:00.000Z',
  };
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json(
      {
        request_id: id,
        error: {
          code: 'APP_RATE_LIMITED',
          message: 'Application limit',
          retryable: true,
          usage,
        },
      },
      { status: 429 },
    );
  };
  const transport = createVoiceTransport({
    baseUrl: 'https://backend.example',
    getHeaders: () => ({}),
  });
  await assert.rejects(
    transport.speak('Keep this text', 'en', new AbortController().signal),
    (error: unknown) => {
      assert.ok(error instanceof VoiceTransportError);
      assert.equal(error.code, 'APP_RATE_LIMITED');
      assert.deepEqual(error.usage, usage);
      return true;
    },
  );
  assert.equal(calls, 1);
  await Promise.resolve();
  assert.equal(
    calls,
    1,
    'An elapsed retry timestamp cannot cause an automatic paid retry',
  );
  globalThis.fetch = async () =>
    Response.json(
      {
        request_id: id,
        error: {
          code: 'APP_RATE_LIMITED',
          message: 'Limit',
          retryable: true,
          usage: { ...usage, minute_limit: -1 },
        },
      },
      { status: 429 },
    );
  await assert.rejects(
    transport.speak('Keep this text', 'en', new AbortController().signal),
    (error: unknown) => {
      assert.ok(error instanceof VoiceTransportError);
      assert.equal(error.code, 'PROVIDER_FAILURE');
      assert.equal(error.usage, undefined);
      return true;
    },
  );
});

test('provider and legacy throttling do not acquire fabricated application counts', async () => {
  const transport = createVoiceTransport({
    baseUrl: 'https://backend.example',
    getHeaders: () => ({}),
  });
  for (const code of ['PROVIDER_RATE_LIMITED', 'RATE_LIMITED']) {
    globalThis.fetch = async () =>
      Response.json(
        {
          request_id: id,
          error: { code, message: 'Rate limited', retryable: true },
        },
        { status: 429 },
      );
    await assert.rejects(
      transport.speak('Preserve', 'en', new AbortController().signal),
      (error: unknown) => {
        assert.ok(error instanceof VoiceTransportError);
        assert.equal(error.code, code);
        assert.equal(error.usage, undefined);
        return true;
      },
    );
  }
});
