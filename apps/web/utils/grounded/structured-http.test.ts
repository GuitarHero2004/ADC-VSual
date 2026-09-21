import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import {
  STRUCTURED_LIMITS,
  fingerprintStructuredSnapshot,
  structuredRequestSchema,
  structuredResponseSchema,
  voiceErrorResponseSchema,
  type StructuredRequest,
  type StructuredResponse,
  type UsageLimit,
} from '@adc/contracts';
import { VoiceError } from '../voice/errors.ts';
import { voicePreflight } from '../voice/http.ts';
import { createStructuredHandler } from './structured-http.ts';
import { structuredAnswer, structuredFixture } from './structured-fixtures.ts';

const origin = 'chrome-extension://synthetic-extension';
const originalOrigins = process.env.VOICE_ALLOWED_ORIGINS;
afterEach(() => {
  mock.restoreAll();
  mock.timers.reset();
  if (originalOrigins === undefined) delete process.env.VOICE_ALLOWED_ORIGINS;
  else process.env.VOICE_ALLOWED_ORIGINS = originalOrigins;
});
function request(input: unknown, init: RequestInit = {}) {
  process.env.VOICE_ALLOWED_ORIGINS = origin;
  return new Request('https://backend.example/api/structured-read', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin,
      authorization: 'Bearer synthetic-unusable',
    },
    body: JSON.stringify(input),
    ...init,
  });
}
const responseFor = (input: StructuredRequest): StructuredResponse => ({
  ...structuredAnswer,
  source_kind: 'structured_page',
  request_id: input.request_id,
  snapshot_id: input.snapshot.snapshot_id,
  fingerprint: input.snapshot.fingerprint,
  included_section_ids: input.section_id
    ? [input.section_id]
    : input.snapshot.coverage.included_sections,
  partial:
    input.snapshot.coverage.partial ||
    (!!input.section_id && input.snapshot.sections.length > 1),
});
function setup() {
  const calls = { auth: 0, budget: 0, reserve: 0, provider: 0 };
  const dependencies: Parameters<typeof createStructuredHandler>[0] = {
    verifyVoiceUser: async () => {
      calls.auth++;
      return { userId: 'user', subject: 'subject', workspaceId: 'workspace' };
    },
    prepareStructuredInput: () => {
      calls.budget++;
    },
    reserveVoiceRequest: async () => {
      calls.reserve++;
    },
    answerStructuredPage: async (input) => {
      calls.provider++;
      return responseFor(input);
    },
  };
  return {
    calls,
    dependencies,
    run: (req: Request) => createStructuredHandler(dependencies)(req),
  };
}
async function error(response: Response, expected: string) {
  const parsed = voiceErrorResponseSchema.parse(await response.json());
  assert.equal(parsed.error.code, expected);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return parsed;
}

test('authenticated structured request preserves source binding, CORS and no-store', async () => {
  const input = await structuredFixture();
  const { run, calls } = setup();
  const response = await run(request(input));
  assert.equal(response.status, 200);
  assert.deepEqual(
    structuredResponseSchema.parse(await response.json()),
    responseFor(input),
  );
  assert.equal(response.headers.get('access-control-allow-origin'), origin);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-request-id'), input.request_id);
  assert.deepEqual(calls, { auth: 1, budget: 1, reserve: 1, provider: 1 });
});
test('preflight uses the existing exact origin policy', async () => {
  process.env.VOICE_ALLOWED_ORIGINS = origin;
  const allowed = voicePreflight(
    new Request('https://backend.example/api/structured-read', {
      method: 'OPTIONS',
      headers: { origin },
    }),
  );
  assert.equal(allowed.status, 204);
  const denied = voicePreflight(
    new Request('https://backend.example/api/structured-read', {
      method: 'OPTIONS',
      headers: { origin: 'https://untrusted.example' },
    }),
  );
  assert.equal(denied.status, 403);
});
for (const authCode of [
  'UNAUTHENTICATED',
  'AUTH_UNAVAILABLE',
  'FORBIDDEN',
] as const) {
  test(`${authCode} rejects before reading or billing model input`, async () => {
    const { dependencies, calls, run } = setup();
    dependencies.verifyVoiceUser = async () => {
      throw new VoiceError(
        authCode,
        'Account unavailable.',
        authCode === 'UNAUTHENTICATED' ? 401 : 403,
      );
    };
    await error(await run(request({ invalid: true })), authCode);
    assert.equal(calls.budget, 0);
    assert.equal(calls.reserve, 0);
    assert.equal(calls.provider, 0);
  });
}
test('workspace rejection during durable reservation never invokes the provider', async () => {
  const { dependencies, calls, run } = setup();
  dependencies.reserveVoiceRequest = async () => {
    throw new VoiceError('FORBIDDEN', 'No workspace access.', 403);
  };
  await error(await run(request(await structuredFixture())), 'FORBIDDEN');
  assert.equal(calls.provider, 0);
});
test('malformed input, missing consent and foreign section IDs are rejected before usage', async () => {
  for (const input of [
    {},
    { ...(await structuredFixture()), consent: false },
    { ...(await structuredFixture()), section_id: 's99' },
  ]) {
    const { run, calls } = setup();
    await error(await run(request(input)), 'INVALID_INPUT');
    assert.equal(calls.reserve, 0);
    assert.equal(calls.provider, 0);
  }
});
test('body limit is enforced on declared length and streamed bytes', async () => {
  const { run, calls } = setup();
  const headers = {
    'content-type': 'application/json',
    authorization: 'Bearer synthetic-unusable',
    'content-length': String(STRUCTURED_LIMITS.bodyBytes + 1),
  };
  await error(await run(request({}, { headers })), 'INPUT_TOO_LARGE');
  await error(
    await run(
      request({}, { body: ' '.repeat(STRUCTURED_LIMITS.bodyBytes + 1) }),
    ),
    'INPUT_TOO_LARGE',
  );
  assert.equal(calls.reserve, 0);
  assert.equal(calls.provider, 0);
});
test('20k codepoint source and 1000-codepoint question ceilings are backend-enforced', async () => {
  const input = await structuredFixture();
  input.question = '😀'.repeat(1001);
  const { run, calls } = setup();
  await error(await run(request(input)), 'INVALID_INPUT');
  input.question = 'Explain this';
  input.snapshot.blocks[0]!.text = '😀'.repeat(
    STRUCTURED_LIMITS.textCodePoints,
  );
  await error(await run(request(input)), 'INVALID_INPUT');
  assert.equal(calls.reserve, 0);
  assert.equal(calls.provider, 0);
});
test('snapshot rejects duplicate IDs, invalid coverage and query-bearing source paths', async () => {
  const input = await structuredFixture();
  input.snapshot.blocks.push({ ...input.snapshot.blocks[0]! });
  assert.equal(structuredRequestSchema.safeParse(input).success, false);
  input.snapshot.blocks.pop();
  input.snapshot.coverage.limitations = ['tables'];
  assert.equal(structuredRequestSchema.safeParse(input).success, false);
  input.snapshot.coverage.partial = true;
  assert.equal(structuredRequestSchema.safeParse(input).success, true);
  input.snapshot.pathname = '/article?private=value';
  assert.equal(structuredRequestSchema.safeParse(input).success, false);
});
test('fingerprint binds document, tab, window and content while ignoring capture timestamp', async () => {
  const input = await structuredFixture();
  input.snapshot.captured_at = new Date(0).toISOString();
  assert.equal(
    await fingerprintStructuredSnapshot(input.snapshot),
    input.snapshot.fingerprint,
  );
  for (const change of [
    { tab_id: 50 },
    { window_id: 50 },
    { title: 'Different resource' },
    { document_key: crypto.randomUUID() },
  ]) {
    assert.notEqual(
      await fingerprintStructuredSnapshot({ ...input.snapshot, ...change }),
      input.snapshot.fingerprint,
    );
  }
});
test('outdated, future and content-mismatched snapshots are rejected before usage', async () => {
  for (const change of [
    { captured_at: new Date(Date.now() - 31_000).toISOString() },
    { captured_at: new Date(Date.now() + 10_000).toISOString() },
    { title: 'Changed title' },
  ]) {
    const input = await structuredFixture();
    Object.assign(input.snapshot, change);
    const { run, calls } = setup();
    await error(await run(request(input)), 'INVALID_INPUT');
    assert.equal(calls.reserve, 0);
    assert.equal(calls.provider, 0);
  }
});
test('missing configuration and model-input limits fail before usage reservation', async () => {
  for (const failure of ['SETUP_REQUIRED', 'INPUT_TOO_LARGE'] as const) {
    const { dependencies, calls, run } = setup();
    dependencies.prepareStructuredInput = () => {
      throw new VoiceError(failure, 'Setup or shorter section required.', 503);
    };
    await error(await run(request(await structuredFixture())), failure);
    assert.equal(calls.reserve, 0);
    assert.equal(calls.provider, 0);
  }
});
test('durable duplicate protection rejects the same submitted request before provider execution', async () => {
  const { dependencies, calls, run } = setup();
  dependencies.reserveVoiceRequest = async () => {
    throw new VoiceError('DUPLICATE_REQUEST', 'Already submitted.', 409);
  };
  await error(
    await run(request(await structuredFixture())),
    'DUPLICATE_REQUEST',
  );
  assert.equal(calls.provider, 0);
});
test('application limit evidence remains distinct from provider limits and content is not logged', async () => {
  const usage: UsageLimit = {
    minute_count: 6,
    minute_limit: 6,
    day_count: 6,
    day_limit: 30,
    limited_by: 'minute',
    retry_after_seconds: 40,
    retry_at: new Date(Date.now() + 40_000).toISOString(),
  };
  const logged: unknown[] = [];
  mock.method(console, 'info', (value: unknown) => logged.push(value));
  const { dependencies, calls, run } = setup();
  dependencies.reserveVoiceRequest = async () => {
    throw new VoiceError(
      'APP_RATE_LIMITED',
      'Application limit reached.',
      429,
      true,
      usage,
    );
  };
  const input = await structuredFixture();
  const response = await run(request(input));
  assert.deepEqual(
    (await error(response, 'APP_RATE_LIMITED')).error.usage,
    usage,
  );
  assert.equal(response.headers.get('retry-after'), '40');
  assert.equal(calls.provider, 0);
  assert.ok(!JSON.stringify(logged).includes(input.question));
  assert.ok(!JSON.stringify(logged).includes(input.snapshot.blocks[0]!.text));
  assert.ok(JSON.stringify(logged).includes('/api/structured-read'));
});
test('provider limits and timeout are recoverable without an automatic second request', async () => {
  for (const failure of [
    'PROVIDER_RATE_LIMITED',
    'QUOTA_EXHAUSTED',
    'TIMEOUT',
  ] as const) {
    const { dependencies, calls, run } = setup();
    dependencies.answerStructuredPage = async () => {
      calls.provider++;
      throw new VoiceError(
        failure,
        'Provider unavailable.',
        failure === 'TIMEOUT' ? 504 : 429,
        true,
      );
    };
    const result = await error(
      await run(request(await structuredFixture())),
      failure,
    );
    assert.equal(result.error.usage, undefined);
    assert.equal(calls.provider, 1);
  }
});
test('client cancellation during provider work rejects a late valid answer', async () => {
  const controller = new AbortController();
  const { dependencies, run } = setup();
  dependencies.answerStructuredPage = async (input) => {
    controller.abort();
    return responseFor(input);
  };
  await error(
    await run(
      request(await structuredFixture(), { signal: controller.signal }),
    ),
    'CANCELLED',
  );
});
test('overall deadline bounds stalled authentication and never dispatches a late provider call', async () => {
  const input = await structuredFixture();
  const { dependencies, calls, run } = setup();
  let finish!: (value: {
    userId: string;
    subject: string;
    workspaceId: string;
  }) => void;
  dependencies.verifyVoiceUser = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  mock.timers.enable({ apis: ['setTimeout'] });
  const pending = run(request(input));
  mock.timers.tick(STRUCTURED_LIMITS.taskTimeoutMs);
  await error(await pending, 'TIMEOUT');
  finish({ userId: 'user', subject: 'subject', workspaceId: 'workspace' });
  await Promise.resolve();
  assert.equal(calls.reserve, 0);
  assert.equal(calls.provider, 0);
});
test('route rejects provider responses from another source or with invented excerpts', async () => {
  for (const change of [
    { snapshot_id: crypto.randomUUID() },
    { evidence_ids: ['b99'] },
    { included_section_ids: ['s99'] },
    { partial: true },
  ]) {
    const { dependencies, run } = setup();
    dependencies.answerStructuredPage = async (input) => ({
      ...responseFor(input),
      ...change,
    });
    const response = await run(request(await structuredFixture()));
    assert.notEqual(response.status, 200);
  }
});
