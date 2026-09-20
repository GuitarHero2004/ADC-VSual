import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import type { User } from '@supabase/supabase-js';
import { authAccessResponseSchema } from '@adc/contracts';
import { VoiceError } from '../voice/errors.ts';
import { authConfiguration, createAuthAccessHandler } from './access.ts';

const originalOrigins = process.env.VOICE_ALLOWED_ORIGINS;
const originalGoogle = process.env.GOOGLE_AUTH_ENABLED;
const extensionOrigin = `chrome-extension://${'a'.repeat(32)}`;
const user = {
  id: '10000000-0000-4000-8000-000000000001',
  email: 'test@example.test',
} as User;
let authCalls: number;
let workspaceCalls: number;
let authError: VoiceError | undefined;
let workspaceError: VoiceError | undefined;
const handler = createAuthAccessHandler({
  verifyAuthUser: async () => {
    authCalls += 1;
    if (authError) throw authError;
    return user;
  },
  verifyVoiceIdentity: async (_request, verified) => {
    workspaceCalls += 1;
    assert.equal(verified, user);
    if (workspaceError) throw workspaceError;
    return {
      subject: verified.id,
      userId: verified.id,
      workspaceId: '20000000-0000-4000-8000-000000000002',
    };
  },
});

beforeEach(() => {
  process.env.VOICE_ALLOWED_ORIGINS = extensionOrigin;
  delete process.env.GOOGLE_AUTH_ENABLED;
  authCalls = 0;
  workspaceCalls = 0;
  authError = undefined;
  workspaceError = undefined;
});

afterEach(() => {
  if (originalOrigins === undefined) delete process.env.VOICE_ALLOWED_ORIGINS;
  else process.env.VOICE_ALLOWED_ORIGINS = originalOrigins;
  if (originalGoogle === undefined) delete process.env.GOOGLE_AUTH_ENABLED;
  else process.env.GOOGLE_AUTH_ENABLED = originalGoogle;
});

function request(headers: Record<string, string> = {}) {
  return new Request('https://app.example.test/api/auth/access', {
    headers: {
      Origin: extensionOrigin,
      Authorization: 'Bearer synthetic-session',
      ...headers,
    },
  });
}

test('access returns the verified account separately from workspace access with one identity check', async () => {
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(
    response.headers.get('Access-Control-Allow-Origin'),
    extensionOrigin,
  );
  const result = authAccessResponseSchema.parse(await response.json());
  assert.deepEqual(result.account, { id: user.id, email: user.email });
  assert.equal(result.workspace, 'allowed');
  assert.equal(authCalls, 1);
  assert.equal(workspaceCalls, 1);
});

test('signed-in account without membership remains authenticated and reports access denied', async () => {
  workspaceError = new VoiceError('FORBIDDEN', 'No membership.', 403);
  const response = await handler(request());
  assert.equal(response.status, 200);
  const result = authAccessResponseSchema.parse(await response.json());
  assert.equal(result.account.id, user.id);
  assert.equal(result.workspace, 'denied');
});

test('unavailable database setup does not misrepresent the verified account as signed out', async () => {
  workspaceError = new VoiceError('SETUP_REQUIRED', 'Setup unavailable.', 503);
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.equal(
    authAccessResponseSchema.parse(await response.json()).workspace,
    'unavailable',
  );
});

for (const [code, status, retryable] of [
  ['UNAUTHENTICATED', 401, false],
  ['AUTH_UNAVAILABLE', 503, true],
] as const) {
  test(`${code} preserves its recovery meaning and never reaches workspace or provider work`, async () => {
    authError = new VoiceError(code, 'A safe error.', status, retryable);
    const response = await handler(request());
    assert.equal(response.status, status);
    assert.deepEqual((await response.json()).error, {
      code,
      message: 'A safe error.',
      retryable,
    });
    assert.equal(workspaceCalls, 0);
  });
}

test('unexpected origin is rejected before Auth or workspace calls', async () => {
  const response = await handler(
    request({ Origin: 'https://untrusted.example.test' }),
  );
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal(authCalls, 0);
  assert.equal(workspaceCalls, 0);
});

test('same-origin cookie GET is accepted using browser fetch metadata', async () => {
  const response = await handler(
    new Request('https://app.example.test/api/auth/access', {
      headers: {
        Cookie: 'synthetic-cookie=opaque',
        'Sec-Fetch-Site': 'same-origin',
      },
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get('Access-Control-Allow-Origin'),
    'https://app.example.test',
  );
  assert.equal(
    response.headers.get('Access-Control-Allow-Credentials'),
    'true',
  );
});

test('missing origin and missing browser metadata cannot read cookie account state', async () => {
  const response = await handler(
    new Request('https://app.example.test/api/auth/access', {
      headers: { Cookie: 'synthetic-cookie=opaque' },
    }),
  );
  assert.equal(response.status, 403);
  assert.equal(authCalls, 0);
});

test('cancellation prevents further work and does not return a signed-in result', async () => {
  const controller = new AbortController();
  controller.abort();
  const response = await handler(
    new Request(request(), { signal: controller.signal }),
  );
  assert.equal(response.status, 499);
  assert.equal(authCalls, 0);
});

test('Google capability is off by default and can be declared without provider calls', async () => {
  const incoming = new Request('https://app.example.test/api/auth/config');
  const disabled = authConfiguration(incoming);
  assert.equal(disabled.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await disabled.json(), { google: false });
  process.env.GOOGLE_AUTH_ENABLED = 'true';
  assert.deepEqual(await authConfiguration(incoming).json(), { google: true });
  assert.equal(authCalls, 0);
  assert.equal(workspaceCalls, 0);
});

test('capabilities are shared only with configured cross-origin extension recipients', async () => {
  assert.equal(
    authConfiguration(request()).headers.get('Access-Control-Allow-Origin'),
    extensionOrigin,
  );
  const rejected = authConfiguration(
    request({ Origin: 'https://untrusted.example.test' }),
  );
  assert.equal(rejected.status, 403);
  assert.equal(rejected.headers.get('Access-Control-Allow-Origin'), null);
});
