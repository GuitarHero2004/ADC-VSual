import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import {
  VISUAL_LIMITS,
  fingerprintVisualSnapshot,
  visualResponseSchema,
  voiceErrorResponseSchema,
  type VisualRequest,
  type VisualResponse,
} from '@adc/contracts';
import { VoiceError } from '../voice/errors.ts';
import { createVisualHandler } from './visual-http.ts';
import { validateVisualImages, VisualFailure } from './visual-server.ts';
import { visualFixture, visualAnswer } from './visual-fixtures.ts';

const origin = 'chrome-extension://synthetic-extension';
const oldOrigins = process.env.VOICE_ALLOWED_ORIGINS;
afterEach(() => {
  mock.restoreAll();
  mock.timers.reset();
  if (oldOrigins === undefined) delete process.env.VOICE_ALLOWED_ORIGINS;
  else process.env.VOICE_ALLOWED_ORIGINS = oldOrigins;
});
function request(input: unknown, init: RequestInit = {}) {
  process.env.VOICE_ALLOWED_ORIGINS = origin;
  return new Request('https://backend.example/api/visual-read', {
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
const responseFor = (input: VisualRequest): VisualResponse => ({
  ...visualAnswer,
  source_kind: 'visual_page',
  request_id: input.request_id,
  snapshot_id: input.snapshot.snapshot_id,
  fingerprint: input.snapshot.fingerprint,
  scope: input.snapshot.scope,
  coverage: input.snapshot.coverage,
});
function setup() {
  const calls = { auth: 0, prepare: 0, decode: 0, reserve: 0, provider: 0 };
  const dependencies: Parameters<typeof createVisualHandler>[0] = {
    verifyVoiceUser: async () => {
      calls.auth++;
      return { userId: 'user', subject: 'subject', workspaceId: 'workspace' };
    },
    prepareVisualInput: () => {
      calls.prepare++;
    },
    validateVisualImages: async (input, signal) => {
      calls.decode++;
      await validateVisualImages(input, signal);
    },
    reserveVoiceRequest: async () => {
      calls.reserve++;
    },
    answerVisualPage: async (input) => {
      calls.provider++;
      return responseFor(input);
    },
  };
  return {
    calls,
    dependencies,
    run: (req: Request) => createVisualHandler(dependencies)(req),
  };
}
async function error(response: Response, expected: string) {
  const parsed = voiceErrorResponseSchema.parse(await response.json());
  assert.equal(parsed.error.code, expected);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return parsed;
}

test('visual route authenticates, validates pixels, reserves once and returns bound no-store evidence', async () => {
  const input = await visualFixture();
  const { run, calls } = setup();
  const response = await run(request(input));
  assert.equal(response.status, 200);
  assert.deepEqual(
    visualResponseSchema.parse(await response.json()),
    responseFor(input),
  );
  assert.equal(response.headers.get('access-control-allow-origin'), origin);
  assert.equal(response.headers.get('x-request-id'), input.request_id);
  assert.deepEqual(calls, {
    auth: 1,
    prepare: 1,
    decode: 1,
    reserve: 1,
    provider: 1,
  });
});
for (const failure of [
  'UNAUTHENTICATED',
  'AUTH_UNAVAILABLE',
  'FORBIDDEN',
] as const)
  test(`${failure} never decodes images or invokes provider`, async () => {
    const { run, dependencies, calls } = setup();
    dependencies.verifyVoiceUser = async () => {
      throw new VoiceError(
        failure,
        'Authentication unavailable.',
        failure === 'UNAUTHENTICATED' ? 401 : 403,
      );
    };
    await error(await run(request({ invalid: true })), failure);
    assert.equal(calls.decode, 0);
    assert.equal(calls.reserve, 0);
    assert.equal(calls.provider, 0);
  });
test('missing and mismatched request metadata are rejected before provider', async () => {
  const fixture = await visualFixture();
  for (const input of [
    { ...fixture, consent: false },
    { ...fixture, question: '' },
    { ...fixture, question: 'x'.repeat(1001) },
    { ...fixture, images: [] },
    {
      ...fixture,
      images: [...fixture.images, { ...fixture.images[0], id: 'image-4' }],
    },
  ]) {
    const { run, calls } = setup();
    await error(await run(request(input)), 'INVALID_INPUT');
    assert.equal(calls.provider, 0);
    assert.equal(calls.reserve, 0);
  }
});
test('body-byte limit is enforced with or without declared length before JSON parsing', async () => {
  const { run, calls } = setup();
  await error(
    await run(
      request(
        {},
        {
          headers: {
            origin,
            authorization: 'Bearer synthetic',
            'content-type': 'application/json',
            'content-length': String(VISUAL_LIMITS.bodyBytes + 1),
          },
        },
      ),
    ),
    'INPUT_TOO_LARGE',
  );
  await error(
    await run(request('x'.repeat(VISUAL_LIMITS.bodyBytes))),
    'INPUT_TOO_LARGE',
  );
  assert.equal(calls.prepare, 0);
  assert.equal(calls.provider, 0);
});
test('wrong content type and untrusted CORS origins cannot dispatch provider', async () => {
  const input = await visualFixture();
  const { run, calls } = setup();
  await error(
    await run(
      request(input, {
        headers: {
          origin,
          authorization: 'Bearer synthetic',
          'content-type': 'text/plain',
        },
      }),
    ),
    'INVALID_INPUT',
  );
  await error(
    await run(
      request(input, {
        headers: {
          origin: 'https://untrusted.example',
          authorization: 'Bearer synthetic',
          'content-type': 'application/json',
        },
      }),
    ),
    'FORBIDDEN',
  );
  assert.equal(calls.provider, 0);
});
test('old snapshots and changed metadata fingerprints fail before usage reservation', async () => {
  const input = await visualFixture();
  const { run, calls } = setup();
  input.snapshot.title = 'Changed';
  await error(await run(request(input)), 'INVALID_INPUT');
  const date = new Date(Date.now() - 31_000).toISOString();
  input.snapshot.captured_at = date;
  input.snapshot.capture_started_at = date;
  input.snapshot.images[0]!.captured_at = date;
  input.snapshot.fingerprint = await fingerprintVisualSnapshot(input.snapshot);
  await error(await run(request(input)), 'INVALID_INPUT');
  assert.equal(calls.reserve, 0);
  assert.equal(calls.provider, 0);
});
test('decoder failure rejects corrupt bytes before reservation or provider', async () => {
  const input = await visualFixture();
  input.images[0]!.base64 = Buffer.from('not raster').toString('base64');
  const { run, calls } = setup();
  await error(await run(request(input)), 'INVALID_INPUT');
  assert.equal(calls.reserve, 0);
  assert.equal(calls.provider, 0);
});
test('missing setup, application limits and duplicate reservation never call provider', async () => {
  const input = await visualFixture();
  const { run, dependencies, calls } = setup();
  dependencies.prepareVisualInput = () => {
    throw new VoiceError('SETUP_REQUIRED', 'Set up visual reading.', 503);
  };
  await error(await run(request(input)), 'SETUP_REQUIRED');
  assert.equal(calls.decode, 0);
  assert.equal(calls.reserve, 0);
  assert.equal(calls.provider, 0);
  dependencies.prepareVisualInput = () => undefined;
  dependencies.reserveVoiceRequest = async () => {
    throw new VoiceError('DUPLICATE_REQUEST', 'Already submitted.', 409);
  };
  await error(await run(request(input)), 'DUPLICATE_REQUEST');
  assert.equal(calls.provider, 0);
});
test('concurrent repeated task IDs pass through the existing atomic reservation boundary', async () => {
  const input = await visualFixture();
  const { run, dependencies, calls } = setup();
  const used = new Set<string>();
  dependencies.reserveVoiceRequest = async (_identity, id) => {
    if (used.has(id))
      throw new VoiceError('DUPLICATE_REQUEST', 'Already submitted.', 409);
    used.add(id);
  };
  const results = await Promise.all([run(request(input)), run(request(input))]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  assert.equal(calls.provider, 1);
});
test('unrelated evidence and forged response coverage fail defence-in-depth', async () => {
  const input = await visualFixture();
  const { run, dependencies } = setup();
  dependencies.answerVisualPage = async () => ({
    ...responseFor(input),
    evidence: [{ ...visualAnswer.evidence[0]!, image_id: 'image-4' }],
  });
  await error(await run(request(input)), 'PROVIDER_FAILURE');
  dependencies.answerVisualPage = async () => ({
    ...responseFor(input),
    coverage: { ...input.snapshot.coverage, geometric_complete: true },
  });
  await error(await run(request(input)), 'PROVIDER_FAILURE');
});
test('cancel during pending authentication prevents late decode, usage and provider work', async () => {
  const input = await visualFixture();
  const { run, dependencies, calls } = setup();
  let release!: () => void;
  dependencies.verifyVoiceUser = () =>
    new Promise((resolve) => {
      release = () => resolve({ userId: 'u', subject: 's', workspaceId: 'w' });
    });
  const abort = new AbortController();
  const pending = run(request(input, { signal: abort.signal }));
  abort.abort();
  await error(await pending, 'CANCELLED');
  release();
  await Promise.resolve();
  assert.equal(calls.decode, 0);
  assert.equal(calls.reserve, 0);
  assert.equal(calls.provider, 0);
});
test('25-second overall deadline stops a slow authentication stage without dispatching late AI', async () => {
  const input = await visualFixture();
  const { run, dependencies, calls } = setup();
  let release!: () => void;
  dependencies.verifyVoiceUser = () =>
    new Promise((resolve) => {
      release = () => resolve({ userId: 'u', subject: 's', workspaceId: 'w' });
    });
  mock.timers.enable({ apis: ['setTimeout'] });
  const pending = run(request(input));
  mock.timers.tick(25_001);
  await error(await pending, 'TIMEOUT');
  release();
  await Promise.resolve();
  assert.equal(calls.provider, 0);
  assert.equal(calls.reserve, 0);
});
test('late provider answer after cancellation cannot return success', async () => {
  const input = await visualFixture();
  const { run, dependencies } = setup();
  const abort = new AbortController();
  dependencies.answerVisualPage = async () => {
    abort.abort();
    return responseFor(input);
  };
  await error(await run(request(input, { signal: abort.signal })), 'CANCELLED');
});

test('502 diagnostics log only bounded operational metadata and preserve the existing public error contract', async () => {
  const input = await visualFixture();
  input.question = 'PRIVATE QUESTION, TOKEN, SOURCE CONTENT';
  const { run, dependencies, calls } = setup();
  const logs: Record<string, unknown>[] = [];
  mock.method(console, 'warn', (line: string) => {
    logs.push(JSON.parse(line) as Record<string, unknown>);
  });
  dependencies.answerVisualPage = async (_input, _signal, diagnostics) => {
    calls.provider++;
    assert.ok(diagnostics);
    diagnostics.provider_attempted = true;
    diagnostics.provider_stage = 'answer_validation';
    diagnostics.upstream_status = 200;
    diagnostics.upstream_request_id = 'req_1234567890abcdef';
    throw new VisualFailure('redaction_overlap');
  };
  const response = await run(request(input));
  await error(response, 'PROVIDER_FAILURE');
  assert.equal(response.status, 502);
  assert.equal(response.headers.get('x-request-id'), input.request_id);
  assert.equal(calls.provider, 1);
  assert.deepEqual(Object.keys(logs[0]!).sort(), [
    'code',
    'duration_ms',
    'event',
    'image_bytes',
    'image_count',
    'image_dimensions',
    'provider_attempted',
    'provider_stage',
    'reason',
    'request_id',
    'stage',
    'status',
    'upstream_request_id',
    'upstream_status',
  ]);
  assert.equal(logs[0]!.stage, 'answer_validation');
  assert.equal(logs[0]!.provider_attempted, true);
  assert.equal(logs[0]!.upstream_status, 200);
  assert.equal(logs[0]!.upstream_request_id, 'req_1234567890abcdef');
  assert.equal(logs[0]!.image_count, 1);
  assert.deepEqual(logs[0]!.image_dimensions, [[160, 160]]);
  assert.equal(
    logs[0]!.image_bytes,
    Buffer.from(input.images[0]!.base64, 'base64').length,
  );
  assert.equal(logs[0]!.reason, 'redaction_overlap');
  assert.equal(logs[0]!.request_id, input.request_id);
  assert.equal(logs[0]!.status, 502);
  assert.equal(typeof logs[0]!.duration_ms, 'number');
  dependencies.answerVisualPage = async () => {
    throw new Error('PRIVATE QUESTION, TOKEN, SOURCE CONTENT');
  };
  await error(await run(request(input)), 'PROVIDER_FAILURE');
  assert.equal(logs[1]!.reason, 'operation_failed');
  assert.ok(!JSON.stringify(logs).includes(input.question));
  assert.ok(!JSON.stringify(logs).includes(input.images[0]!.base64));
  assert.ok(!JSON.stringify(logs).includes(input.snapshot.origin));
});

test('pre-provider setup failure logs the request reference without claiming a dispatch', async () => {
  const input = await visualFixture();
  const { run, dependencies, calls } = setup();
  const logs: Record<string, unknown>[] = [];
  mock.method(console, 'warn', (line: string) => {
    logs.push(JSON.parse(line) as Record<string, unknown>);
  });
  dependencies.prepareVisualInput = () => {
    throw new VoiceError('SETUP_REQUIRED', 'Visual setup is required.', 503);
  };
  const response = await run(request(input));
  const body = await error(response, 'SETUP_REQUIRED');
  assert.equal(logs[0]!.request_id, body.request_id);
  assert.equal(logs[0]!.stage, 'input_budget');
  assert.equal(logs[0]!.provider_attempted, false);
  assert.equal(logs[0]!.upstream_status, undefined);
  assert.equal(calls.provider, 0);
  assert.equal(calls.reserve, 0);
  assert.equal('provider_attempted' in body, false);
});
