import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import {
  fingerprintSnapshot,
  GROUNDED_MAX_BODY_BYTES,
  groundedResponseSchema,
  type GroundedRequest,
  type ComparisonInterpretation,
  voiceErrorResponseSchema,
  type UsageLimit,
} from '@adc/contracts';
import { VoiceError } from '../voice/errors.ts';
import { voicePreflight } from '../voice/http.ts';
import { createGroundedHandler } from './http.ts';

const requestId = '11111111-1111-4111-8111-111111111111';
const variables = [
  'GROUNDED_ALLOWED_ORIGINS',
  'VOICE_ALLOWED_ORIGINS',
  'NODE_ENV',
] as const;
const environment: Record<string, string | undefined> = process.env;
const originals = Object.fromEntries(
  variables.map((name) => [name, process.env[name]]),
);
const intent: ComparisonInterpretation = {
  decision: 'comparison',
  answer_language: 'en',
  operation: 'compare',
  metric: 'completed_orders',
  region: 'South',
  baseline_period: '2026-07',
  comparison_period: '2026-08',
  reason: null,
};

beforeEach(() => {
  process.env.GROUNDED_ALLOWED_ORIGINS = 'https://demo.example';
  process.env.VOICE_ALLOWED_ORIGINS = 'chrome-extension://test-extension';
});
afterEach(() => {
  for (const name of variables) {
    if (originals[name] === undefined) delete process.env[name];
    else environment[name] = originals[name];
  }
});

async function payload(): Promise<GroundedRequest> {
  const input: GroundedRequest = {
    request_id: requestId,
    question: 'Compare completed orders in South for August and July.',
    consent: true,
    snapshot: {
      snapshot_id: '22222222-2222-4222-8222-222222222222',
      document_key: '33333333-3333-4333-8333-333333333333',
      adapter_key: 'orders-fixture@1',
      captured_at: new Date().toISOString(),
      origin: 'https://demo.example',
      pathname: '/orders',
      title: 'Orders',
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
    },
  };
  input.snapshot.fingerprint = await fingerprintSnapshot(input.snapshot);
  return input;
}
function json(body: unknown, init: RequestInit = {}) {
  return new Request('https://backend.example/api/grounded-read', {
    method: 'POST',
    headers: {
      Origin: 'https://backend.example',
      'Content-Type': 'application/json',
      'X-Request-ID': requestId,
    },
    body: JSON.stringify(body),
    ...init,
  });
}
function setup() {
  const calls = { auth: 0, config: 0, reserve: 0, provider: 0 };
  const identity = {
    subject: 'subject',
    userId: 'user',
    workspaceId: 'workspace',
  };
  const dependencies = {
    async verifyVoiceUser() {
      calls.auth++;
      return identity;
    },
    async reserveVoiceRequest(received: typeof identity, id: string) {
      calls.reserve++;
      assert.deepEqual(received, identity);
      assert.equal(id, requestId);
    },
    requireGroundedConfiguration() {
      calls.config++;
    },
    async interpretComparison(input: GroundedRequest, signal: AbortSignal) {
      assert.equal(input.consent, true);
      signal.throwIfAborted();
      calls.provider++;
      return intent;
    },
  };
  return { calls, dependencies };
}

test('unauthenticated and forbidden workspace requests never reach reservation or provider', async () => {
  for (const code of ['UNAUTHENTICATED', 'FORBIDDEN'] as const) {
    const { calls, dependencies } = setup();
    dependencies.verifyVoiceUser = async () => {
      throw new VoiceError(
        code,
        'Access denied.',
        code === 'UNAUTHENTICATED' ? 401 : 403,
      );
    };
    const response = await createGroundedHandler(dependencies)(
      json(await payload()),
    );
    assert.equal(response.status, code === 'UNAUTHENTICATED' ? 401 : 403);
    assert.equal(calls.reserve, 0);
    assert.equal(calls.provider, 0);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});

test('valid fresh evidence reserves once and returns deterministic linked uncached answer', async () => {
  const { calls, dependencies } = setup();
  const input = await payload();
  const response = await createGroundedHandler(dependencies)(json(input));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-request-id'), requestId);
  const result = groundedResponseSchema.parse(await response.json());
  assert.equal(result.request_id, input.request_id);
  assert.equal(result.snapshot_id, input.snapshot.snapshot_id);
  assert.equal(result.fingerprint, input.snapshot.fingerprint);
  assert.equal(result.status, 'answer');
  assert.equal(result.answer_language, 'en');
  if (result.status !== 'answer') throw new Error('Expected comparison');
  assert.deepEqual(result.evidence.rows, input.snapshot.rows);
  assert.equal(result.evidence.calculation.difference, -300);
  assert.equal(result.evidence.calculation.percentage_change, '-25');
  assert.deepEqual(calls, { auth: 1, config: 1, reserve: 1, provider: 1 });
});

test('malformed, out-of-scope, no-consent and oversized question inputs never reserve usage', async () => {
  const valid = await payload();
  const inputs: unknown[] = [
    null,
    {},
    { ...valid, consent: false },
    { ...valid, userId: 'forged' },
    { ...valid, language: 'vi' },
    { ...valid, answer_language: 'vi' },
    { ...valid, question: '' },
    { ...valid, question: '😀'.repeat(1001) },
    { ...valid, model: 'override' },
    { ...valid, session_id: 'someone-elses-evidence' },
    { ...valid, snapshot: { ...valid.snapshot, pathname: '/other' } },
    { ...valid, snapshot: { ...valid.snapshot, is_complete: false } },
    { ...valid, snapshot: { ...valid.snapshot, metric: 'revenue' } },
    {
      ...valid,
      snapshot: {
        ...valid.snapshot,
        rows: [...valid.snapshot.rows, valid.snapshot.rows[0]],
      },
    },
    {
      ...valid,
      snapshot: {
        ...valid.snapshot,
        rows: Array.from({ length: 101 }, () => valid.snapshot.rows[0]),
      },
    },
    {
      ...valid,
      snapshot: {
        ...valid.snapshot,
        rows: [{ ...valid.snapshot.rows[0], raw_value: '1.200', value: 1200 }],
      },
    },
    {
      ...valid,
      snapshot: {
        ...valid.snapshot,
        rows: [{ ...valid.snapshot.rows[0], value: 1201 }],
      },
    },
    { ...valid, snapshot: { ...valid.snapshot, fingerprint: 'a'.repeat(64) } },
    { ...valid, request_id: crypto.randomUUID() },
  ];
  for (const input of inputs) {
    const { calls, dependencies } = setup();
    const response = await createGroundedHandler(dependencies)(json(input));
    assert.equal(response.status, 400);
    assert.equal(calls.reserve, 0);
    assert.equal(calls.provider, 0);
  }
});

test('actual streamed bytes and declared size are bounded before parsing or provider processing', async () => {
  const inputs = [
    json({}, { body: ' '.repeat(GROUNDED_MAX_BODY_BYTES + 1) }),
    json(
      {},
      {
        headers: {
          Origin: 'https://backend.example',
          'Content-Type': 'application/json',
          'Content-Length': String(GROUNDED_MAX_BODY_BYTES + 1),
        },
      },
    ),
    json(
      {},
      {
        body: ' '.repeat(GROUNDED_MAX_BODY_BYTES + 1),
        headers: {
          Origin: 'https://backend.example',
          'Content-Type': 'application/json',
          'Content-Length': '1',
        },
      },
    ),
  ];
  for (const input of inputs) {
    const { calls, dependencies } = setup();
    assert.equal(
      (await createGroundedHandler(dependencies)(input)).status,
      413,
    );
    assert.equal(calls.reserve, 0);
    assert.equal(calls.provider, 0);
  }
});

test('invalid JSON, invalid UTF-8 and wrong content types are recoverable input errors', async () => {
  for (const request of [
    json({}, { body: '{' }),
    json({}, { body: new Uint8Array([0xff]) }),
    json(
      {},
      {
        headers: {
          Origin: 'https://backend.example',
          'Content-Type': 'text/plain',
        },
      },
    ),
  ]) {
    const { dependencies, calls } = setup();
    assert.equal(
      (await createGroundedHandler(dependencies)(request)).status,
      400,
    );
    assert.equal(calls.provider, 0);
  }
});

test('expired or future snapshots are rejected before AI configuration and usage', async () => {
  for (const offset of [-31_000, 10_000]) {
    const input = await payload();
    input.snapshot.captured_at = new Date(Date.now() + offset).toISOString();
    const { calls, dependencies } = setup();
    assert.equal(
      (await createGroundedHandler(dependencies)(json(input))).status,
      400,
    );
    assert.equal(calls.config, 0);
    assert.equal(calls.reserve, 0);
    assert.equal(calls.provider, 0);
  }
});

test('exact page-origin checks do not trust arbitrary deployment domains', async () => {
  const input = await payload();
  input.snapshot.origin = 'https://another-preview.vercel.app';
  input.snapshot.fingerprint = await fingerprintSnapshot(input.snapshot);
  const { calls, dependencies } = setup();
  assert.equal(
    (await createGroundedHandler(dependencies)(json(input))).status,
    403,
  );
  assert.equal(calls.reserve, 0);
  assert.equal(calls.provider, 0);
});

test('missing production origins and wildcard configuration fail closed', async () => {
  environment.NODE_ENV = 'production';
  for (const value of [
    undefined,
    '*',
    'https://*.vercel.app',
    'https://demo.example/orders',
  ]) {
    if (value === undefined) delete process.env.GROUNDED_ALLOWED_ORIGINS;
    else process.env.GROUNDED_ALLOWED_ORIGINS = value;
    const { calls, dependencies } = setup();
    const response = await createGroundedHandler(dependencies)(
      json(await payload()),
    );
    assert.equal(response.status, 503);
    assert.equal(calls.reserve, 0);
    assert.equal(calls.provider, 0);
  }
});

test('missing AI configuration fails before any reserved usage', async () => {
  const { calls, dependencies } = setup();
  dependencies.requireGroundedConfiguration = () => {
    throw new VoiceError(
      'SETUP_REQUIRED',
      'AI answers are not configured.',
      503,
    );
  };
  const response = await createGroundedHandler(dependencies)(
    json(await payload()),
  );
  assert.equal(response.status, 503);
  assert.equal(calls.reserve, 0);
  assert.equal(calls.provider, 0);
});

test('shared durable limit and duplicate rejection prevent another model request', async (context) => {
  context.mock.method(console, 'info', () => {});
  for (const code of ['APP_RATE_LIMITED', 'DUPLICATE_REQUEST'] as const) {
    const { calls, dependencies } = setup();
    dependencies.reserveVoiceRequest = async () => {
      throw new VoiceError(
        code,
        'No new request.',
        code === 'APP_RATE_LIMITED' ? 429 : 409,
        code === 'APP_RATE_LIMITED',
        code === 'APP_RATE_LIMITED'
          ? {
              minute_count: 6,
              minute_limit: 6,
              day_count: 6,
              day_limit: 30,
              limited_by: 'minute',
              retry_after_seconds: 1,
              retry_at: '2026-09-21T12:00:01.000Z',
            }
          : undefined,
      );
    };
    const response = await createGroundedHandler(dependencies)(
      json(await payload()),
    );
    assert.equal(response.status, code === 'APP_RATE_LIMITED' ? 429 : 409);
    assert.equal(calls.provider, 0);
  }
});

test('grounded answers carry the same application quota evidence without invoking the model', async (context) => {
  const logged = context.mock.method(console, 'info', () => {});
  const { calls, dependencies } = setup();
  const usage: UsageLimit = {
    minute_count: 6,
    minute_limit: 6,
    day_count: 30,
    day_limit: 30,
    limited_by: 'both',
    retry_after_seconds: 3600,
    retry_at: '2026-09-21T13:00:00.000Z',
  };
  dependencies.reserveVoiceRequest = async () => {
    throw new VoiceError(
      'APP_RATE_LIMITED',
      'VSual limit reached.',
      429,
      true,
      usage,
    );
  };
  const response = await createGroundedHandler(dependencies)(
    json(await payload()),
  );
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('Retry-After'), '3600');
  const body = voiceErrorResponseSchema.parse(await response.json());
  assert.equal(body.error.code, 'APP_RATE_LIMITED');
  assert.deepEqual(body.error.usage, usage);
  assert.equal(calls.provider, 0);
  assert.equal(logged.mock.callCount(), 1);
});

test('upstream model throttling remains distinct from the application budget without fabricated usage', async (context) => {
  const logged = context.mock.method(console, 'info', () => {});
  const { dependencies } = setup();
  dependencies.interpretComparison = async () => {
    throw new VoiceError(
      'PROVIDER_RATE_LIMITED',
      'AI requests are temporarily limited.',
      429,
      true,
    );
  };
  const response = await createGroundedHandler(dependencies)(
    json(await payload()),
  );
  const body = voiceErrorResponseSchema.parse(await response.json());
  assert.equal(body.error.code, 'PROVIDER_RATE_LIMITED');
  assert.equal(body.error.message, 'AI requests are temporarily limited.');
  assert.equal(body.error.usage, undefined);
  assert.equal(response.headers.get('Retry-After'), null);
  assert.equal(logged.mock.callCount(), 0);
});

test('cancellation after auth or reservation never starts AI and a late result is discarded', async () => {
  for (const stage of ['auth', 'reserve', 'provider'] as const) {
    const controller = new AbortController();
    const { calls, dependencies } = setup();
    if (stage === 'auth')
      dependencies.verifyVoiceUser = async () => {
        controller.abort();
        return { subject: 'subject', userId: 'user', workspaceId: 'workspace' };
      };
    if (stage === 'reserve')
      dependencies.reserveVoiceRequest = async () => {
        controller.abort();
      };
    if (stage === 'provider')
      dependencies.interpretComparison = async () => {
        controller.abort();
        return intent;
      };
    const response = await createGroundedHandler(dependencies)(
      json(await payload(), { signal: controller.signal }),
    );
    assert.equal(response.status, 499);
    assert.equal((await response.json()).error.code, 'CANCELLED');
    assert.equal(calls.provider, 0);
  }
});

test('provider timeout is safely returned with request linkage and no retry', async () => {
  const { dependencies, calls } = setup();
  dependencies.interpretComparison = async () => {
    calls.provider++;
    throw new VoiceError('TIMEOUT', 'Try again.', 504, true);
  };
  const response = await createGroundedHandler(dependencies)(
    json(await payload()),
  );
  assert.equal(response.status, 504);
  const result = await response.json();
  assert.equal(result.error.code, 'TIMEOUT');
  assert.equal(result.error.retryable, true);
  assert.equal(result.request_id, requestId);
  assert.equal(calls.provider, 1);
});

test('extension CORS preflight is allowed separately from mandatory authentication', async () => {
  const origin = 'chrome-extension://test-extension';
  const options = voicePreflight(
    new Request('https://backend.example/api/grounded-read', {
      method: 'OPTIONS',
      headers: { Origin: origin },
    }),
  );
  assert.equal(options.status, 204);
  assert.equal(options.headers.get('access-control-allow-origin'), origin);
  const { dependencies, calls } = setup();
  dependencies.verifyVoiceUser = async () => {
    throw new VoiceError('UNAUTHENTICATED', 'Sign in.', 401);
  };
  const response = await createGroundedHandler(dependencies)(
    json(await payload(), {
      headers: { Origin: origin, 'Content-Type': 'application/json' },
    }),
  );
  assert.equal(response.status, 401);
  assert.equal(calls.provider, 0);
  assert.equal(response.headers.get('access-control-allow-origin'), origin);
});

test('unapproved client origins are rejected before authentication or AI', async () => {
  const { dependencies, calls } = setup();
  const response = await createGroundedHandler(dependencies)(
    json(await payload(), {
      headers: {
        Origin: 'https://evil.example',
        'Content-Type': 'application/json',
      },
    }),
  );
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.equal(calls.auth, 0);
  assert.equal(calls.provider, 0);
});
