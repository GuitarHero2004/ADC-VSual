import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import {
  AUTH_ATTEMPT_MS,
  type AuthAccessResponse,
  type AuthReply,
} from '@adc/contracts';
import type { Session } from '@supabase/supabase-js';
import { AuthFlowError, type AuthGateway } from './auth.ts';
import {
  ExtensionAuthManager,
  type AuthManagerDependencies,
  type AuthRecord,
  type AuthSender,
} from './auth-manager.ts';

const extensionId = 'a'.repeat(32);
const backend = 'https://vsual.example.test';
const callback = `https://${extensionId}.chromiumapp.org/auth`;
const flowId = 'flow_test_12345678';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function session(email = 'reader@example.test'): Session {
  return {
    access_token: crypto.randomUUID(),
    refresh_token: crypto.randomUUID(),
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: crypto.randomUUID(),
      email,
      aud: 'authenticated',
      created_at: new Date().toISOString(),
      app_metadata: {},
      user_metadata: {},
    },
  };
}

function success(reply: AuthReply) {
  if (!reply.ok) throw new Error(`Expected success, received ${reply.error}`);
  return reply;
}

function rejected(reply: AuthReply, expected: string) {
  assert.equal(reply.ok, false);
  if (reply.ok) throw new Error('Unexpected successful authentication');
  assert.equal(reply.error, expected);
}

function harness() {
  let stored: AuthRecord | null = null;
  let now = Date.now();
  const accountA = session();
  const accountB = session('second@example.test');
  const calls = {
    password: 0,
    refresh: 0,
    verify: 0,
    logout: 0,
    clear: 0,
    startGoogle: 0,
    finishGoogle: 0,
    access: 0,
    open: 0,
    focus: 0,
    launch: 0,
    returned: 0,
  };
  const hooks: Partial<AuthGateway> = {};
  let workspace: AuthAccessResponse['workspace'] = 'allowed';
  let google = true;
  let nextCallback: string | undefined =
    `${callback}?code=${crypto.randomUUID()}`;
  const opened: string[] = [];
  const navigated: number[] = [];
  const discarded: number[] = [];
  const finished: { attemptId: string; code: string; flowId: string }[] = [];
  const cleared: string[] = [];
  let accessHook: AuthManagerDependencies['access'] | undefined;
  let openHook: AuthManagerDependencies['open'] | undefined;
  let googleHook: AuthManagerDependencies['googleEnabled'] | undefined;
  let launchHook: AuthManagerDependencies['launchGoogle'] | undefined;
  const gateway: AuthGateway = {
    async password(email, value) {
      calls.password += 1;
      return hooks.password
        ? hooks.password(email, value)
        : structuredClone(email === accountB.user.email ? accountB : accountA);
    },
    async refresh(current) {
      calls.refresh += 1;
      return hooks.refresh
        ? hooks.refresh(current)
        : {
            ...current,
            access_token: crypto.randomUUID(),
            refresh_token: crypto.randomUUID(),
            expires_at: Math.floor(now / 1000) + 3600,
          };
    },
    async verify(current) {
      calls.verify += 1;
      return hooks.verify ? hooks.verify(current) : current.user;
    },
    async logout(current) {
      calls.logout += 1;
      return hooks.logout ? hooks.logout(current) : true;
    },
    async clearAttempt(id) {
      calls.clear += 1;
      cleared.push(id);
      if (hooks.clearAttempt) await hooks.clearAttempt(id);
    },
    async startGoogle(id, redirect) {
      calls.startGoogle += 1;
      assert.equal(redirect, callback);
      return hooks.startGoogle
        ? hooks.startGoogle(id, redirect)
        : { url: 'https://auth.example.test/auth/v1/authorize', flowId };
    },
    async finishGoogle(id, code, recordedFlow) {
      calls.finishGoogle += 1;
      finished.push({ attemptId: id, code, flowId: recordedFlow });
      return hooks.finishGoogle
        ? hooks.finishGoogle(id, code, recordedFlow)
        : structuredClone(accountA);
    },
  };
  const deps: AuthManagerDependencies = {
    extensionId,
    backend,
    gateway,
    async read() {
      return structuredClone(stored);
    },
    async write(value) {
      stored = structuredClone(value);
    },
    async open(url) {
      calls.open += 1;
      opened.push(url);
      return openHook
        ? openHook(url)
        : {
            tabId: 100 + calls.open,
            windowId: 10,
            returnTabId: 7,
            returnWindowId: 10,
          };
    },
    async focus() {
      calls.focus += 1;
    },
    async navigate(tabId, url) {
      assert.equal(stored?.attempt?.tabId, tabId);
      assert.equal(stored?.attempt?.stage, 'ready');
      assert.ok(opened.includes(url));
      navigated.push(tabId);
    },
    async discard(tabId) {
      discarded.push(tabId);
    },
    async returnToPage() {
      calls.returned += 1;
    },
    async googleEnabled() {
      return googleHook ? googleHook() : google;
    },
    async launchGoogle(url) {
      calls.launch += 1;
      return launchHook ? launchHook(url) : nextCallback;
    },
    googleRedirect: callback,
    async access(token) {
      calls.access += 1;
      if (accessHook) return accessHook(token);
      const user = stored?.session?.user ?? accountA.user;
      return {
        request_id: crypto.randomUUID(),
        account: { id: user.id, email: user.email ?? '' },
        workspace,
      };
    },
    now: () => now,
  };
  let manager = new ExtensionAuthManager(deps);
  return {
    get manager() {
      return manager;
    },
    get stored() {
      return structuredClone(stored);
    },
    set stored(value: AuthRecord | null) {
      stored = structuredClone(value);
    },
    deps,
    hooks,
    calls,
    accountA,
    accountB,
    opened,
    cleared,
    finished,
    navigated,
    discarded,
    setWorkspace(value: AuthAccessResponse['workspace']) {
      workspace = value;
    },
    setGoogle(value: boolean) {
      google = value;
    },
    setCallback(value: string | undefined) {
      nextCallback = value;
    },
    setAccess(value: AuthManagerDependencies['access'] | undefined) {
      accessHook = value;
    },
    setOpen(value: AuthManagerDependencies['open'] | undefined) {
      openHook = value;
    },
    setGoogleCapability(
      value: AuthManagerDependencies['googleEnabled'] | undefined,
    ) {
      googleHook = value;
    },
    setLaunch(value: AuthManagerDependencies['launchGoogle'] | undefined) {
      launchHook = value;
    },
    advance(ms: number) {
      now += ms;
    },
    restart() {
      manager = new ExtensionAuthManager(deps);
      return manager;
    },
  };
}

type Harness = ReturnType<typeof harness>;
async function begin(h: Harness) {
  const started = success(
    await h.manager.panel({ type: 'auth:start', language: 'en' }),
  );
  const attempt = h.stored?.attempt;
  assert.ok(attempt && attempt.tabId !== null);
  const sender: AuthSender = {
    frameId: 0,
    tab: { id: attempt.tabId },
    url: h.opened.at(-1)!,
  };
  const base = { recipient: extensionId, attemptId: attempt.id };
  const hello = success(
    await h.manager.website({ type: 'auth:hello', ...base }, sender),
  );
  assert.ok(hello.secret);
  return { sender, proof: { ...base, secret: hello.secret }, started, hello };
}

async function login(h: Harness, email = h.accountA.user.email!) {
  const attempt = await begin(h);
  const reply = await h.manager.website(
    {
      type: 'auth:password',
      ...attempt.proof,
      email,
      password: crypto.randomUUID(),
    },
    attempt.sender,
  );
  return { ...attempt, reply, connected: success(reply) };
}

beforeEach(() => {
  mock.method(globalThis, 'fetch', async () => {
    throw new Error(
      'Auth manager tests must never make network or provider requests',
    );
  });
});
afterEach(() => mock.restoreAll());

test('email sign-in connects the verified account and only trusted panel headers contain credentials', async () => {
  const h = harness();
  const signed = await login(h);
  assert.equal(signed.connected.status.phase, 'signed_in');
  assert.equal(signed.connected.status.account?.id, h.accountA.user.id);
  assert.equal(signed.connected.status.workspace, 'allowed');
  assert.equal(h.calls.password, 1);
  assert.equal(h.calls.refresh, 0);
  assert.ok(!JSON.stringify(signed.reply).includes(h.accountA.access_token));
  assert.ok(!JSON.stringify(signed.reply).includes(h.accountA.refresh_token));
  assert.ok(!h.opened[0]?.includes(signed.proof.secret));
  const headers = success(
    await h.manager.panel({
      type: 'auth:headers',
      userId: h.accountA.user.id,
      epoch: signed.connected.status.epoch,
    }),
  );
  assert.equal(
    headers.headers?.Authorization,
    `Bearer ${h.accountA.access_token}`,
  );
  const returned = success(
    await h.manager.website(
      { type: 'auth:return', ...signed.proof },
      signed.sender,
    ),
  );
  assert.equal(returned.status.account?.id, h.accountA.user.id);
  assert.equal(h.calls.returned, 1);
});

test('invalid credentials allow retry without creating a second sign-in window', async () => {
  const h = harness();
  const attempt = await begin(h);
  h.hooks.password = async () => {
    throw new AuthFlowError('INVALID_CREDENTIALS');
  };
  rejected(
    await h.manager.website(
      {
        type: 'auth:password',
        ...attempt.proof,
        email: h.accountA.user.email!,
        password: crypto.randomUUID(),
      },
      attempt.sender,
    ),
    'INVALID_CREDENTIALS',
  );
  assert.equal(h.stored?.session, null);
  assert.equal(h.stored?.attempt?.stage, 'ready');
  delete h.hooks.password;
  const retried = success(
    await h.manager.website(
      {
        type: 'auth:password',
        ...attempt.proof,
        email: h.accountA.user.email!,
        password: crypto.randomUUID(),
      },
      attempt.sender,
    ),
  );
  assert.equal(retried.status.phase, 'signed_in');
  assert.equal(h.calls.open, 1);
});

test('repeated Sign in and password submissions share one attempt and one authentication call', async () => {
  const h = harness();
  const replies = await Promise.all([
    h.manager.panel({ type: 'auth:start', language: 'en' }),
    h.manager.panel({ type: 'auth:start', language: 'en' }),
  ]);
  assert.equal(h.calls.open, 1);
  assert.equal(
    success(replies[0]!).status.attempt?.id,
    success(replies[1]!).status.attempt?.id,
  );
  const attempt = await begin(h);
  const entered = deferred<void>();
  const pending = deferred<Session>();
  h.hooks.password = () => {
    entered.resolve();
    return pending.promise;
  };
  const message = {
    type: 'auth:password',
    ...attempt.proof,
    email: h.accountA.user.email!,
    password: crypto.randomUUID(),
  };
  const first = h.manager.website(message, attempt.sender);
  await entered.promise;
  rejected(await h.manager.website(message, attempt.sender), 'INVALID_ATTEMPT');
  pending.resolve(h.accountA);
  assert.equal(success(await first).status.phase, 'signed_in');
  assert.equal(h.calls.password, 1);
});

test('authenticated accounts without workspace membership stay signed in but cannot obtain provider headers', async () => {
  const h = harness();
  h.setWorkspace('denied');
  const result = await login(h);
  assert.equal(result.connected.status.phase, 'signed_in');
  assert.equal(result.connected.status.workspace, 'denied');
  rejected(
    await h.manager.panel({
      type: 'auth:headers',
      userId: h.accountA.user.id,
      epoch: result.connected.status.epoch,
    }),
    'FORBIDDEN',
  );
});

test('temporarily unavailable workspace checks do not claim the account lacks membership', async () => {
  const h = harness();
  h.setWorkspace('unavailable');
  const result = await login(h);
  assert.equal(result.connected.status.phase, 'signed_in');
  assert.equal(result.connected.status.workspace, 'unavailable');
  rejected(
    await h.manager.panel({
      type: 'auth:headers',
      userId: h.accountA.user.id,
      epoch: result.connected.status.epoch,
    }),
    'UNAVAILABLE',
  );
});

test('wrong origin, tab, frame, recipient, secret and malformed messages never authenticate', async () => {
  const h = harness();
  const attempt = await begin(h);
  const valid = {
    type: 'auth:password',
    ...attempt.proof,
    email: h.accountA.user.email!,
    password: crypto.randomUUID(),
  };
  const senders: AuthSender[] = [
    {
      ...attempt.sender,
      url: attempt.sender.url!.replace(backend, 'https://other.example.test'),
    },
    { ...attempt.sender, tab: { id: 999 } },
    { ...attempt.sender, frameId: 1 },
    { ...attempt.sender, id: extensionId },
    {
      ...attempt.sender,
      url: `${attempt.sender.url}&attempt=${attempt.proof.attemptId}`,
    },
    {
      ...attempt.sender,
      url: `${attempt.sender.url}&return=//other.example.test`,
    },
  ];
  for (const sender of senders)
    rejected(await h.manager.website(valid, sender), 'INVALID_ATTEMPT');
  for (const invalid of [
    { ...valid, recipient: 'b'.repeat(32) },
    { ...valid, secret: 'b'.repeat(64) },
    { ...valid, attemptId: crypto.randomUUID() },
    { ...valid, userId: h.accountA.user.id },
    { ...valid, email: 'invalid-email' },
  ])
    rejected(
      await h.manager.website(invalid, attempt.sender),
      'INVALID_ATTEMPT',
    );
  assert.equal(h.calls.password, 0);
});

test('expired and replayed attempts cannot sign in or exchange another code', async () => {
  const h = harness();
  const attempt = await begin(h);
  h.advance(AUTH_ATTEMPT_MS + 1);
  rejected(
    await h.manager.website(
      {
        type: 'auth:password',
        ...attempt.proof,
        email: h.accountA.user.email!,
        password: crypto.randomUUID(),
      },
      attempt.sender,
    ),
    'ATTEMPT_EXPIRED',
  );
  assert.equal(h.calls.password, 0);
  const signed = await login(h);
  rejected(
    await h.manager.website(
      {
        type: 'auth:password',
        ...signed.proof,
        email: h.accountA.user.email!,
        password: crypto.randomUUID(),
      },
      signed.sender,
    ),
    'INVALID_ATTEMPT',
  );
  assert.equal(h.calls.password, 1);
});

test('cancelling pending password authentication ignores its later successful result', async () => {
  const h = harness();
  const attempt = await begin(h);
  const entered = deferred<void>();
  const pending = deferred<Session>();
  h.hooks.password = () => {
    entered.resolve();
    return pending.promise;
  };
  const result = h.manager.website(
    {
      type: 'auth:password',
      ...attempt.proof,
      email: h.accountA.user.email!,
      password: crypto.randomUUID(),
    },
    attempt.sender,
  );
  await entered.promise;
  const cancelled = success(
    await h.manager.panel({
      type: 'auth:cancel',
      epoch: attempt.started.status.epoch,
    }),
  );
  assert.equal(cancelled.status.phase, 'signed_out');
  pending.resolve(h.accountA);
  rejected(await result, 'CANCELLED');
  assert.equal(h.stored?.session, null);
  assert.equal(h.calls.access, 0);
});

test('closing the sign-in tab allows a new attempt and old callbacks cannot complete it', async () => {
  const h = harness();
  const old = await begin(h);
  await h.manager.tabClosed(old.sender.tab!.id!);
  const next = await begin(h);
  assert.notEqual(next.proof.attemptId, old.proof.attemptId);
  rejected(
    await h.manager.website(
      {
        type: 'auth:password',
        ...old.proof,
        email: h.accountA.user.email!,
        password: crypto.randomUUID(),
      },
      old.sender,
    ),
    'INVALID_ATTEMPT',
  );
  assert.equal(h.stored?.attempt?.id, next.proof.attemptId);
  assert.equal(h.calls.password, 0);
});

test('website Cancel during candidate verification clears it before remote revocation and ignores late success', async () => {
  const h = harness();
  const attempt = await begin(h);
  const entered = deferred<void>();
  const verification = deferred<Session['user']>();
  const revoking = deferred<void>();
  const revoked = deferred<boolean>();
  h.hooks.verify = () => {
    entered.resolve();
    return verification.promise;
  };
  h.hooks.logout = () => {
    revoking.resolve();
    return revoked.promise;
  };
  const signingIn = h.manager.website(
    {
      type: 'auth:password',
      ...attempt.proof,
      email: h.accountA.user.email!,
      password: crypto.randomUUID(),
    },
    attempt.sender,
  );
  await entered.promise;
  assert.equal(h.stored?.attempt?.stage, 'complete');
  assert.equal(h.stored?.status.phase, 'unverified');
  const cancelled = h.manager.website(
    { type: 'auth:cancel', ...attempt.proof },
    attempt.sender,
  );
  await revoking.promise;
  assert.equal(h.stored?.session, null);
  assert.equal(h.stored?.attempt, null);
  assert.notEqual(h.stored?.status.epoch, attempt.started.status.epoch);
  verification.resolve(h.accountA.user);
  rejected(await signingIn, 'CANCELLED');
  assert.equal(h.calls.access, 0);
  revoked.resolve(true);
  assert.equal(success(await cancelled).status.phase, 'signed_out');
  assert.equal(h.calls.logout, 1);
  assert.equal(h.calls.returned, 1);
});

test('closing a successfully completed website tab preserves the connected session', async () => {
  const h = harness();
  const signed = await login(h);
  await h.manager.tabClosed(signed.sender.tab!.id!);
  assert.equal(h.stored?.session?.user.id, h.accountA.user.id);
  assert.equal(h.stored?.status.phase, 'signed_in');
  assert.equal(h.calls.logout, 0);
});

test('panel Cancel is bound to its epoch and cancels a candidate during verification', async () => {
  const h = harness();
  const attempt = await begin(h);
  const entered = deferred<void>();
  const verification = deferred<Session['user']>();
  h.hooks.verify = () => {
    entered.resolve();
    return verification.promise;
  };
  const signingIn = h.manager.website(
    {
      type: 'auth:password',
      ...attempt.proof,
      email: h.accountA.user.email!,
      password: crypto.randomUUID(),
    },
    attempt.sender,
  );
  await entered.promise;
  const cancelled = success(
    await h.manager.panel({
      type: 'auth:cancel',
      epoch: attempt.started.status.epoch,
    }),
  );
  assert.equal(cancelled.status.phase, 'signed_out');
  assert.equal(h.stored?.session, null);
  verification.resolve(h.accountA.user);
  rejected(await signingIn, 'CANCELLED');
  delete h.hooks.verify;
  const newer = await login(h, h.accountB.user.email!);
  const staleCancel = success(
    await h.manager.panel({
      type: 'auth:cancel',
      epoch: attempt.started.status.epoch,
    }),
  );
  assert.equal(staleCancel.status.epoch, newer.connected.status.epoch);
  const afterStaleCancel = h.stored as AuthRecord | null;
  assert.equal(afterStaleCancel?.session?.user.id, h.accountB.user.id);
  assert.equal(h.calls.logout, 1);
});

test('cancel while opening discards a late blank tab without navigating it', async () => {
  const h = harness();
  const entered = deferred<void>();
  const opening =
    deferred<Awaited<ReturnType<AuthManagerDependencies['open']>>>();
  h.setOpen(() => {
    entered.resolve();
    return opening.promise;
  });
  const start = h.manager.panel({ type: 'auth:start', language: 'en' });
  await entered.promise;
  await h.manager.cancel();
  opening.resolve({
    tabId: 901,
    windowId: 10,
    returnTabId: 7,
    returnWindowId: 10,
  });
  rejected(await start, 'CANCELLED');
  assert.deepEqual(h.navigated, []);
  assert.deepEqual(h.discarded, [901]);
  assert.equal(h.stored?.session, null);
});

test('late hello capability result cannot expose a cancelled attempt as ready', async () => {
  const h = harness();
  await h.manager.panel({ type: 'auth:start', language: 'en' });
  const record = h.stored!;
  const sender: AuthSender = {
    url: h.opened[0]!,
    frameId: 0,
    tab: { id: record.attempt!.tabId! },
  };
  const entered = deferred<void>();
  const capability = deferred<boolean>();
  h.setGoogleCapability(() => {
    entered.resolve();
    return capability.promise;
  });
  const hello = h.manager.website(
    {
      type: 'auth:hello',
      recipient: extensionId,
      attemptId: record.attempt!.id,
    },
    sender,
  );
  await entered.promise;
  await h.manager.cancel();
  capability.resolve(true);
  assert.equal((await hello).ok, false);
  assert.equal(h.stored?.status.phase, 'signed_out');
});

test('Google unavailable is honest and the same attempt still supports email sign-in', async () => {
  const h = harness();
  h.setGoogle(false);
  const attempt = await begin(h);
  assert.equal(attempt.hello.google, false);
  rejected(
    await h.manager.website(
      { type: 'auth:google', ...attempt.proof },
      attempt.sender,
    ),
    'GOOGLE_UNAVAILABLE',
  );
  assert.equal(h.calls.startGoogle, 0);
  const email = success(
    await h.manager.website(
      {
        type: 'auth:password',
        ...attempt.proof,
        email: h.accountA.user.email!,
        password: crypto.randomUUID(),
      },
      attempt.sender,
    ),
  );
  assert.equal(email.status.phase, 'signed_in');
});

test('Google callback uses the stored original flow ID, exchanges once and connects the verified account', async () => {
  const h = harness();
  const attempt = await begin(h);
  const code = crypto.randomUUID();
  h.setCallback(`${callback}?code=${code}`);
  const connected = success(
    await h.manager.website(
      { type: 'auth:google', ...attempt.proof },
      attempt.sender,
    ),
  );
  assert.equal(connected.status.account?.id, h.accountA.user.id);
  assert.deepEqual(h.finished, [
    { attemptId: attempt.proof.attemptId, code, flowId },
  ]);
  rejected(
    await h.manager.website(
      { type: 'auth:google', ...attempt.proof },
      attempt.sender,
    ),
    'INVALID_ATTEMPT',
  );
  assert.equal(h.calls.finishGoogle, 1);
});

for (const returned of [
  `https://${'b'.repeat(32)}.chromiumapp.org/auth?code=opaque`,
  `${callback}/unexpected?code=opaque`,
  `${callback}?code=one&code=two`,
  `${callback}?code=opaque&return=https://other.example.test`,
  `${callback}#access_token=opaque`,
  `${callback}?code=opaque&sb_flow_id=another-flow`,
]) {
  test(`unexpected Google callback shape is rejected: ${new URL(returned).pathname} ${new URL(returned).searchParams.size} fields`, async () => {
    const h = harness();
    const attempt = await begin(h);
    h.setCallback(returned);
    rejected(
      await h.manager.website(
        { type: 'auth:google', ...attempt.proof },
        attempt.sender,
      ),
      'CALLBACK_MISMATCH',
    );
    assert.equal(h.calls.finishGoogle, 0);
    assert.equal(h.stored?.session, null);
  });
}

test('Google cancellation and provider failure recover without replacing the email fallback', async () => {
  const h = harness();
  const attempt = await begin(h);
  h.setCallback(undefined);
  rejected(
    await h.manager.website(
      { type: 'auth:google', ...attempt.proof },
      attempt.sender,
    ),
    'CANCELLED',
  );
  assert.equal(h.stored?.attempt?.stage, 'ready');
  h.hooks.startGoogle = async () => {
    throw new AuthFlowError('PROVIDER_ERROR');
  };
  rejected(
    await h.manager.website(
      { type: 'auth:google', ...attempt.proof },
      attempt.sender,
    ),
    'PROVIDER_ERROR',
  );
  assert.equal(h.stored?.attempt?.stage, 'ready');
  assert.equal(h.calls.finishGoogle, 0);
});

test('Google callback cancellation and provider failures have distinct recoverable errors', async () => {
  for (const [error, expected] of [
    ['access_denied', 'CANCELLED'],
    ['server_error', 'PROVIDER_ERROR'],
  ] as const) {
    const h = harness();
    const attempt = await begin(h);
    h.setCallback(
      `${callback}?error=${error}&error_description=private-provider-detail`,
    );
    const result = await h.manager.website(
      { type: 'auth:google', ...attempt.proof },
      attempt.sender,
    );
    rejected(result, expected);
    assert.ok(!JSON.stringify(result).includes('private-provider-detail'));
    assert.equal(h.stored?.attempt?.stage, 'ready');
    assert.equal(h.calls.finishGoogle, 0);
  }
});

test('Google cleanup finishes before another retry can write a new verifier', async () => {
  const h = harness();
  const attempt = await begin(h);
  h.setCallback(undefined);
  const entered = deferred<void>();
  const cleanup = deferred<void>();
  h.hooks.clearAttempt = () => {
    entered.resolve();
    return cleanup.promise;
  };
  const message = { type: 'auth:google', ...attempt.proof };
  const cancelled = h.manager.website(message, attempt.sender);
  await entered.promise;
  rejected(await h.manager.website(message, attempt.sender), 'INVALID_ATTEMPT');
  assert.equal(h.calls.startGoogle, 1);
  cleanup.resolve();
  rejected(await cancelled, 'CANCELLED');
  h.setCallback(`${callback}?code=${crypto.randomUUID()}`);
  assert.equal(
    success(await h.manager.website(message, attempt.sender)).status.phase,
    'signed_in',
  );
  assert.equal(h.calls.startGoogle, 2);
});

test('cancelled or expired Google browser callback never reaches code exchange', async () => {
  for (const expire of [false, true]) {
    const h = harness();
    const attempt = await begin(h);
    const entered = deferred<void>();
    const pending = deferred<string | undefined>();
    h.setLaunch(() => {
      entered.resolve();
      return pending.promise;
    });
    const work = h.manager.website(
      { type: 'auth:google', ...attempt.proof },
      attempt.sender,
    );
    await entered.promise;
    if (expire) h.advance(AUTH_ATTEMPT_MS + 1);
    else await h.manager.cancel();
    pending.resolve(`${callback}?code=${crypto.randomUUID()}`);
    const result = await work;
    assert.equal(result.ok, false);
    assert.equal(h.calls.finishGoogle, 0);
    assert.equal(h.stored?.session, null);
  }
});

test('panel reopening and a fresh service worker restore the same browser-session identity', async () => {
  const h = harness();
  const first = await login(h);
  const reopened = success(await h.manager.panel({ type: 'auth:status' }));
  assert.equal(reopened.status.account?.id, h.accountA.user.id);
  const restarted = success(await h.restart().panel({ type: 'auth:status' }));
  assert.equal(restarted.status.epoch, first.connected.status.epoch);
  assert.equal(restarted.status.account?.id, h.accountA.user.id);
  assert.equal(h.calls.password, 1);
  assert.equal(h.calls.refresh, 0);
  h.stored = null;
  const browserRestarted = success(
    await h.restart().panel({ type: 'auth:status' }),
  );
  assert.equal(browserRestarted.status.phase, 'signed_out');
  assert.equal(browserRestarted.status.account, null);
});

test('worker restart cancels an orphaned pending Google attempt and allows a fresh sign-in', async () => {
  const h = harness();
  const first = await begin(h);
  const saved = h.stored!;
  saved.attempt!.stage = 'google';
  saved.attempt!.flowId = flowId;
  h.stored = saved;
  const restored = success(await h.restart().panel({ type: 'auth:status' }));
  assert.equal(restored.status.phase, 'signed_out');
  assert.ok(h.cleared.includes(first.proof.attemptId));
  const next = await begin(h);
  assert.notEqual(next.proof.attemptId, first.proof.attemptId);
});

test('failed restart cleanup is retried instead of caching an orphaned opening attempt', async () => {
  const h = harness();
  await begin(h);
  const saved = h.stored!;
  saved.attempt!.stage = 'opening';
  saved.attempt!.tabId = null;
  h.stored = saved;
  let cleanupAttempts = 0;
  h.hooks.clearAttempt = async () => {
    cleanupAttempts += 1;
    if (cleanupAttempts === 1) throw new AuthFlowError('UNAVAILABLE');
  };
  const restarted = h.restart();
  rejected(await restarted.panel({ type: 'auth:status' }), 'UNAVAILABLE');
  assert.equal(
    success(await restarted.panel({ type: 'auth:status' })).status.phase,
    'signed_out',
  );
  assert.equal(cleanupAttempts, 2);
  const fresh = await begin(h);
  assert.notEqual(fresh.proof.attemptId, saved.attempt!.id);
});

test('simultaneous checks share one token refresh and persist the rotated session', async () => {
  const h = harness();
  await login(h);
  h.advance(3_600_000);
  const entered = deferred<void>();
  const pending = deferred<Session>();
  h.hooks.refresh = () => {
    entered.resolve();
    return pending.promise;
  };
  const first = h.manager.panel({ type: 'auth:status' });
  await entered.promise;
  const second = h.manager.panel({ type: 'auth:status' });
  const rotated = {
    ...h.accountA,
    access_token: crypto.randomUUID(),
    refresh_token: crypto.randomUUID(),
    expires_at: h.accountA.expires_at! + 3600,
  };
  pending.resolve(rotated);
  const results = await Promise.all([first, second]);
  for (const result of results)
    assert.equal(success(result).status.phase, 'signed_in');
  assert.equal(h.calls.refresh, 1);
  assert.equal(h.stored?.session?.refresh_token, rotated.refresh_token);
});

test('offline verification preserves credentials, blocks protected headers and recovers on Retry', async () => {
  const h = harness();
  const signed = await login(h);
  h.hooks.verify = async () => {
    throw new AuthFlowError('UNAVAILABLE');
  };
  const unavailable = success(await h.manager.panel({ type: 'auth:status' }));
  assert.equal(unavailable.status.phase, 'unverified');
  assert.equal(h.stored?.session?.refresh_token, h.accountA.refresh_token);
  rejected(
    await h.manager.panel({
      type: 'auth:headers',
      userId: h.accountA.user.id,
      epoch: signed.connected.status.epoch,
    }),
    'UNAVAILABLE',
  );
  delete h.hooks.verify;
  const recovered = success(await h.manager.panel({ type: 'auth:status' }));
  assert.equal(recovered.status.phase, 'signed_in');
  assert.equal(recovered.status.epoch, signed.connected.status.epoch);
});

test('offline token refresh retains the recoverable session without a retry loop', async () => {
  const h = harness();
  await login(h);
  h.advance(3_600_000);
  h.hooks.refresh = async () => {
    throw new AuthFlowError('UNAVAILABLE');
  };
  const unavailable = success(await h.manager.panel({ type: 'auth:status' }));
  assert.equal(unavailable.status.phase, 'unverified');
  assert.equal(h.calls.refresh, 1);
  assert.equal(h.stored?.session?.refresh_token, h.accountA.refresh_token);
  delete h.hooks.refresh;
  assert.equal(
    success(await h.manager.panel({ type: 'auth:status' })).status.phase,
    'signed_in',
  );
  assert.equal(h.calls.refresh, 2);
});

test('a rotated refresh token survives an offline workspace check', async () => {
  const h = harness();
  await login(h);
  h.advance(3_600_000);
  h.setAccess(async () => {
    throw new AuthFlowError('UNAVAILABLE');
  });
  assert.equal(
    success(await h.manager.panel({ type: 'auth:status' })).status.phase,
    'unverified',
  );
  assert.notEqual(h.stored?.session?.refresh_token, h.accountA.refresh_token);
  const rotated = h.stored?.session?.refresh_token;
  h.setAccess(undefined);
  assert.equal(
    success(await h.manager.panel({ type: 'auth:status' })).status.phase,
    'signed_in',
  );
  assert.equal(h.stored?.session?.refresh_token, rotated);
  assert.equal(h.calls.refresh, 1);
});

test('confirmed revocation clears credentials and blocks protected calls', async () => {
  const h = harness();
  const signed = await login(h);
  h.hooks.verify = async () => {
    throw new AuthFlowError('SESSION_EXPIRED');
  };
  const revoked = success(await h.manager.panel({ type: 'auth:status' }));
  assert.equal(revoked.status.phase, 'signed_out');
  assert.equal(revoked.status.error, 'SESSION_EXPIRED');
  assert.equal(h.stored?.session, null);
  rejected(
    await h.manager.panel({
      type: 'auth:headers',
      userId: h.accountA.user.id,
      epoch: signed.connected.status.epoch,
    }),
    'SESSION_EXPIRED',
  );
});

test('logout during token refresh prevents a late result from restoring credentials', async () => {
  const h = harness();
  await login(h);
  h.advance(3_600_000);
  const entered = deferred<void>();
  const pending = deferred<Session>();
  h.hooks.refresh = () => {
    entered.resolve();
    return pending.promise;
  };
  const refresh = h.manager.panel({ type: 'auth:status' });
  await entered.promise;
  assert.equal(
    success(await h.manager.panel({ type: 'auth:logout' })).status.phase,
    'signed_out',
  );
  pending.resolve({
    ...h.accountA,
    access_token: crypto.randomUUID(),
    refresh_token: crypto.randomUUID(),
  });
  assert.equal((await refresh).ok, false);
  assert.equal(h.stored?.session, null);
  assert.equal(h.stored?.status.phase, 'signed_out');
});

test('logout clears credentials before remote confirmation and reports an offline logout accurately', async () => {
  const h = harness();
  await login(h);
  const entered = deferred<void>();
  const pending = deferred<boolean>();
  h.hooks.logout = () => {
    entered.resolve();
    return pending.promise;
  };
  const logout = h.manager.panel({ type: 'auth:logout' });
  await entered.promise;
  assert.equal(h.stored?.session, null);
  assert.equal(
    success(await h.manager.panel({ type: 'auth:status' })).status.phase,
    'signed_out',
  );
  pending.resolve(false);
  assert.equal(success(await logout).status.logoutConfirmed, false);
});

test('switching accounts requires explicit logout and an old account cannot obtain new headers', async () => {
  const h = harness();
  const first = await login(h);
  rejected(
    await h.manager.panel({ type: 'auth:start', language: 'en' }),
    'ACCOUNT_CHANGE_REQUIRED',
  );
  await h.manager.panel({ type: 'auth:logout' });
  const second = await login(h, h.accountB.user.email!);
  assert.equal(second.connected.status.account?.id, h.accountB.user.id);
  assert.notEqual(second.connected.status.epoch, first.connected.status.epoch);
  rejected(
    await h.manager.panel({
      type: 'auth:headers',
      userId: h.accountA.user.id,
      epoch: first.connected.status.epoch,
    }),
    'SESSION_EXPIRED',
  );
  assert.equal(
    success(
      await h.manager.panel({
        type: 'auth:headers',
        userId: h.accountB.user.id,
        epoch: second.connected.status.epoch,
      }),
    ).headers?.Authorization,
    `Bearer ${h.accountB.access_token}`,
  );
});

test('late validation from account A cannot replace account B or return account A headers', async () => {
  const h = harness();
  const first = await login(h);
  const entered = deferred<void>();
  const pending = deferred<AuthAccessResponse>();
  h.setAccess(() => {
    entered.resolve();
    return pending.promise;
  });
  const oldHeaders = h.manager.panel({
    type: 'auth:headers',
    userId: h.accountA.user.id,
    epoch: first.connected.status.epoch,
  });
  await entered.promise;
  await h.manager.panel({ type: 'auth:logout' });
  h.setAccess(undefined);
  const second = await login(h, h.accountB.user.email!);
  pending.resolve({
    request_id: crypto.randomUUID(),
    account: { id: h.accountA.user.id, email: h.accountA.user.email! },
    workspace: 'allowed',
  });
  assert.equal((await oldHeaders).ok, false);
  assert.equal(h.stored?.status.account?.id, h.accountB.user.id);
  assert.equal(h.stored?.status.epoch, second.connected.status.epoch);
});

test('backend identity mismatch never exposes the mismatched session as signed in', async () => {
  const h = harness();
  h.setAccess(async () => ({
    request_id: crypto.randomUUID(),
    account: { id: h.accountB.user.id, email: h.accountB.user.email! },
    workspace: 'allowed',
  }));
  const attempted = await login(h);
  assert.equal(attempted.connected.status.phase, 'signed_out');
  assert.equal(h.stored?.session, null);
});

const inlineContext = () => ({
  owner: crypto.randomUUID(),
  current: () => true,
});
async function beginInline(h: Harness, context = inlineContext()) {
  const reply = success(
    await h.manager.panel(
      { type: 'auth:start', language: 'en', inline: true },
      context,
    ),
  );
  return { context, epoch: reply.status.epoch };
}

test('inline password connects the verified account without a website tab or returning credentials', async () => {
  const h = harness();
  const { context, epoch } = await beginInline(h);
  const repeated = success(
    await h.manager.panel(
      { type: 'auth:start', language: 'en', inline: true },
      context,
    ),
  );
  assert.equal(repeated.status.epoch, epoch);
  assert.equal(h.calls.open, 0);
  assert.equal(h.calls.password, 0);
  const reply = success(
    await h.manager.panel(
      {
        type: 'auth:inline-password',
        epoch,
        email: h.accountA.user.email!,
        password: crypto.randomUUID(),
      },
      context,
    ),
  );
  assert.equal(reply.status.account?.id, h.accountA.user.id);
  assert.equal(reply.status.workspace, 'allowed');
  assert.equal(h.calls.password, 1);
  assert.equal(h.calls.open, 0);
  assert.ok(!JSON.stringify(reply).includes(h.accountA.access_token));
  await h.manager.cancelInlineOwner(context.owner);
  assert.equal(
    h.stored?.status.phase,
    'signed_in',
    'closing a completed login preserves the session',
  );
});

test('inline requests require the initiating live document, valid credentials and an unexpired attempt', async () => {
  const h = harness();
  const { context, epoch } = await beginInline(h);
  const message = {
    type: 'auth:inline-password',
    epoch,
    email: h.accountA.user.email!,
    password: crypto.randomUUID(),
  };
  rejected(await h.manager.panel(message, inlineContext()), 'INVALID_ATTEMPT');
  rejected(
    await h.manager.panel({ ...message, email: '' }, context),
    'INVALID_ATTEMPT',
  );
  rejected(
    await h.manager.panel(message, { ...context, current: () => false }),
    'INVALID_ATTEMPT',
  );
  assert.equal(h.calls.password, 0);
  h.advance(AUTH_ATTEMPT_MS + 1);
  rejected(await h.manager.panel(message, context), 'ATTEMPT_EXPIRED');
  assert.equal(h.calls.password, 0);
});

test('inline invalid credentials remain retryable and successful replay is rejected', async () => {
  const h = harness();
  const { context, epoch } = await beginInline(h);
  const message = {
    type: 'auth:inline-password',
    epoch,
    email: h.accountA.user.email!,
    password: crypto.randomUUID(),
  };
  h.hooks.password = async () => {
    throw new AuthFlowError('INVALID_CREDENTIALS');
  };
  rejected(await h.manager.panel(message, context), 'INVALID_CREDENTIALS');
  assert.equal(h.stored?.attempt?.stage, 'ready');
  delete h.hooks.password;
  assert.equal(
    success(await h.manager.panel(message, context)).status.phase,
    'signed_in',
  );
  rejected(await h.manager.panel(message, context), 'INVALID_ATTEMPT');
  assert.equal(h.calls.password, 2);
});

test('closing inline login while a password request is pending discards and revokes a late candidate', async () => {
  const h = harness();
  const { context, epoch } = await beginInline(h);
  const entered = deferred<void>();
  const pending = deferred<Session>();
  h.hooks.password = () => {
    entered.resolve();
    return pending.promise;
  };
  const request = h.manager.panel(
    {
      type: 'auth:inline-password',
      epoch,
      email: h.accountA.user.email!,
      password: crypto.randomUUID(),
    },
    context,
  );
  await entered.promise;
  await h.manager.cancelInlineOwner(context.owner);
  pending.resolve(h.accountA);
  rejected(await request, 'CANCELLED');
  assert.equal(h.stored?.session, null);
  assert.equal(h.calls.logout, 1);
});

test('removing inline host during candidate verification cancels it before late verification returns', async () => {
  const h = harness();
  const { context, epoch } = await beginInline(h);
  const entered = deferred<void>();
  const pending = deferred<Session['user']>();
  h.hooks.verify = () => {
    entered.resolve();
    return pending.promise;
  };
  const request = h.manager.panel(
    {
      type: 'auth:inline-password',
      epoch,
      email: h.accountA.user.email!,
      password: crypto.randomUUID(),
    },
    context,
  );
  await entered.promise;
  assert.ok(h.stored?.session);
  await h.manager.cancelInlineOwner(context.owner);
  assert.equal(h.stored?.session, null);
  pending.resolve(h.accountA.user);
  rejected(await request, 'CANCELLED');
  assert.equal(h.stored?.status.phase, 'signed_out');
});

test('inline Google uses existing worker PKCE flow with no website tab and cannot exchange a cancelled callback', async () => {
  const h = harness();
  const { context, epoch } = await beginInline(h);
  const entered = deferred<void>();
  const callbackResult = deferred<string>();
  h.setLaunch(() => {
    entered.resolve();
    return callbackResult.promise;
  });
  const pending = h.manager.panel(
    { type: 'auth:inline-google', epoch },
    context,
  );
  await entered.promise;
  assert.equal(h.calls.startGoogle, 1);
  assert.equal(h.calls.open, 0);
  await h.manager.cancelInlineOwner(context.owner);
  callbackResult.resolve(`${callback}?code=${crypto.randomUUID()}`);
  rejected(await pending, 'CANCELLED');
  assert.equal(h.calls.finishGoogle, 0);
  assert.equal(h.stored?.session, null);
  h.setLaunch(undefined);
  const retry = await beginInline(h, context);
  const reply = success(
    await h.manager.panel(
      { type: 'auth:inline-google', epoch: retry.epoch },
      context,
    ),
  );
  assert.equal(reply.status.account?.id, h.accountA.user.id);
  assert.equal(h.calls.finishGoogle, 1);
  assert.equal(h.calls.open, 0);
});

test('inline Google unavailable keeps email fallback and does not launch a provider window', async () => {
  const h = harness();
  h.setGoogle(false);
  const { context, epoch } = await beginInline(h);
  rejected(
    await h.manager.panel({ type: 'auth:inline-google', epoch }, context),
    'GOOGLE_UNAVAILABLE',
  );
  assert.equal(h.calls.launch, 0);
  assert.equal(h.stored?.attempt?.stage, 'ready');
  const reply = success(
    await h.manager.panel(
      {
        type: 'auth:inline-password',
        epoch,
        email: h.accountA.user.email!,
        password: crypto.randomUUID(),
      },
      context,
    ),
  );
  assert.equal(reply.status.phase, 'signed_in');
});
