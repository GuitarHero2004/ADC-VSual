import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createClient, type Session } from '@supabase/supabase-js';
import {
  DesktopAuth,
  DesktopAuthError,
  type DesktopAuthDependencies,
} from './auth.ts';
import type {
  DesktopConfiguration,
  DesktopConfigurationResult,
} from './config.ts';
import type { DesktopSessionState } from './session-types.ts';

const configuration: DesktopConfiguration = {
  apiBaseUrl: 'https://api.example.test',
  supabaseUrl: 'https://auth.example.test',
  publishableKey: 'sb_publishable_test_only',
  workspaceId: '11111111-1111-4111-8111-111111111111',
};
const config = (): DesktopConfigurationResult => ({
  ok: true,
  value: configuration,
});
const signal = () => new AbortController().signal;
const isCode = (code: string) => (error: unknown) =>
  error instanceof DesktopAuthError &&
  error.code === code &&
  error.message === code;

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function session(): Session {
  return {
    access_token: crypto.randomUUID(),
    refresh_token: crypto.randomUUID(),
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: crypto.randomUUID(),
      email: 'reader@example.test',
      aud: 'authenticated',
      created_at: new Date().toISOString(),
      app_metadata: {},
      user_metadata: {},
    },
  };
}

function providerFailure(code: string, status: number) {
  return Response.json(
    { error_code: code, msg: 'Private provider detail' },
    { status },
  );
}

function fixture(options: Partial<DesktopAuthDependencies> = {}) {
  const current = session();
  const calls: { url: URL; init: RequestInit | undefined }[] = [];
  const publications: DesktopSessionState[] = [];
  let invalidations = 0;
  let override:
    | ((
        url: URL,
        init: RequestInit | undefined,
      ) => Promise<Response | undefined>)
    | undefined;
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    assert.equal(init?.redirect, 'error');
    assert.ok(init?.signal);
    const custom = await override?.(url, init);
    if (custom) return custom;
    if (url.pathname === '/auth/v1/token') return Response.json(current);
    if (url.pathname === '/auth/v1/user') return Response.json(current.user);
    if (url.pathname === '/api/auth/access')
      return Response.json({
        request_id: crypto.randomUUID(),
        account: { id: current.user.id, email: current.user.email },
        workspace: 'allowed',
      });
    if (url.pathname === '/auth/v1/logout')
      return new Response(null, { status: 204 });
    throw new Error('Unexpected mocked request');
  };
  const auth = new DesktopAuth(config, () => invalidations++, {
    fetch: fetcher,
    ...options,
  });
  auth.subscribe((state) => publications.push(state));
  return {
    auth,
    current,
    calls,
    publications,
    invalidations: () => invalidations,
    override(value: typeof override) {
      override = value;
    },
    login: () => auth.signIn('reader@example.test', crypto.randomUUID()),
  };
}

test('password sign-in checks verified account and workspace while exposing status only', async () => {
  const sdkOptions: unknown[] = [];
  const factory = new Proxy(createClient, {
    apply(target, receiver, args) {
      sdkOptions.push(args[2]);
      return Reflect.apply(target, receiver, args);
    },
  });
  const f = fixture({ createClient: factory });
  const state = await f.login();
  assert.equal(state.phase, 'signed_in');
  assert.equal(state.workspace, 'allowed');
  assert.deepEqual(state.account, {
    id: f.current.user.id,
    email: f.current.user.email,
  });
  for (const options of sdkOptions) {
    const auth = (options as { auth: Record<string, unknown> }).auth;
    assert.equal(auth.persistSession, false);
    assert.equal(auth.autoRefreshToken, false);
    assert.equal(auth.detectSessionInUrl, false);
  }
  const access = f.calls.find(({ url }) => url.pathname === '/api/auth/access');
  assert.ok(access);
  assert.equal(
    new Headers(access.init?.headers).get('X-Workspace-ID'),
    configuration.workspaceId,
  );
  assert.equal(new Headers(access.init?.headers).get('Origin'), null);
  assert.equal(
    JSON.stringify(f.publications).includes(f.current.access_token),
    false,
  );
  assert.equal(
    JSON.stringify(f.publications).includes(f.current.refresh_token),
    false,
  );
  const authorized = await f.auth.authorized(signal());
  assert.equal(authorized.userId, f.current.user.id);
  assert.equal(authorized.epoch, state.epoch);
  assert.equal(
    authorized.headers.Authorization,
    `Bearer ${f.current.access_token}`,
  );
  f.auth.dispose();
});

test('configuration and password validation fail safely before any network request', async () => {
  let calls = 0;
  const auth = new DesktopAuth(
    () => ({ ok: false, errorCode: 'SETUP_REQUIRED' }),
    undefined,
    {
      fetch: async () => {
        calls++;
        throw new Error('Never called');
      },
    },
  );
  assert.equal(
    (await auth.signIn('reader@example.test', crypto.randomUUID())).errorCode,
    'SETUP_REQUIRED',
  );
  assert.equal(
    (await auth.signIn('invalid', '')).errorCode,
    'INVALID_CREDENTIALS',
  );
  assert.equal(calls, 0);
  auth.dispose();
});

test('invalid credentials, email confirmation and rate limiting produce stable safe errors', async () => {
  for (const [code, status, expected] of [
    ['invalid_credentials', 400, 'INVALID_CREDENTIALS'],
    ['email_not_confirmed', 400, 'EMAIL_UNCONFIRMED'],
    ['over_request_rate_limit', 429, 'RATE_LIMITED'],
  ] as const) {
    const f = fixture();
    f.override(async () => providerFailure(code, status));
    const state = await f.login();
    assert.equal(state.errorCode, expected);
    assert.equal(state.phase, 'signed_out');
    assert.equal(JSON.stringify(state).includes('Private'), false);
    f.auth.dispose();
  }
});

test('concurrent protected requests share one refresh and verification', async () => {
  let now = Date.now();
  const f = fixture({ now: () => now });
  await f.login();
  now += 3_550_000;
  const refreshed = {
    ...f.current,
    access_token: crypto.randomUUID(),
    refresh_token: crypto.randomUUID(),
    expires_at: Math.floor(now / 1000) + 3600,
  };
  const pending = deferred<Response>();
  const started = deferred<void>();
  f.override(async (url, init) => {
    if (url.searchParams.get('grant_type') !== 'refresh_token') return;
    assert.equal(
      JSON.parse(String(init?.body)).refresh_token,
      f.current.refresh_token,
    );
    started.resolve();
    return pending.promise;
  });
  const first = f.auth.authorized(signal());
  await started.promise;
  const second = f.auth.authorized(signal());
  pending.resolve(Response.json(refreshed));
  const result = await Promise.all([first, second]);
  assert.equal(
    f.calls.filter(
      ({ url }) => url.searchParams.get('grant_type') === 'refresh_token',
    ).length,
    1,
  );
  assert.equal(
    f.calls.filter(({ url }) => url.pathname === '/api/auth/access').length,
    2,
  );
  assert.equal(
    result[0]?.headers.Authorization,
    `Bearer ${refreshed.access_token}`,
  );
  assert.deepEqual(result[0], result[1]);
  f.auth.dispose();
});

test('network unavailable retains rotated credentials and requires explicit retry', async () => {
  let now = Date.now();
  const f = fixture({ now: () => now });
  await f.login();
  now += 3_550_000;
  const refreshed = {
    ...f.current,
    access_token: crypto.randomUUID(),
    refresh_token: crypto.randomUUID(),
    expires_at: Math.floor(now / 1000) + 3600,
  };
  f.override(async (url) => {
    if (url.searchParams.get('grant_type') === 'refresh_token')
      return Response.json(refreshed);
    if (url.pathname === '/auth/v1/user')
      throw new Error('Private connection details');
  });
  await assert.rejects(f.auth.authorized(signal()), isCode('UNAVAILABLE'));
  assert.equal(f.auth.snapshot().phase, 'unavailable');
  assert.equal(f.auth.snapshot().account?.id, f.current.user.id);
  const count = f.calls.length;
  await assert.rejects(f.auth.authorized(signal()), isCode('UNAVAILABLE'));
  assert.equal(f.calls.length, count);
  f.override(undefined);
  assert.equal((await f.auth.retry()).phase, 'signed_in');
  const headers = (await f.auth.authorized(signal())).headers;
  assert.equal(headers.Authorization, `Bearer ${refreshed.access_token}`);
  assert.equal(
    f.calls.filter(
      ({ url }) => url.searchParams.get('grant_type') === 'refresh_token',
    ).length,
    1,
  );
  f.auth.dispose();
});

test('revoked sessions clear credentials, rotate epoch and invalidate protected work', async () => {
  const f = fixture();
  const before = await f.login();
  const invalidations = f.invalidations();
  f.override(async (url) =>
    url.pathname === '/auth/v1/user'
      ? providerFailure('session_not_found', 401)
      : undefined,
  );
  const result = await f.auth.retry();
  assert.equal(result.phase, 'signed_out');
  assert.equal(result.account, null);
  assert.equal(result.errorCode, 'SESSION_EXPIRED');
  assert.notEqual(result.epoch, before.epoch);
  assert.ok(f.invalidations() > invalidations);
  await assert.rejects(f.auth.authorized(signal()), isCode('SESSION_EXPIRED'));
  f.auth.dispose();
});

test('hosting or unrecognized access 401 responses preserve the session for explicit retry', async () => {
  for (const response of [
    () =>
      new Response('<html>Deployment authentication required</html>', {
        status: 401,
        headers: { 'Content-Type': 'text/html' },
      }),
    () =>
      Response.json({ error: { code: 'UNAUTHENTICATED' } }, { status: 401 }),
  ]) {
    const f = fixture();
    const before = await f.login();
    f.override(async (url) =>
      url.pathname === '/api/auth/access' ? response() : undefined,
    );
    const unavailable = await f.auth.retry();
    assert.equal(unavailable.phase, 'unavailable');
    assert.equal(unavailable.errorCode, 'UNAVAILABLE');
    assert.deepEqual(unavailable.account, before.account);
    assert.equal(unavailable.epoch, before.epoch);
    await assert.rejects(f.auth.authorized(signal()), isCode('UNAVAILABLE'));
    f.override(undefined);
    assert.equal((await f.auth.retry()).phase, 'signed_in');
    assert.equal(
      (await f.auth.authorized(signal())).headers.Authorization,
      `Bearer ${f.current.access_token}`,
    );
    f.auth.dispose();
  }
});

test('a contract-valid backend authentication rejection clears the session', async () => {
  const f = fixture();
  const before = await f.login();
  f.override(async (url) =>
    url.pathname === '/api/auth/access'
      ? Response.json(
          {
            request_id: crypto.randomUUID(),
            error: {
              code: 'UNAUTHENTICATED',
              message: 'Sign in again.',
              retryable: false,
            },
          },
          { status: 401 },
        )
      : undefined,
  );
  const result = await f.auth.retry();
  assert.equal(result.phase, 'signed_out');
  assert.equal(result.account, null);
  assert.equal(result.errorCode, 'SESSION_EXPIRED');
  assert.notEqual(result.epoch, before.epoch);
  await assert.rejects(f.auth.authorized(signal()), isCode('SESSION_EXPIRED'));
  f.auth.dispose();
});

test('workspace denial blocks protected requests without logging out the verified account', async () => {
  const f = fixture();
  f.override(async (url) =>
    url.pathname === '/api/auth/access'
      ? Response.json({
          request_id: crypto.randomUUID(),
          account: { id: f.current.user.id, email: f.current.user.email },
          workspace: 'denied',
        })
      : undefined,
  );
  const state = await f.login();
  assert.equal(state.phase, 'signed_in');
  assert.equal(state.workspace, 'denied');
  await assert.rejects(f.auth.authorized(signal()), isCode('FORBIDDEN'));
  f.auth.dispose();
});

test('an access-response account mismatch clears the session', async () => {
  const f = fixture();
  f.override(async (url) =>
    url.pathname === '/api/auth/access'
      ? Response.json({
          request_id: crypto.randomUUID(),
          account: { id: crypto.randomUUID(), email: 'other@example.test' },
          workspace: 'allowed',
        })
      : undefined,
  );
  assert.equal((await f.login()).errorCode, 'SESSION_EXPIRED');
  assert.equal(f.auth.snapshot().account, null);
  f.auth.dispose();
});

test('sign-out clears locally immediately and uses only a bounded local-scope logout', async () => {
  const f = fixture({ timeoutMs: 25 });
  await f.login();
  const remote = deferred<Response>();
  const started = deferred<void>();
  f.override(async (url) => {
    if (url.pathname !== '/auth/v1/logout') return;
    assert.equal(url.searchParams.get('scope'), 'local');
    started.resolve();
    return remote.promise;
  });
  const pending = f.auth.signOut();
  assert.equal(f.auth.snapshot().phase, 'signed_out');
  assert.equal(f.auth.snapshot().account, null);
  await started.promise;
  await assert.rejects(f.auth.authorized(signal()), isCode('UNAUTHENTICATED'));
  const keepAlive = setTimeout(() => undefined, 100);
  assert.equal((await pending).logoutConfirmed, false);
  clearTimeout(keepAlive);
  remote.resolve(new Response(null, { status: 204 }));
  assert.equal(f.auth.snapshot().logoutConfirmed, false);
  f.auth.dispose();
});

test('logout during login cannot restore a late successful session', async () => {
  const f = fixture();
  const remote = deferred<Response>();
  const started = deferred<void>();
  f.override(async (url) => {
    if (url.pathname !== '/auth/v1/token') return;
    started.resolve();
    return remote.promise;
  });
  const pending = f.login();
  await started.promise;
  const signedOut = await f.auth.signOut();
  assert.equal(signedOut.logoutConfirmed, false);
  remote.resolve(Response.json(f.current));
  await pending;
  assert.deepEqual(f.auth.snapshot(), signedOut);
  assert.equal(
    f.calls.some(({ url }) => url.pathname === '/api/auth/access'),
    false,
  );
  f.auth.dispose();
});

test('logout during refresh cannot restore a late rotated session', async () => {
  let now = Date.now();
  const f = fixture({ now: () => now });
  await f.login();
  now += 3_550_000;
  const remote = deferred<Response>();
  const started = deferred<void>();
  f.override(async (url) => {
    if (url.searchParams.get('grant_type') !== 'refresh_token') return;
    started.resolve();
    return remote.promise;
  });
  const checking = f.auth.retry();
  await started.promise;
  const signedOut = await f.auth.signOut();
  remote.resolve(
    Response.json({ ...f.current, access_token: crypto.randomUUID() }),
  );
  await checking;
  assert.deepEqual(f.auth.snapshot(), signedOut);
  f.auth.dispose();
});

test('cancelling one caller does not cancel another caller sharing verification', async () => {
  const f = fixture();
  await f.login();
  const remote = deferred<Response>();
  const started = deferred<void>();
  f.override(async (url) => {
    if (url.pathname !== '/auth/v1/user') return;
    started.resolve();
    return remote.promise;
  });
  const cancel = new AbortController();
  const first = f.auth.authorized(cancel.signal);
  await started.promise;
  const second = f.auth.authorized(signal());
  cancel.abort();
  await assert.rejects(first, isCode('CANCELLED'));
  remote.resolve(Response.json(f.current.user));
  assert.equal((await second).userId, f.current.user.id);
  f.auth.dispose();
});

test('disposal cancels pending login, suppresses publications and clears memory state', async () => {
  const f = fixture();
  const remote = deferred<Response>();
  const started = deferred<void>();
  f.override(async () => {
    started.resolve();
    return remote.promise;
  });
  const pending = f.login();
  await started.promise;
  f.auth.dispose();
  const publications = f.publications.length;
  remote.resolve(Response.json(f.current));
  await pending;
  assert.equal(f.auth.snapshot().phase, 'signed_out');
  assert.equal(f.publications.length, publications);
  await assert.rejects(f.login(), isCode('CANCELLED'));
});

test('subscriber and snapshot mutations cannot change authenticated identity', async () => {
  const f = fixture();
  const unsubscribe = f.auth.subscribe((state) => {
    if (state.account) state.account.id = 'changed';
  });
  const state = await f.login();
  assert.ok(state.account);
  state.account.id = 'changed';
  assert.equal(f.auth.snapshot().account?.id, f.current.user.id);
  unsubscribe();
  f.auth.dispose();
});
