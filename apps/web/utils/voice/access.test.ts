import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import { Pool, type PoolClient } from 'pg';
import {
  reserveVoiceRequest,
  verifyAuthUser,
  verifyVoiceIdentity,
  verifyVoiceUser,
  type VoiceIdentity,
} from './access.ts';
import { VoiceError } from './errors.ts';
import type { UsageWindow } from './limits.ts';

const identity: VoiceIdentity = {
  subject: '10000000-0000-4000-8000-000000000001',
  userId: '20000000-0000-4000-8000-000000000002',
  workspaceId: '30000000-0000-4000-8000-000000000003',
};
const requestId = '40000000-0000-4000-8000-000000000004';
const variables = [
  'DATABASE_URL',
  'VA_VOICE_WORKSPACE_ID',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'VOICE_REQUESTS_PER_MINUTE',
  'VOICE_REQUESTS_PER_DAY',
  'NODE_ENV',
] as const;
const originalVariables = Object.fromEntries(
  variables.map((name) => [name, process.env[name]]),
);
let queries: { text: string; values: unknown[] | undefined }[];
let networkRequests: Request[];
let safeRole: boolean;
let activeMembership: boolean;
let usage: UsageWindow & { duplicate: boolean };
const checkedAt = new Date('2026-09-21T12:00:00.000Z');
const environment: Record<string, string | undefined> = process.env;
let authStatus: number;
let adminMapping: unknown;
let userMapping: unknown;
let connectCount: number;
let releaseCount: number;
let failDatabase: boolean;

beforeEach(() => {
  process.env.DATABASE_URL =
    'postgresql://voice_test:unused@127.0.0.1:1/never_connected';
  process.env.VA_VOICE_WORKSPACE_ID = identity.workspaceId;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.example.test';
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY =
    'sb_publishable_synthetic_test_key';
  environment.NODE_ENV = 'test';
  delete process.env.VOICE_REQUESTS_PER_MINUTE;
  delete process.env.VOICE_REQUESTS_PER_DAY;
  queries = [];
  networkRequests = [];
  safeRole = true;
  activeMembership = true;
  usage = {
    duplicate: false,
    minute_count: 0,
    day_count: 0,
    minute_retry_at: null,
    day_retry_at: null,
  };
  authStatus = 200;
  adminMapping = identity.userId;
  userMapping = undefined;
  connectCount = 0;
  releaseCount = 0;
  failDatabase = false;

  // Fail-closed mocks: no database connection or provider request can leave this test.
  mock.method(Pool.prototype, 'connect', async () => {
    connectCount += 1;
    return {
      query: async (text: string, values?: unknown[]) => {
        queries.push({ text, values });
        if (failDatabase) throw new Error('private database detail');
        if (text.includes('FROM pg_roles'))
          return { rows: [{ safe: safeRole }] };
        if (text === 'SELECT clock_timestamp() AS checked_at')
          return { rows: [{ checked_at: checkedAt }] };
        if (text.includes('FROM va.app_users'))
          return { rows: activeMembership ? [{ id: identity.userId }] : [] };
        if (text.includes('AS minute_count')) return { rows: [usage] };
        return { rows: [] };
      },
      release: () => {
        releaseCount += 1;
      },
    } as unknown as PoolClient;
  });
  mock.method(
    globalThis,
    'fetch',
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      networkRequests.push(request);
      assert.equal(new URL(request.url).host, 'supabase.example.test');
      assert.equal(new URL(request.url).pathname, '/auth/v1/user');
      return Response.json(
        authStatus === 200
          ? {
              id: identity.subject,
              app_metadata: { va_user_id: adminMapping },
              user_metadata: { va_user_id: userMapping },
            }
          : { msg: 'synthetic rejected session' },
        { status: authStatus },
      );
    },
  );
});

afterEach(() => {
  mock.restoreAll();
  for (const name of variables) {
    const value = originalVariables[name];
    if (value === undefined) delete process.env[name];
    else environment[name] = value;
  }
});

function authenticatedRequest(headers: Record<string, string> = {}) {
  return new Request('https://app.example.test/api/voice/speak', {
    headers: { Authorization: 'Bearer synthetic-session', ...headers },
  });
}

function code(expected: string) {
  return (error: unknown) => {
    assert.ok(error instanceof VoiceError);
    assert.equal(error.code, expected);
    assert.ok(!error.message.includes('private database detail'));
    return true;
  };
}

test('missing database configuration fails closed after actual Auth verification', async () => {
  delete process.env.DATABASE_URL;
  await assert.rejects(
    verifyVoiceUser(authenticatedRequest()),
    code('SETUP_REQUIRED'),
  );
  assert.equal(networkRequests.length, 1);
  assert.equal(connectCount, 0);
});

test('missing or malformed authentication never connects to Auth or the database', async () => {
  await assert.rejects(
    verifyVoiceUser(new Request('https://app.example.test')),
    code('UNAUTHENTICATED'),
  );
  await assert.rejects(
    verifyVoiceUser(authenticatedRequest({ Authorization: 'not-bearer' })),
    code('UNAUTHENTICATED'),
  );
  assert.equal(networkRequests.length, 0);
  assert.equal(connectCount, 0);
});

test('expired bearer token is rejected by Supabase before database access', async () => {
  authStatus = 401;
  await assert.rejects(
    verifyVoiceUser(authenticatedRequest()),
    code('UNAUTHENTICATED'),
  );
  assert.equal(networkRequests.length, 1);
  assert.equal(connectCount, 0);
});

test('web cookie session is verified with Auth before workspace access', async () => {
  const encodedSession = Buffer.from(
    JSON.stringify({
      access_token: 'synthetic-session',
      refresh_token: 'synthetic-refresh-token',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      expires_in: 3600,
      token_type: 'bearer',
      user: { id: identity.subject },
    }),
  ).toString('base64url');
  const request = new Request('https://app.example.test/api/voice/speak', {
    headers: { Cookie: `sb-supabase-auth-token=base64-${encodedSession}` },
  });
  assert.deepEqual(await verifyVoiceUser(request), identity);
  assert.equal(networkRequests.length, 1);
  assert.equal(
    networkRequests[0]?.headers.get('Authorization'),
    'Bearer synthetic-session',
  );
});

test('cancellation during Auth verification cannot proceed to the database', async () => {
  const controller = new AbortController();
  controller.abort();
  const request = new Request(authenticatedRequest(), {
    signal: controller.signal,
  });
  await assert.rejects(verifyVoiceUser(request), code('CANCELLED'));
  assert.equal(connectCount, 0);
});

test('user-controlled metadata cannot supply the application identity mapping', async () => {
  adminMapping = undefined;
  userMapping = identity.userId;
  await assert.rejects(
    verifyVoiceUser(authenticatedRequest()),
    code('FORBIDDEN'),
  );
  assert.equal(connectCount, 0);
});

test('a verified account without application mapping remains signed in but has no workspace access', async () => {
  adminMapping = undefined;
  const request = authenticatedRequest();
  const user = await verifyAuthUser(request);
  assert.equal(user.id, identity.subject);
  await assert.rejects(verifyVoiceIdentity(request, user), code('FORBIDDEN'));
  assert.equal(networkRequests.length, 1);
  assert.equal(connectCount, 0);
});

for (const status of [429, 500, 503]) {
  test(`Auth ${status} is temporarily unavailable, not a revoked session`, async () => {
    authStatus = status;
    await assert.rejects(
      verifyVoiceUser(authenticatedRequest()),
      (error: unknown) => {
        assert.ok(error instanceof VoiceError);
        assert.equal(error.code, 'AUTH_UNAVAILABLE');
        assert.equal(error.status, 503);
        assert.equal(error.retryable, true);
        return true;
      },
    );
    assert.equal(networkRequests.length, 1);
    assert.equal(connectCount, 0);
  });
}

test('network and timeout failures never report a confirmed expired session', async () => {
  mock.method(console, 'error', () => {});
  mock.method(globalThis, 'fetch', async () => {
    throw new DOMException('synthetic timeout', 'TimeoutError');
  });
  await assert.rejects(
    verifyVoiceUser(authenticatedRequest()),
    code('AUTH_UNAVAILABLE'),
  );
  assert.equal(connectCount, 0);
});

test('verified identity is bound to parameterized transaction-local RLS context and membership', async () => {
  assert.deepEqual(await verifyVoiceUser(authenticatedRequest()), identity);
  const context = queries.find(({ text }) =>
    text.includes("set_config('app.user_id'"),
  );
  assert.deepEqual(context?.values, [identity.userId, identity.workspaceId]);
  const membership = queries.find(({ text }) =>
    text.includes('FROM va.app_users'),
  );
  assert.deepEqual(membership?.values, [
    identity.userId,
    identity.subject,
    identity.workspaceId,
  ]);
  assert.equal(queries.at(-1)?.text, 'COMMIT');
  assert.equal(releaseCount, 1);
});

test('inactive or different workspace membership is denied and rolled back', async () => {
  activeMembership = false;
  await assert.rejects(
    verifyVoiceUser(authenticatedRequest()),
    code('FORBIDDEN'),
  );
  assert.equal(queries.at(-1)?.text, 'ROLLBACK');
  assert.equal(releaseCount, 1);
});

test('untrusted workspace headers are validated before SQL', async () => {
  await assert.rejects(
    verifyVoiceUser(authenticatedRequest({ 'X-Workspace-ID': 'not-a-uuid' })),
    code('INVALID_INPUT'),
  );
  assert.equal(connectCount, 0);
});

test('owner, bypass or incompletely secured database setup is rejected before setting identity', async () => {
  safeRole = false;
  await assert.rejects(
    verifyVoiceUser(authenticatedRequest()),
    code('SETUP_REQUIRED'),
  );
  assert.ok(!queries.some(({ text }) => text.includes('set_config')));
  assert.equal(queries.at(-1)?.text, 'ROLLBACK');
});

test('reservation locks the user before counting and records exactly one bounded attempt', async () => {
  await reserveVoiceRequest(identity, requestId);
  const lock = queries.findIndex(({ text }) =>
    text.includes('pg_advisory_xact_lock'),
  );
  const count = queries.findIndex(({ text }) =>
    text.includes('AS minute_count'),
  );
  const clock = queries.findIndex(
    ({ text }) => text === 'SELECT clock_timestamp() AS checked_at',
  );
  const prune = queries.findIndex(({ text }) => text.startsWith('DELETE'));
  assert.ok(lock > 0 && clock > lock && prune > clock && count > prune);
  assert.deepEqual(queries[lock]?.values, [identity.userId]);
  assert.deepEqual(queries[count]?.values, [
    identity.userId,
    requestId,
    checkedAt,
    6,
    30,
  ]);
  assert.match(
    queries[count]!.text,
    /ORDER BY created_at DESC OFFSET \(\$4::int - 1\)/,
  );
  assert.match(
    queries[count]!.text,
    /ORDER BY created_at DESC OFFSET \(\$5::int - 1\)/,
  );
  assert.deepEqual(
    queries.find(({ text }) => text.startsWith('DELETE'))?.values,
    [identity.userId, checkedAt],
  );
  const inserts = queries.filter(({ text }) => text.startsWith('INSERT'));
  assert.equal(inserts.length, 1);
  assert.deepEqual(inserts[0]?.values, [
    identity.userId,
    identity.workspaceId,
    requestId,
  ]);
  assert.equal(queries.at(-1)?.text, 'COMMIT');
});

for (const counts of [
  { minute_count: 6, day_count: 6 },
  { minute_count: 0, day_count: 30 },
]) {
  test(`rate limit blocks ${counts.minute_count} minute / ${counts.day_count} daily attempts without reserving`, async () => {
    usage = {
      duplicate: false,
      ...counts,
      minute_retry_at: new Date(checkedAt.getTime() + 45_000),
      day_retry_at: new Date(checkedAt.getTime() + 3_600_000),
    };
    await assert.rejects(
      reserveVoiceRequest(identity, requestId),
      code('APP_RATE_LIMITED'),
    );
    assert.ok(!queries.some(({ text }) => text.startsWith('INSERT')));
    assert.equal(queries.at(-1)?.text, 'ROLLBACK');
  });
}

test('a repeated request ID cannot reserve a second billable attempt', async () => {
  usage.duplicate = true;
  await assert.rejects(
    reserveVoiceRequest(identity, requestId),
    code('DUPLICATE_REQUEST'),
  );
  assert.ok(!queries.some(({ text }) => text.startsWith('INSERT')));
});

test('configured limits are bound into the same locked reservation query', async () => {
  process.env.VOICE_REQUESTS_PER_MINUTE = '30';
  process.env.VOICE_REQUESTS_PER_DAY = '1000';
  usage.minute_count = 6;
  usage.day_count = 30;
  await reserveVoiceRequest(identity, requestId);
  assert.deepEqual(
    queries.find(({ text }) => text.includes('AS minute_count'))?.values,
    [identity.userId, requestId, checkedAt, 30, 1000],
  );
  assert.equal(
    queries.filter(({ text }) => text.startsWith('INSERT')).length,
    1,
  );
});

test('invalid server limit configuration fails closed before a database reservation', async () => {
  process.env.VOICE_REQUESTS_PER_DAY = 'unlimited';
  await assert.rejects(
    reserveVoiceRequest(identity, requestId),
    code('SETUP_REQUIRED'),
  );
  assert.equal(connectCount, 0);
});

test('invalid request IDs do not touch the database', async () => {
  await assert.rejects(
    reserveVoiceRequest(identity, 'not-a-uuid'),
    code('INVALID_INPUT'),
  );
  assert.equal(connectCount, 0);
});

test('reservation rechecks membership and fails closed when it has been revoked', async () => {
  activeMembership = false;
  await assert.rejects(
    reserveVoiceRequest(identity, requestId),
    code('FORBIDDEN'),
  );
  assert.ok(!queries.some(({ text }) => text.startsWith('INSERT')));
});

test('database failures release the connection and never expose connection details', async () => {
  failDatabase = true;
  await assert.rejects(
    reserveVoiceRequest(identity, requestId),
    code('SETUP_REQUIRED'),
  );
  assert.equal(releaseCount, 1);
});
