import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import { VoiceError } from '../voice/errors.ts';
import { synthesiseSpeech, transcribeAudio } from './server.ts';

const variables = [
  'ELEVENLABS_API_KEY',
  'ELEVENLABS_STT_MODEL',
  'ELEVENLABS_TTS_MODEL',
  'ELEVENLABS_VOICE_ID',
] as const;
const originals = Object.fromEntries(
  variables.map((name) => [name, process.env[name]]),
);
const testApiKey = 'synthetic-test-key-never-sent';
const testVoice = 'syntheticConfiguredVoice';
const privateDetail = 'private-provider-detail';
const audioBytes = new Uint8Array([73, 68, 51, 4, 0, 0]);
let capturedRequests: Request[];
let createFetchResponse: () => Response;

beforeEach(() => {
  process.env.ELEVENLABS_API_KEY = testApiKey;
  process.env.ELEVENLABS_STT_MODEL = 'scribe_v2';
  process.env.ELEVENLABS_TTS_MODEL = 'eleven_flash_v2_5';
  process.env.ELEVENLABS_VOICE_ID = testVoice;
  capturedRequests = [];
  createFetchResponse = () => {
    throw new Error('Unexpected network request in a credential-free test');
  };
  // Use the real installed SDK, replacing only HTTP. Tests can never spend credits.
  mock.method(
    globalThis,
    'fetch',
    async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedRequests.push(new Request(input, init));
      return createFetchResponse();
    },
  );
});

afterEach(() => {
  mock.restoreAll();
  for (const name of variables) {
    const value = originals[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function code(expected: string) {
  return (error: unknown): boolean => {
    assert.ok(error instanceof VoiceError);
    assert.equal(error.code, expected);
    assert.ok(error.message.length > 0);
    assert.ok(!String(error).includes(testApiKey));
    assert.ok(!String(error).includes(privateDetail));
    return true;
  };
}

function mp3Response() {
  return new Response(audioBytes, {
    headers: { 'Content-Type': 'audio/mpeg' },
  });
}

function recording() {
  return new File(
    [new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])],
    'recording.webm',
    { type: 'audio/webm;codecs=opus' },
  );
}

function transcriptResponse(
  text = '  Lọc doanh thu tháng chín.  ',
  language = 'vie',
) {
  return Response.json({
    text,
    language_code: language,
    language_probability: 0.92,
    words: [],
  });
}

test('TTS preserves supplied text and uses only configured voice, explicit Flash model and MP3', async () => {
  createFetchResponse = mp3Response;
  const text = '  Ngày 09/10, 1.250.000 VND và 12.5%.  ';
  assert.deepEqual(
    await synthesiseSpeech({ text, language: 'vi' }),
    audioBytes,
  );
  assert.equal(capturedRequests.length, 1);
  const request = capturedRequests[0]!;
  const url = new URL(request.url);
  assert.equal(url.origin, 'https://api.elevenlabs.io');
  assert.equal(url.pathname, `/v1/text-to-speech/${testVoice}`);
  assert.equal(url.searchParams.get('output_format'), 'mp3_44100_128');
  assert.equal(request.method, 'POST');
  assert.equal(request.headers.get('xi-api-key'), testApiKey);
  assert.deepEqual(await request.json(), {
    text,
    model_id: 'eleven_flash_v2_5',
    language_code: 'vi',
  });
});

test('English and absent TTS language remain server-controlled supported options', async () => {
  createFetchResponse = mp3Response;
  await synthesiseSpeech({ text: 'Compare Q3 with Q2.', language: 'en' });
  assert.equal((await capturedRequests[0]!.json()).language_code, 'en');
  await synthesiseSpeech({ text: 'Compare Q3 with Q2.' });
  assert.deepEqual(await capturedRequests[1]!.json(), {
    text: 'Compare Q3 with Q2.',
    model_id: 'eleven_flash_v2_5',
  });
});

test('rejects invalid, blank, oversized and additional synthesis options before HTTP', async () => {
  const invalidInputs: unknown[] = [
    null,
    'Speak this',
    {},
    { text: 123 },
    { text: '' },
    { text: ' \n\t ' },
    { text: 'a'.repeat(1001) },
    { text: '😀'.repeat(1001) },
    { text: 'Speak this', voiceId: 'unapproved' },
    { text: 'Speak this', modelId: 'unapproved' },
    { text: 'Speak this', language: 'fr' },
  ];
  for (const input of invalidInputs)
    await assert.rejects(synthesiseSpeech(input), code('INVALID_INPUT'));
  assert.equal(capturedRequests.length, 0);
});

test('the 1,000-character bound counts Unicode code points rather than UTF-16 units', async () => {
  createFetchResponse = mp3Response;
  const text = '😀'.repeat(1000);
  assert.deepEqual(await synthesiseSpeech({ text }), audioBytes);
  assert.equal((await capturedRequests[0]!.json()).text, text);
});

for (const name of variables) {
  test(`missing ${name} fails before any request to the affected provider feature`, async () => {
    delete process.env[name];
    const operation =
      name === 'ELEVENLABS_STT_MODEL'
        ? transcribeAudio(recording(), 'auto')
        : synthesiseSpeech({ text: 'Voice test.' });
    await assert.rejects(operation, code('SETUP_REQUIRED'));
    assert.equal(capturedRequests.length, 0);
  });
}

test('a different model cannot silently replace the selected milestone models', async () => {
  process.env.ELEVENLABS_STT_MODEL = 'scribe_v1';
  process.env.ELEVENLABS_TTS_MODEL = 'eleven_multilingual_v2';
  await assert.rejects(
    transcribeAudio(recording(), 'auto'),
    code('SETUP_REQUIRED'),
  );
  await assert.rejects(
    synthesiseSpeech({ text: 'Voice test.' }),
    code('SETUP_REQUIRED'),
  );
  assert.equal(capturedRequests.length, 0);
});

for (const language of ['auto', 'vi', 'en'] as const) {
  test(`recorded ${language} transcription uses synchronous Scribe v2 without enrichment`, async () => {
    createFetchResponse = () => transcriptResponse();
    const result = await transcribeAudio(recording(), language);
    assert.deepEqual(result, {
      transcript: '  Lọc doanh thu tháng chín.  ',
      detected_language: 'vie',
    });
    assert.equal(capturedRequests.length, 1);
    const request = capturedRequests[0]!;
    assert.equal(new URL(request.url).pathname, '/v1/speech-to-text');
    assert.equal(request.headers.get('xi-api-key'), testApiKey);
    const form = await request.formData();
    assert.equal(form.get('model_id'), 'scribe_v2');
    assert.equal(
      form.get('language_code'),
      language === 'auto' ? null : language,
    );
    for (const name of [
      'tag_audio_events',
      'diarize',
      'webhook',
      'no_verbatim',
      'use_multi_channel',
    ])
      assert.equal(form.get(name), 'false');
    assert.equal(form.get('timestamps_granularity'), 'none');
    for (const name of [
      'cloud_storage_url',
      'webhook_id',
      'entity_detection',
      'keyterms',
      'webhook_metadata',
    ])
      assert.equal(form.has(name), false);
    const file = form.get('file');
    assert.ok(file instanceof File);
    assert.equal(file.name, 'recording.webm');
    assert.equal(file.type, 'audio/webm;codecs=opus');
    assert.deepEqual(
      new Uint8Array(await file.arrayBuffer()),
      new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]),
    );
    assert.equal('language_probability' in result, false);
  });
}

test('empty transcription is preserved for the no-speech UI rather than invented content', async () => {
  createFetchResponse = () => transcriptResponse('');
  assert.deepEqual(await transcribeAudio(recording(), 'auto'), {
    transcript: '',
    detected_language: 'vie',
  });
});

test('an empty provider language is not invented or replaced with the preference', async () => {
  createFetchResponse = () => transcriptResponse('Compare Q3 with Q2.', '');
  assert.deepEqual(await transcribeAudio(recording(), 'auto'), {
    transcript: 'Compare Q3 with Q2.',
  });
});

test('the SDK rejects a malformed transcript response missing required provider fields', async () => {
  createFetchResponse = () =>
    Response.json({ text: 'Compare Q3 with Q2.', words: [] });
  await assert.rejects(
    transcribeAudio(recording(), 'auto'),
    code('PROVIDER_FAILURE'),
  );
  assert.equal(capturedRequests.length, 1);
});

for (const [status, providerCode, expected] of [
  [401, 'invalid_api_key', 'SETUP_REQUIRED'],
  [403, 'voice_access_denied', 'SETUP_REQUIRED'],
  [404, 'voice_not_found', 'SETUP_REQUIRED'],
  [429, 'quota_exceeded', 'QUOTA_EXHAUSTED'],
  [402, 'insufficient_credits', 'QUOTA_EXHAUSTED'],
  [402, 'payment_required', 'PROVIDER_ACCESS_REQUIRED'],
  [429, 'rate_limit_exceeded', 'RATE_LIMITED'],
  [503, 'unavailable', 'PROVIDER_FAILURE'],
] as const) {
  test(`provider ${status}/${providerCode} is safely mapped without retries`, async () => {
    createFetchResponse = () =>
      Response.json(
        {
          detail: {
            status: providerCode,
            message: `${privateDetail} ${testApiKey}`,
          },
        },
        { status },
      );
    await assert.rejects(
      synthesiseSpeech({ text: 'Voice test.' }),
      (error: unknown) => {
        code(expected)(error);
        if (expected === 'PROVIDER_ACCESS_REQUIRED') {
          assert.ok(error instanceof VoiceError);
          assert.equal(error.status, 503);
          assert.equal(error.retryable, false);
        }
        return true;
      },
    );
    assert.equal(capturedRequests.length, 1);
  });
}

test('transcription quota failure is mapped and never automatically retried', async () => {
  createFetchResponse = () =>
    Response.json(
      { detail: { status: 'quota_exceeded', message: privateDetail } },
      { status: 429 },
    );
  await assert.rejects(
    transcribeAudio(recording(), 'vi'),
    code('QUOTA_EXHAUSTED'),
  );
  assert.equal(capturedRequests.length, 1);
});

test('unexpected, empty and oversized audio are rejected', async () => {
  for (const createResponse of [
    () => Response.json({ detail: privateDetail }),
    () =>
      new Response(new Uint8Array(), {
        headers: { 'Content-Type': 'audio/mpeg' },
      }),
    () =>
      new Response(new Uint8Array(4 * 1024 * 1024 + 1), {
        headers: { 'Content-Type': 'audio/mpeg' },
      }),
  ]) {
    createFetchResponse = createResponse;
    await assert.rejects(
      synthesiseSpeech({ text: 'Voice test.' }),
      code('PROVIDER_FAILURE'),
    );
  }
  assert.equal(capturedRequests.length, 3);
});

test('cancellation before either provider call consumes no request', async () => {
  const controller = new AbortController();
  controller.abort(new Error(privateDetail));
  await assert.rejects(
    synthesiseSpeech({ text: 'Voice test.' }, controller.signal),
    code('CANCELLED'),
  );
  await assert.rejects(
    transcribeAudio(recording(), 'auto', controller.signal),
    code('CANCELLED'),
  );
  assert.equal(capturedRequests.length, 0);
});

test('cancellation during audio streaming cancels the stream and cannot return stale audio', async () => {
  const controller = new AbortController();
  let streamCancelled = false;
  createFetchResponse = () =>
    new Response(
      new ReadableStream<Uint8Array>(
        {
          pull(stream) {
            stream.enqueue(audioBytes);
            controller.abort(new Error(privateDetail));
          },
          cancel() {
            streamCancelled = true;
          },
        },
        { highWaterMark: 0 },
      ),
      { headers: { 'Content-Type': 'audio/mpeg' } },
    );
  await assert.rejects(
    synthesiseSpeech({ text: 'Voice test.' }, controller.signal),
    code('CANCELLED'),
  );
  assert.equal(capturedRequests.length, 1);
  assert.equal(streamCancelled, true);
});

test('provider deadline reports a recoverable timeout without sending a pre-expired request', async () => {
  mock.method(AbortSignal, 'timeout', () =>
    AbortSignal.abort(new DOMException('Test deadline', 'TimeoutError')),
  );
  await assert.rejects(
    synthesiseSpeech({ text: 'Voice test.' }),
    code('TIMEOUT'),
  );
  assert.equal(capturedRequests.length, 0);
});
