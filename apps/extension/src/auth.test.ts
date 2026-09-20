import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import type { Session } from '@supabase/supabase-js';
import { AuthFlowError, createExtensionAuthGateway } from './auth.ts';

const config = {
  supabaseUrl: 'https://auth.example.test',
  publishableKey: 'public-test-project-key',
};
const callback = `https://${'a'.repeat(32)}.chromiumapp.org/auth`;
const originalFetch = globalThis.fetch;
const stored = new Map<string, unknown>();
const storage = {
  async get(key: string) {
    return { [key]: structuredClone(stored.get(key)) };
  },
  async set(values: Record<string, unknown>) {
    for (const [key, value] of Object.entries(values))
      stored.set(key, structuredClone(value));
  },
  async remove(keys: string | string[]) {
    for (const key of typeof keys === 'string' ? [keys] : keys)
      stored.delete(key);
  },
} as Pick<chrome.storage.StorageArea, 'get' | 'set' | 'remove'>;

function session(): Session {
  return {
    access_token: crypto.randomUUID(),
    refresh_token: crypto.randomUUID(),
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: crypto.randomUUID(),
      aud: 'authenticated',
      email: 'reader@example.test',
      created_at: new Date().toISOString(),
      app_metadata: {},
      user_metadata: {},
    },
  };
}
function failure(code: string, status: number) {
  return Response.json(
    { error_code: code, msg: 'Provider details must not leave the gateway.' },
    { status },
  );
}
const isCode = (code: string) => (error: unknown) =>
  error instanceof AuthFlowError &&
  error.code === code &&
  error.message === code;
beforeEach(() => {
  stored.clear();
  globalThis.fetch = async () => {
    throw new Error('Unexpected network request in test');
  };
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('password login and user verification use the real SDK without persisting credentials', async () => {
  const expected = session();
  const password = crypto.randomUUID();
  const requests: string[] = [];
  stored.set('adc:auth:owner', { existing: true });
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push(url.pathname);
    assert.equal(init?.redirect, 'error');
    assert.ok(init?.signal);
    if (url.pathname.endsWith('/token')) {
      assert.equal(url.searchParams.get('grant_type'), 'password');
      assert.deepEqual(JSON.parse(String(init?.body)), {
        email: expected.user.email,
        password,
        gotrue_meta_security: {},
      });
      return Response.json(expected);
    }
    assert.equal(
      new Headers(init?.headers).get('Authorization'),
      `Bearer ${expected.access_token}`,
    );
    return Response.json(expected.user);
  };
  const gateway = createExtensionAuthGateway(config, storage);
  const connected = await gateway.password(expected.user.email!, password);
  assert.equal(connected.user.id, expected.user.id);
  assert.equal((await gateway.verify(connected)).id, expected.user.id);
  assert.deepEqual(requests, ['/auth/v1/token', '/auth/v1/user']);
  assert.deepEqual([...stored], [['adc:auth:owner', { existing: true }]]);
});

test('invalid credentials, unconfirmed email and rate limits expose stable safe codes', async () => {
  const gateway = createExtensionAuthGateway(config, storage);
  for (const [code, status, expected] of [
    ['invalid_credentials', 400, 'INVALID_CREDENTIALS'],
    ['email_not_confirmed', 400, 'EMAIL_UNCONFIRMED'],
    ['over_request_rate_limit', 429, 'RATE_LIMITED'],
  ] as const) {
    globalThis.fetch = async () => failure(code, status);
    await assert.rejects(
      gateway.password('reader@example.test', crypto.randomUUID()),
      isCode(expected),
    );
  }
  assert.equal(stored.size, 0);
});

test('network and server failures remain recoverable without SDK refresh retries', async () => {
  const current = session();
  stored.set('adc:auth:owner', current);
  const gateway = createExtensionAuthGateway(config, storage);
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new TypeError('Offline');
  };
  await assert.rejects(gateway.verify(current), isCode('UNAVAILABLE'));
  await assert.rejects(gateway.refresh(current), isCode('UNAVAILABLE'));
  assert.equal(calls, 2);
  globalThis.fetch = async () => {
    calls++;
    return failure('internal_server_error', 503);
  };
  await assert.rejects(gateway.refresh(current), isCode('UNAVAILABLE'));
  assert.equal(calls, 3);
  assert.deepEqual(stored.get('adc:auth:owner'), current);
});

test('refresh rotates a matching account in memory and revoked tokens return SESSION_EXPIRED', async () => {
  const current = session();
  const rotated = { ...session(), user: current.user };
  stored.set('adc:auth:owner', current);
  const gateway = createExtensionAuthGateway(config, storage);
  globalThis.fetch = async (input, init) => {
    assert.equal(
      new URL(String(input)).searchParams.get('grant_type'),
      'refresh_token',
    );
    assert.deepEqual(JSON.parse(String(init?.body)), {
      refresh_token: current.refresh_token,
    });
    return Response.json(rotated);
  };
  assert.equal(
    (await gateway.refresh(current)).access_token,
    rotated.access_token,
  );
  assert.deepEqual(stored.get('adc:auth:owner'), current);
  globalThis.fetch = async () => failure('refresh_token_not_found', 400);
  await assert.rejects(gateway.refresh(current), isCode('SESSION_EXPIRED'));
  globalThis.fetch = async () => failure('session_not_found', 401);
  await assert.rejects(gateway.verify(current), isCode('SESSION_EXPIRED'));
});

test('verification and refresh reject a mismatched returned account', async () => {
  const current = session();
  const other = session();
  const gateway = createExtensionAuthGateway(config, storage);
  globalThis.fetch = async () => Response.json(other.user);
  await assert.rejects(gateway.verify(current), isCode('SESSION_EXPIRED'));
  globalThis.fetch = async () => Response.json(other);
  await assert.rejects(gateway.refresh(current), isCode('SESSION_EXPIRED'));
});

test('Google PKCE keeps the original verifier across worker restart and consumes it once', async () => {
  const attempt = crypto.randomUUID();
  const expected = {
    ...session(),
    provider_token: crypto.randomUUID(),
    provider_refresh_token: crypto.randomUUID(),
  };
  const first = createExtensionAuthGateway(config, storage);
  const started = await first.startGoogle(attempt, callback);
  const url = new URL(started.url);
  assert.equal(url.origin, config.supabaseUrl);
  assert.equal(url.searchParams.get('provider'), 'google');
  assert.equal(url.searchParams.get('code_challenge_method'), 's256');
  assert.equal(url.searchParams.get('scopes'), 'openid email profile');
  const returnUrl = new URL(url.searchParams.get('redirect_to')!);
  assert.equal(returnUrl.origin + returnUrl.pathname, callback);
  // Keep the configured callback exact. The worker holds the flow ID; the code
  // can only be exchanged with the verifier bound to its original OAuth request.
  assert.equal(returnUrl.search, '');
  const entries = stored.get(`adc:auth:pkce:${attempt}`) as Record<
    string,
    string
  >;
  const verifier = JSON.parse(
    entries[`adc-pkce-${attempt}-flow-${started.flowId}-code-verifier`]!,
  ) as string;
  const challenge = Buffer.from(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
  ).toString('base64url');
  assert.equal(url.searchParams.get('code_challenge'), challenge);
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    calls++;
    assert.equal(new URL(String(input)).searchParams.get('grant_type'), 'pkce');
    const body = JSON.parse(String(init?.body)) as Record<string, string>;
    assert.equal(body.code_verifier, verifier);
    assert.equal(stored.has(`adc:auth:pkce:${attempt}`), false);
    return Response.json(expected);
  };
  const restarted = createExtensionAuthGateway(config, storage);
  const code = crypto.randomUUID();
  const outcomes = await Promise.allSettled([
    restarted.finishGoogle(attempt, code, started.flowId),
    restarted.finishGoogle(attempt, code, started.flowId),
  ]);
  assert.equal(
    outcomes.filter((outcome) => outcome.status === 'fulfilled').length,
    1,
  );
  assert.equal(
    outcomes.filter((outcome) => outcome.status === 'rejected').length,
    1,
  );
  assert.equal(calls, 1);
  const accepted = outcomes.find((outcome) => outcome.status === 'fulfilled');
  assert.ok(accepted?.status === 'fulfilled');
  assert.equal(accepted.value.provider_token, undefined);
  assert.equal(accepted.value.provider_refresh_token, undefined);
  assert.equal(stored.size, 0);
  await assert.rejects(
    restarted.finishGoogle(attempt, code, started.flowId),
    isCode('INVALID_ATTEMPT'),
  );
});

test('a wrong flow ID cannot consume another verifier, and cancellation discards the attempt', async () => {
  const gateway = createExtensionAuthGateway(config, storage);
  const attempt = crypto.randomUUID();
  const started = await gateway.startGoogle(attempt, callback);
  await assert.rejects(
    gateway.finishGoogle(attempt, crypto.randomUUID(), 'another-flow'),
    isCode('INVALID_ATTEMPT'),
  );
  assert.equal(stored.size, 1);
  await gateway.clearAttempt(attempt);
  await assert.rejects(
    gateway.finishGoogle(attempt, crypto.randomUUID(), started.flowId),
    isCode('INVALID_ATTEMPT'),
  );
  assert.equal(stored.size, 0);
});

test('Google validates the callback destination before creating any verifier', async () => {
  const gateway = createExtensionAuthGateway(config, storage);
  for (const url of [
    'not a URL',
    'https://outside.example/auth',
    callback.replace('https:', 'http:'),
    `${callback}?redirect=https://outside.example`,
    `${callback}#token`,
    `${callback}/unexpected`,
  ]) {
    await assert.rejects(
      gateway.startGoogle(crypto.randomUUID(), url),
      isCode('CALLBACK_MISMATCH'),
    );
  }
  assert.equal(stored.size, 0);
});

test('cancellation during a PKCE storage write removes late verifier writes', async () => {
  let release!: () => void;
  let entered!: () => void;
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  const writing = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const delayed = {
    ...storage,
    async set(values: Record<string, unknown>) {
      entered();
      await paused;
      await storage.set(values);
    },
  } as Pick<chrome.storage.StorageArea, 'get' | 'set' | 'remove'>;
  const gateway = createExtensionAuthGateway(config, delayed);
  const attempt = crypto.randomUUID();
  const starting = gateway.startGoogle(attempt, callback);
  await writing;
  const clearing = gateway.clearAttempt(attempt);
  release();
  const started = await starting;
  await clearing;
  assert.equal(stored.size, 0);
  await assert.rejects(
    gateway.finishGoogle(attempt, crypto.randomUUID(), started.flowId),
    isCode('INVALID_ATTEMPT'),
  );
});

test('expired request deadlines do not start another authentication network request', async (context) => {
  context.mock.method(AbortSignal, 'timeout', () => AbortSignal.abort());
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return Response.json(session());
  };
  const gateway = createExtensionAuthGateway(config, storage);
  await assert.rejects(gateway.refresh(session()), isCode('UNAVAILABLE'));
  assert.equal(requests, 0);
});

test('Google exchange failure is safe and cannot replay an already consumed code', async () => {
  const gateway = createExtensionAuthGateway(config, storage);
  const attempt = crypto.randomUUID();
  const started = await gateway.startGoogle(attempt, callback);
  globalThis.fetch = async () => failure('provider_disabled', 400);
  await assert.rejects(
    gateway.finishGoogle(attempt, crypto.randomUUID(), started.flowId),
    isCode('GOOGLE_UNAVAILABLE'),
  );
  assert.equal(stored.size, 0);
});

test('logout revokes only the snapshot session without refreshing and reports offline failure', async () => {
  const current = session();
  const gateway = createExtensionAuthGateway(config, storage);
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    calls++;
    assert.equal(
      String(input),
      `${config.supabaseUrl}/auth/v1/logout?scope=local`,
    );
    assert.equal(init?.method, 'POST');
    assert.equal(
      new Headers(init?.headers).get('Authorization'),
      `Bearer ${current.access_token}`,
    );
    assert.equal(init?.redirect, 'error');
    return new Response(null, { status: 204 });
  };
  assert.equal(await gateway.logout(current), true);
  assert.equal(calls, 1);
  globalThis.fetch = async () => failure('bad_jwt', 401);
  assert.equal(await gateway.logout(current), false);
  globalThis.fetch = async () => {
    throw new TypeError('Offline');
  };
  assert.equal(await gateway.logout(current), false);
});
