import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import {
  VISUAL_LIMITS,
  desktopRequestSchema,
  desktopResponseSchema,
  fingerprintDesktopSnapshot,
  voiceErrorResponseSchema,
  type DesktopRequest,
  type DesktopResponse,
} from '@adc/contracts';
import { VoiceError } from '../voice/errors.ts';
import { createDesktopHandler } from './desktop-http.ts';
import { validateDesktopImages } from './desktop-server.ts';
import { desktopFixture, desktopModelAnswer } from './desktop-fixtures.ts';

afterEach(() => {
  mock.restoreAll();
  mock.timers.reset();
});
function request(input: unknown, init: RequestInit = {}) {
  return new Request('https://backend.example/api/desktop-read', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer synthetic-unusable',
    },
    body: JSON.stringify(input),
    ...init,
  });
}
const responseFor = (input: DesktopRequest): DesktopResponse => ({
  ...desktopModelAnswer,
  source_kind: 'desktop_window',
  request_id: input.request_id,
  snapshot_id: input.snapshot.snapshot_id,
  source_id: input.snapshot.source_id,
  captured_at: input.snapshot.captured_at,
  fingerprint: input.snapshot.fingerprint,
});
function setup() {
  const calls: string[] = [];
  const dependencies: Parameters<typeof createDesktopHandler>[0] = {
    async verifyVoiceUser() {
      calls.push('auth');
      return { userId: 'user', subject: 'subject', workspaceId: 'workspace' };
    },
    prepareDesktopInput() {
      calls.push('prepare');
    },
    async validateDesktopImages(input, signal) {
      calls.push('decode');
      await validateDesktopImages(input, signal);
    },
    async reserveVoiceRequest() {
      calls.push('reserve');
    },
    async answerDesktopWindow(input) {
      calls.push('provider');
      return responseFor(input);
    },
  };
  return {
    calls,
    dependencies,
    run: (req: Request) => createDesktopHandler(dependencies)(req),
  };
}
async function error(response: Response, expected: string) {
  const parsed = voiceErrorResponseSchema.parse(await response.json());
  assert.equal(parsed.error.code, expected);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return parsed;
}

test('native bearer desktop request validates real pixels before reservation and binds one answer', async () => {
  const input = await desktopFixture();
  const { run, calls } = setup();
  const response = await run(request(input));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.equal(response.headers.get('x-request-id'), input.request_id);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(
    desktopResponseSchema.parse(await response.json()),
    responseFor(input),
  );
  assert.deepEqual(calls, ['auth', 'prepare', 'decode', 'reserve', 'provider']);
});

test('desktop schema forbids browser identity, additional images and masking claims', async () => {
  const input = await desktopFixture();
  for (const value of [
    { ...input, consent: false },
    { ...input, question: ' ' },
    { ...input, question: '😀'.repeat(1001) },
    { ...input, images: [...input.images, input.images[0]] },
    { ...input, images: [{ ...input.images[0], id: 'image-2' }] },
    {
      ...input,
      snapshot: { ...input.snapshot, origin: 'https://fake.example' },
    },
    { ...input, snapshot: { ...input.snapshot, source_id: 'window:123:0' } },
    {
      ...input,
      snapshot: { ...input.snapshot, limitations: ['current_view_only'] },
    },
    {
      ...input,
      snapshot: {
        ...input.snapshot,
        images: [
          {
            ...input.snapshot.images[0],
            redactions: [{ x: 0, y: 0, width: 1, height: 1 }],
          },
        ],
      },
    },
    {
      ...input,
      snapshot: {
        ...input.snapshot,
        images: [
          {
            ...input.snapshot.images[0],
            captured_at: new Date(0).toISOString(),
          },
        ],
      },
    },
    {
      ...input,
      snapshot: {
        ...input.snapshot,
        images: [{ ...input.snapshot.images[0], width: 2000, height: 2000 }],
      },
    },
  ]) {
    assert.equal(desktopRequestSchema.safeParse(value).success, false);
    const f = setup();
    await error(await f.run(request(value)), 'INVALID_INPUT');
    assert.deepEqual(f.calls, ['auth']);
  }
});

test('desktop fingerprint canonicalizes order and detects every source identity change', async () => {
  const input = await desktopFixture();
  const reversed = Object.fromEntries(Object.entries(input.snapshot).reverse());
  assert.equal(
    await fingerprintDesktopSnapshot(
      desktopRequestSchema.parse({ ...input, snapshot: reversed }).snapshot,
    ),
    input.snapshot.fingerprint,
  );
  for (const patch of [
    { title: 'Other window' },
    { source_id: crypto.randomUUID() },
    { snapshot_id: crypto.randomUUID() },
  ]) {
    const f = setup();
    await error(
      await f.run(
        request({ ...input, snapshot: { ...input.snapshot, ...patch } }),
      ),
      'INVALID_INPUT',
    );
    assert.deepEqual(f.calls, ['auth']);
  }
});

test('old and future desktop snapshots fail before reservation', async () => {
  for (const offset of [-31_000, 6_000]) {
    const input = await desktopFixture();
    input.snapshot.captured_at = new Date(Date.now() + offset).toISOString();
    input.snapshot.images[0].captured_at = input.snapshot.captured_at;
    input.snapshot.fingerprint = await fingerprintDesktopSnapshot(
      input.snapshot,
    );
    const f = setup();
    await error(await f.run(request(input)), 'INVALID_INPUT');
    assert.deepEqual(f.calls, ['auth']);
  }
});

test('unauthenticated or disallowed callers cannot decode pixels or reserve usage', async () => {
  for (const headers of [
    { 'content-type': 'application/json' },
    {
      'content-type': 'application/json',
      authorization: 'Bearer synthetic',
      origin: 'https://untrusted.example',
    },
  ]) {
    const f = setup();
    await error(await f.run(request({}, { headers })), 'FORBIDDEN');
    assert.deepEqual(f.calls, []);
  }
  for (const code of [
    'UNAUTHENTICATED',
    'FORBIDDEN',
    'AUTH_UNAVAILABLE',
  ] as const) {
    const f = setup();
    f.dependencies.verifyVoiceUser = async () => {
      throw new VoiceError(code, 'Cannot authorize this account.', 403);
    };
    await error(await f.run(request({})), code);
    assert.deepEqual(f.calls, []);
  }
});

test('desktop body and request identifier bounds precede decoding and reservation', async () => {
  const input = await desktopFixture();
  const f = setup();
  await error(
    await f.run(
      request(input, {
        headers: {
          authorization: 'Bearer synthetic',
          'content-type': 'text/plain',
        },
      }),
    ),
    'INVALID_INPUT',
  );
  await error(
    await f.run(
      request(input, {
        headers: {
          authorization: 'Bearer synthetic',
          'content-type': 'application/json',
          'x-request-id': crypto.randomUUID(),
        },
      }),
    ),
    'INVALID_INPUT',
  );
  await error(
    await f.run(
      request(
        {},
        {
          headers: {
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
    await f.run(request('x'.repeat(VISUAL_LIMITS.bodyBytes))),
    'INPUT_TOO_LARGE',
  );
  assert.ok(f.calls.every((call) => call === 'auth'));
});

test('corrupt desktop images cannot reserve usage and configuration fails closed', async () => {
  const input = await desktopFixture();
  input.images[0].base64 = Buffer.from('not an image').toString('base64');
  const f = setup();
  await error(await f.run(request(input)), 'INVALID_INPUT');
  assert.deepEqual(f.calls, ['auth', 'prepare', 'decode']);
  f.calls.length = 0;
  f.dependencies.prepareDesktopInput = () => {
    throw new VoiceError('SETUP_REQUIRED', 'Route is not verified.', 503);
  };
  mock.method(console, 'warn', () => {});
  await error(await f.run(request(input)), 'SETUP_REQUIRED');
  assert.deepEqual(f.calls, ['auth']);
});

test('duplicate usage reservations stop desktop provider work', async () => {
  const f = setup();
  f.dependencies.reserveVoiceRequest = async () => {
    throw new VoiceError('DUPLICATE_REQUEST', 'Already submitted.', 409);
  };
  await error(
    await f.run(request(await desktopFixture())),
    'DUPLICATE_REQUEST',
  );
  assert.deepEqual(f.calls, ['auth', 'prepare', 'decode']);
});

test('forged desktop answer identities or unsupported evidence are rejected', async () => {
  const input = await desktopFixture();
  mock.method(console, 'warn', () => {});
  for (const patch of [
    { source_id: crypto.randomUUID() },
    { snapshot_id: crypto.randomUUID() },
    { request_id: crypto.randomUUID() },
    { fingerprint: 'f'.repeat(64) },
    { captured_at: new Date(0).toISOString() },
    {
      evidence: [
        { ...desktopModelAnswer.evidence[0]!, image_id: 'image-2' as const },
      ],
    },
    {
      evidence: [
        {
          ...desktopModelAnswer.evidence[0]!,
          region: { x: 0.8, y: 0, width: 0.5, height: 1 },
        },
      ],
    },
  ]) {
    const f = setup();
    f.dependencies.answerDesktopWindow = async () => ({
      ...responseFor(input),
      ...patch,
    });
    await error(await f.run(request(input)), 'PROVIDER_FAILURE');
  }
});

test('cancelled authentication cannot dispatch late desktop work', async () => {
  const input = await desktopFixture();
  const f = setup();
  const controller = new AbortController();
  let finish!: () => void;
  let started!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  f.dependencies.verifyVoiceUser = async () => {
    started();
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return { userId: 'user', subject: 'subject', workspaceId: 'workspace' };
  };
  const pending = f.run(request(input, { signal: controller.signal }));
  await entered;
  controller.abort();
  await error(await pending, 'CANCELLED');
  finish();
  await Promise.resolve();
  assert.deepEqual(f.calls, []);
});

test('late provider success after Stop cannot return or log captured content', async () => {
  const input = await desktopFixture();
  input.question = 'sensitive-question-fixture';
  input.snapshot.title = 'sensitive-title-fixture';
  input.snapshot.fingerprint = await fingerprintDesktopSnapshot(input.snapshot);
  const f = setup();
  const controller = new AbortController();
  let finish!: (value: DesktopResponse) => void;
  let started!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  f.dependencies.answerDesktopWindow = async () => {
    started();
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  const logs: unknown[] = [];
  mock.method(console, 'warn', (...values: unknown[]) => logs.push(...values));
  const pending = f.run(request(input, { signal: controller.signal }));
  await entered;
  controller.abort();
  await error(await pending, 'CANCELLED');
  finish(responseFor(input));
  await Promise.resolve();
  assert.deepEqual(logs, []);
});

test('desktop overall deadline stops slow auth and rejects its late result', async () => {
  const input = await desktopFixture();
  const f = setup();
  let finish!: () => void;
  let started!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  f.dependencies.verifyVoiceUser = async () => {
    started();
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return { userId: 'user', subject: 'subject', workspaceId: 'workspace' };
  };
  mock.method(console, 'warn', () => {});
  mock.timers.enable({ apis: ['setTimeout'] });
  const pending = f.run(request(input));
  await entered;
  mock.timers.tick(VISUAL_LIMITS.backendTimeoutMs);
  const response = await pending;
  assert.equal(response.status, 504);
  await error(response, 'TIMEOUT');
  finish();
  await Promise.resolve();
  assert.deepEqual(f.calls, []);
});

test('cancelling a pending reservation cannot start a paid desktop request', async () => {
  const input = await desktopFixture();
  const f = setup();
  const controller = new AbortController();
  let finish!: () => void;
  let started!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  f.dependencies.reserveVoiceRequest = async () => {
    started();
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
  };
  const pending = f.run(request(input, { signal: controller.signal }));
  await entered;
  controller.abort();
  await error(await pending, 'CANCELLED');
  finish();
  await Promise.resolve();
  assert.deepEqual(f.calls, ['auth', 'prepare', 'decode']);
});

test('desktop failure diagnostics contain operational metadata but no source, pixels or prose', async () => {
  const input = await desktopFixture();
  const f = setup();
  const logs: unknown[] = [];
  mock.method(console, 'warn', (...values: unknown[]) => logs.push(...values));
  f.dependencies.answerDesktopWindow = async (_input, _signal, diagnostics) => {
    if (diagnostics) diagnostics.provider_attempted = true;
    throw new Error('private-provider-body');
  };
  await error(await f.run(request(input)), 'PROVIDER_FAILURE');
  assert.equal(logs.length, 1);
  const text = JSON.stringify(logs);
  for (const secret of [
    input.question,
    input.snapshot.title,
    input.snapshot.source_id,
    input.images[0].base64,
    'private-provider-body',
  ])
    assert.ok(!text.includes(secret));
  assert.match(text, /desktop_request_failed/);
  assert.match(text, /provider_attempted/);
});
