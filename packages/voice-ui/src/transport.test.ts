import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createVoiceTransport } from './transport.ts';

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
