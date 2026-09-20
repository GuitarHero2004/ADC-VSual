import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { Pool, type PoolClient } from 'pg';
import type { Session } from '@supabase/supabase-js';
import {
  authAccessResponseSchema,
  authReplySchema,
  fingerprintSnapshot,
  groundedResponseSchema,
  type GroundedRequest,
} from '@adc/contracts';
import { createAuthAccessHandler } from './access.ts';
import { createGroundedHandler } from '../grounded/http.ts';
import {
  reserveVoiceRequest,
  verifyAuthUser,
  verifyVoiceIdentity,
  verifyVoiceUser,
} from '../voice/access.ts';

// Runtime imports deliberately keep Chromium-only types out of the web build.
// These are the actual extension manager and SDK gateway, not replacement models.
const managerModule = new URL(
  '../../../extension/src/auth-manager.ts',
  import.meta.url,
);
const gatewayModule = new URL(
  '../../../extension/src/auth.ts',
  import.meta.url,
);
const { ExtensionAuthManager } = await import(managerModule.href);
const { createExtensionAuthGateway } = await import(gatewayModule.href);

const variables = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'DATABASE_URL',
  'VA_VOICE_WORKSPACE_ID',
  'VOICE_ALLOWED_ORIGINS',
  'GROUNDED_ALLOWED_ORIGINS',
] as const;
const original = Object.fromEntries(
  variables.map((name) => [name, process.env[name]]),
);
afterEach(() => {
  mock.restoreAll();
  for (const name of variables) {
    if (original[name] === undefined) delete process.env[name];
    else process.env[name] = original[name];
  }
});

async function canonicalQuestion(): Promise<GroundedRequest> {
  const input: GroundedRequest = {
    request_id: crypto.randomUUID(),
    question: 'Compare completed orders in the South for August and July.',
    language: 'en',
    consent: true,
    snapshot: {
      snapshot_id: crypto.randomUUID(),
      document_key: crypto.randomUUID(),
      adapter_key: 'orders-fixture@1',
      captured_at: new Date().toISOString(),
      origin: 'https://vsual.example.test',
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

test('extension email connection → grounded evidence → reopened panel → sign-out uses actual auth and request boundaries', async () => {
  const extensionId = 'a'.repeat(32);
  const origin = `chrome-extension://${extensionId}`;
  const backend = 'https://vsual.example.test';
  const project = 'https://auth.example.test';
  const appUser = crypto.randomUUID();
  const workspace = crypto.randomUUID();
  const password = crypto.randomUUID();
  const issued: Session = {
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
      app_metadata: { va_user_id: appUser },
      user_metadata: {},
    },
  };
  process.env.NEXT_PUBLIC_SUPABASE_URL = project;
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY =
    'sb_publishable_synthetic_test_key';
  const database = new URL(
    'postgresql://test_role@127.0.0.1:1/never_connected',
  );
  database.password = crypto.randomUUID();
  process.env.DATABASE_URL = database.href;
  process.env.VA_VOICE_WORKSPACE_ID = workspace;
  process.env.VOICE_ALLOWED_ORIGINS = origin;
  process.env.GROUNDED_ALLOWED_ORIGINS = backend;

  let passwordRequests = 0;
  let providerCalls = 0;
  let activeSession = true;
  let membership = true;
  const reservations = new Set<string>();
  const contexts: unknown[][] = [];
  mock.method(
    globalThis,
    'fetch',
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      assert.equal(
        url.origin,
        project,
        'No AI request or live service is allowed in this test',
      );
      if (url.pathname === '/auth/v1/token') {
        assert.equal(url.searchParams.get('grant_type'), 'password');
        const body = await request.json();
        assert.equal(body.email, issued.user.email);
        assert.equal(body.password, password);
        passwordRequests += 1;
        return Response.json(issued);
      }
      assert.equal(
        request.headers.get('Authorization'),
        `Bearer ${issued.access_token}`,
      );
      if (url.pathname === '/auth/v1/user') {
        return activeSession
          ? Response.json(issued.user)
          : Response.json(
              { error_code: 'session_not_found', msg: 'Session expired.' },
              { status: 401 },
            );
      }
      assert.equal(url.pathname, '/auth/v1/logout');
      assert.equal(url.searchParams.get('scope'), 'local');
      activeSession = false;
      return new Response(null, { status: 204 });
    },
  );
  mock.method(
    Pool.prototype,
    'connect',
    async () =>
      ({
        async query(sql: string, values?: unknown[]) {
          if (sql.includes('FROM pg_roles')) return { rows: [{ safe: true }] };
          if (sql.includes("set_config('app.user_id'")) {
            contexts.push(values ?? []);
            assert.deepEqual(values, [appUser, workspace]);
          }
          if (sql.includes('FROM va.app_users')) {
            assert.deepEqual(values, [appUser, issued.user.id, workspace]);
            return { rows: membership ? [{ id: appUser }] : [] };
          }
          if (sql.includes('AS minute_count'))
            return {
              rows: [
                {
                  duplicate: reservations.has(String(values?.[1])),
                  minute_count: reservations.size,
                  day_count: reservations.size,
                },
              ],
            };
          if (sql.startsWith('INSERT')) {
            assert.equal(values?.[0], appUser);
            assert.equal(values?.[1], workspace);
            reservations.add(String(values?.[2]));
          }
          return { rows: [] };
        },
        release() {},
      }) as unknown as PoolClient,
  );

  const access = createAuthAccessHandler({
    verifyAuthUser,
    verifyVoiceIdentity,
  });
  const grounded = createGroundedHandler({
    verifyVoiceUser,
    reserveVoiceRequest,
    requireGroundedConfiguration() {},
    async interpretComparison(input, signal) {
      signal.throwIfAborted();
      assert.equal(
        input.question,
        'Compare completed orders in the South for August and July.',
      );
      providerCalls += 1;
      return {
        decision: 'comparison',
        operation: 'compare',
        metric: 'completed_orders',
        region: 'South',
        baseline_period: '2026-07',
        comparison_period: '2026-08',
        reason: null,
      };
    },
  });
  const verifierStorage = new Map<string, unknown>();
  const gateway = createExtensionAuthGateway(
    {
      supabaseUrl: project,
      publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    },
    {
      async get(key: string) {
        return { [key]: structuredClone(verifierStorage.get(key)) };
      },
      async set(values: Record<string, unknown>) {
        for (const [key, value] of Object.entries(values))
          verifierStorage.set(key, structuredClone(value));
      },
      async remove(key: string) {
        verifierStorage.delete(key);
      },
    },
  );
  let stored: unknown = null;
  let signInUrl = '';
  const dependencies = {
    extensionId,
    backend,
    gateway,
    async read() {
      return structuredClone(stored);
    },
    async write(value: unknown) {
      stored = structuredClone(value);
    },
    async open(url: string) {
      signInUrl = url;
      return { tabId: 23, windowId: 2, returnTabId: 11, returnWindowId: 2 };
    },
    async navigate() {},
    async discard() {},
    async focus() {},
    async returnToPage() {},
    async googleEnabled() {
      return false;
    },
    async launchGoogle() {
      assert.fail('This regression exercises email sign-in');
    },
    googleRedirect: `https://${extensionId}.chromiumapp.org/auth`,
    async access(token: string) {
      const response = await access(
        new Request(`${backend}/api/auth/access`, {
          headers: { Origin: origin, Authorization: `Bearer ${token}` },
        }),
      );
      assert.equal(response.status, 200);
      return authAccessResponseSchema.parse(await response.json());
    },
  };
  let manager = new ExtensionAuthManager(dependencies);
  const started = authReplySchema.parse(
    await manager.panel({ type: 'auth:start', language: 'en' }),
  );
  assert.ok(started.ok && started.status.attempt);
  const sender = { frameId: 0, url: signInUrl, tab: { id: 23 } };
  const attempt = {
    attemptId: started.status.attempt.id,
    recipient: extensionId,
  };
  const hello = authReplySchema.parse(
    await manager.website({ type: 'auth:hello', ...attempt }, sender),
  );
  assert.ok(hello.ok && hello.secret);
  const signed = authReplySchema.parse(
    await manager.website(
      {
        type: 'auth:password',
        ...attempt,
        secret: hello.secret,
        email: issued.user.email,
        password,
      },
      sender,
    ),
  );
  assert.ok(signed.ok);
  assert.equal(signed.status.account?.id, issued.user.id);
  assert.equal(signed.status.workspace, 'allowed');
  assert.ok(!JSON.stringify(signed).includes(issued.access_token));
  assert.ok(!JSON.stringify(signed).includes(issued.refresh_token));

  async function question(headers: Record<string, string>) {
    const payload = await canonicalQuestion();
    return {
      payload,
      response: await grounded(
        new Request(`${backend}/api/grounded-read`, {
          method: 'POST',
          headers: {
            Origin: origin,
            'Content-Type': 'application/json',
            'X-Request-ID': payload.request_id,
            ...headers,
          },
          body: JSON.stringify(payload),
        }),
      ),
    };
  }
  for (let index = 0; index < 2; index += 1) {
    if (index === 1) manager = new ExtensionAuthManager(dependencies);
    const current = authReplySchema.parse(
      await manager.panel({ type: 'auth:status' }),
    );
    assert.ok(current.ok && current.status.account);
    assert.equal(current.status.account.id, issued.user.id);
    const authorized = authReplySchema.parse(
      await manager.panel({
        type: 'auth:headers',
        userId: current.status.account.id,
        epoch: current.status.epoch,
      }),
    );
    assert.ok(authorized.ok && authorized.headers);
    const { payload, response } = await question(authorized.headers);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const answer = groundedResponseSchema.parse(await response.json());
    assert.equal(answer.status, 'answer');
    if (answer.status !== 'answer')
      assert.fail('Expected canonical comparison');
    assert.deepEqual(answer.evidence.rows, payload.snapshot.rows);
    assert.equal(answer.evidence.calculation.difference, -300);
    assert.equal(answer.evidence.calculation.percentage_change, '-25');
    assert.equal(answer.fingerprint, payload.snapshot.fingerprint);
  }
  assert.equal(
    passwordRequests,
    1,
    'Panel/worker restoration must not sign in again',
  );
  assert.equal(providerCalls, 2);
  assert.equal(reservations.size, 2);
  assert.ok(contexts.length >= 2);

  membership = false;
  const noAccess = authReplySchema.parse(
    await manager.panel({ type: 'auth:status' }),
  );
  assert.ok(noAccess.ok);
  assert.equal(noAccess.status.phase, 'signed_in');
  assert.equal(noAccess.status.workspace, 'denied');
  const denied = await question({
    Authorization: `Bearer ${issued.access_token}`,
  });
  assert.equal(denied.response.status, 403);
  assert.equal(providerCalls, 2);
  membership = true;

  const loggedOut = authReplySchema.parse(
    await manager.panel({ type: 'auth:logout' }),
  );
  assert.ok(loggedOut.ok);
  assert.equal(loggedOut.status.phase, 'signed_out');
  assert.equal(loggedOut.status.logoutConfirmed, true);
  const blocked = authReplySchema.parse(
    await manager.panel({
      type: 'auth:headers',
      userId: issued.user.id,
      epoch: signed.status.epoch,
    }),
  );
  assert.equal(blocked.ok, false);
  const afterLogout = await question({
    Authorization: `Bearer ${issued.access_token}`,
  });
  assert.equal(afterLogout.response.status, 401);
  assert.equal(providerCalls, 2);
  assert.equal(reservations.size, 2);
  assert.ok(!JSON.stringify(stored).includes(issued.access_token));
  assert.ok(!JSON.stringify(stored).includes(issued.refresh_token));
});
