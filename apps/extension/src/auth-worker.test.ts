import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { authReplySchema } from '@adc/contracts';
import {
  AUTH_RECORD_KEY,
  type AuthRecord,
  type AuthSender,
} from './auth-manager.ts';
import { installAuthWorker, trustedAuthPanel } from './auth-worker.ts';

const extensionId = 'a'.repeat(32);
const backend = 'http://127.0.0.1:3000';
const oldChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
const oldFetch = globalThis.fetch;
afterEach(() => {
  if (oldChrome) Object.defineProperty(globalThis, 'chrome', oldChrome);
  else Reflect.deleteProperty(globalThis, 'chrome');
  globalThis.fetch = oldFetch;
});
type Listener = (
  value: unknown,
  sender: AuthSender,
  respond: (reply: unknown) => void,
) => boolean;
function worker(
  configured = true,
  launchError?: string,
  trustedFloating: (sender: chrome.runtime.MessageSender) => boolean = () =>
    false,
) {
  let internal!: Listener;
  let external!: Listener;
  let authUrl = '';
  const writes = new Map<string, unknown>();
  let opened = 0;
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      runtime: {
        id: extensionId,
        onMessage: {
          addListener: (listener: Listener) => {
            internal = listener;
          },
        },
        onMessageExternal: {
          addListener: (listener: Listener) => {
            external = listener;
          },
        },
      },
      identity: {
        getRedirectURL: () => `https://${extensionId}.chromiumapp.org/auth`,
        async launchWebAuthFlow() {
          throw new Error(launchError ?? 'Unexpected auth window');
        },
      },
      storage: {
        session: {
          async get(key: string) {
            return { [key]: structuredClone(writes.get(key)) };
          },
          async set(value: Record<string, unknown>) {
            for (const [key, item] of Object.entries(value))
              writes.set(key, structuredClone(item));
          },
          async remove(key: string) {
            writes.delete(key);
          },
        },
      },
      tabs: {
        onRemoved: { addListener() {} },
        async query() {
          return [{ id: 2, windowId: 1 }];
        },
        async create(value: { url: string }) {
          assert.equal(value.url, 'about:blank');
          opened++;
          return { id: 42, windowId: 1 };
        },
        async update(id: number, value: { url?: string }) {
          if (value.url) {
            const record = writes.get(AUTH_RECORD_KEY) as AuthRecord;
            assert.equal(record.attempt?.tabId, id);
            assert.equal(record.attempt?.stage, 'ready');
            authUrl = value.url;
          }
          return { id, windowId: 1 };
        },
        async remove() {},
      },
      windows: { async update() {} },
    },
  });
  const installed = installAuthWorker(
    configured
      ? {
          backend,
          supabaseUrl: 'https://auth.example.test',
          publishableKey: 'public-test-key',
          ordersOrigins: [backend],
        }
      : null,
    trustedFloating,
  );
  return {
    cancelInlineDocument: installed.cancelInlineDocument,
    writes,
    get opened() {
      return opened;
    },
    get authUrl() {
      return authUrl;
    },
    dispatch(
      value: unknown,
      sender: AuthSender,
      fromWebsite = false,
    ): Promise<unknown> {
      return new Promise((resolve) => {
        if (!(fromWebsite ? external : internal)(value, sender, resolve))
          resolve(undefined);
      });
    },
  };
}
const panel = {
  id: extensionId,
  url: `chrome-extension://${extensionId}/index.html`,
};

test('only exact trusted extension documents can request session headers', () => {
  assert.equal(trustedAuthPanel(panel, extensionId), true);
  assert.equal(
    trustedAuthPanel(
      { ...panel, url: `${panel.url}?microphone-setup=1`, frameId: 0 },
      extensionId,
    ),
    true,
  );
  for (const sender of [
    { ...panel, id: 'b'.repeat(32) },
    { ...panel, url: `${backend}/auth/sign-in` },
    { ...panel, url: `${panel.url}?unexpected=1` },
    { ...panel, url: `${panel.url}#anything` },
    { ...panel, frameId: 2 },
    { id: extensionId },
  ])
    assert.equal(trustedAuthPanel(sender, extensionId), false);
});

test('auth listener ignores unrelated messages and rejects content-script senders', async () => {
  const app = worker(false);
  assert.equal(
    await app.dispatch({ type: 'orders:capture' }, panel),
    undefined,
  );
  assert.equal(
    await app.dispatch(
      { type: 'auth:status' },
      { ...panel, url: `${backend}/orders` },
    ),
    undefined,
  );
  assert.deepEqual(await app.dispatch({ type: 'auth:status' }, panel), {
    ok: false,
    error: 'SETUP_REQUIRED',
  });
  assert.equal(app.opened, 0);
});

test('floating authentication requires a live binding and rechecks it before returning async replies', async () => {
  let bound = true;
  const floating = {
    id: extensionId,
    url: `chrome-extension://${extensionId}/floating.html#${crypto.randomUUID()}`,
    frameId: 3,
    documentId: crypto.randomUUID(),
    tab: { id: 2 },
  };
  const app = worker(
    false,
    undefined,
    (sender) => bound && sender === floating,
  );
  assert.equal(trustedAuthPanel(floating, extensionId), false);
  assert.deepEqual(await app.dispatch({ type: 'auth:status' }, floating), {
    ok: false,
    error: 'SETUP_REQUIRED',
  });
  const pending = app.dispatch({ type: 'auth:status' }, floating);
  bound = false;
  assert.deepEqual(await pending, { ok: false, error: 'UNAVAILABLE' });
  assert.equal(
    await app.dispatch({ type: 'auth:status' }, floating),
    undefined,
  );
  assert.deepEqual(await app.dispatch({ type: 'auth:status' }, panel), {
    ok: false,
    error: 'SETUP_REQUIRED',
  });
});

test('worker stores owned tab before navigation and only that exact website may handshake', async () => {
  const app = worker();
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), `${backend}/api/auth/config`);
    assert.equal(init?.credentials, 'omit');
    assert.equal(init?.redirect, 'error');
    return Response.json({ google: false });
  };
  const starting = authReplySchema.parse(
    await app.dispatch({ type: 'auth:start', language: 'en' }, panel),
  );
  assert.equal(starting.ok, true);
  assert.equal(app.opened, 1);
  const attemptId = new URL(app.authUrl).searchParams.get('attempt');
  const message = { type: 'auth:hello', attemptId, recipient: extensionId };
  const website = { url: app.authUrl, frameId: 0, tab: { id: 42 } };
  const connected = authReplySchema.parse(
    await app.dispatch(message, website, true),
  );
  assert.ok(connected.ok && connected.secret && !connected.headers);
  const wrong = await app.dispatch(
    message,
    { ...website, tab: { id: 99 } },
    true,
  );
  assert.deepEqual(wrong, { ok: false, error: 'INVALID_ATTEMPT' });
  assert.deepEqual(
    await app.dispatch(message, { ...website, id: extensionId }, true),
    { ok: false, error: 'INVALID_ATTEMPT' },
  );
});

test('Vercel protection HTML is temporarily unavailable rather than a revoked session', async () => {
  const app = worker();
  const user = {
    id: crypto.randomUUID(),
    email: 'reader@example.test',
    aud: 'authenticated',
    created_at: new Date().toISOString(),
    app_metadata: {},
    user_metadata: {},
  };
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/api/auth/config')
      return Response.json({ google: false });
    if (url.pathname === '/auth/v1/token')
      return Response.json({
        access_token: crypto.randomUUID(),
        refresh_token: crypto.randomUUID(),
        expires_in: 3600,
        token_type: 'bearer',
        user,
      });
    if (url.pathname === '/auth/v1/user') return Response.json(user);
    assert.equal(url.pathname, '/api/auth/access');
    return new Response('<html>Deployment protection</html>', {
      status: 401,
      headers: { 'Content-Type': 'text/html' },
    });
  };
  await app.dispatch({ type: 'auth:start', language: 'en' }, panel);
  const attemptId = new URL(app.authUrl).searchParams.get('attempt');
  const website = { url: app.authUrl, frameId: 0, tab: { id: 42 } };
  const connected = authReplySchema.parse(
    await app.dispatch(
      { type: 'auth:hello', attemptId, recipient: extensionId },
      website,
      true,
    ),
  );
  assert.ok(connected.ok && connected.secret);
  const result = authReplySchema.parse(
    await app.dispatch(
      {
        type: 'auth:password',
        attemptId,
        recipient: extensionId,
        secret: connected.secret,
        email: user.email,
        password: crypto.randomUUID(),
      },
      website,
      true,
    ),
  );
  assert.ok(result.ok);
  assert.equal(result.status.phase, 'unverified');
  assert.equal(result.status.error, 'UNAVAILABLE');
  assert.equal(
    (app.writes.get(AUTH_RECORD_KEY) as AuthRecord).session?.user.id,
    user.id,
  );
});

test('closing the browser Google window produces a recoverable cancellation', async () => {
  const app = worker(true, 'The user did not approve access.');
  globalThis.fetch = async () => Response.json({ google: true });
  await app.dispatch({ type: 'auth:start', language: 'en' }, panel);
  const attemptId = new URL(app.authUrl).searchParams.get('attempt');
  const website = { url: app.authUrl, frameId: 0, tab: { id: 42 } };
  const connected = authReplySchema.parse(
    await app.dispatch(
      { type: 'auth:hello', attemptId, recipient: extensionId },
      website,
      true,
    ),
  );
  assert.ok(connected.ok && connected.secret);
  const result = await app.dispatch(
    {
      type: 'auth:google',
      attemptId,
      recipient: extensionId,
      secret: connected.secret,
    },
    website,
    true,
  );
  assert.deepEqual(result, { ok: false, error: 'CANCELLED' });
  assert.equal(
    (app.writes.get(AUTH_RECORD_KEY) as AuthRecord).attempt?.stage,
    'ready',
  );
});

test('inline worker accepts only the initiating floating document and disposal invalidates pending credentials', async () => {
  const floating = {
    id: extensionId,
    url: `chrome-extension://${extensionId}/floating.html#${crypto.randomUUID()}`,
    frameId: 3,
    documentId: crypto.randomUUID(),
    tab: { id: 2 },
  };
  const second = {
    ...floating,
    documentId: crypto.randomUUID(),
    tab: { id: 3 },
  };
  let live = true;
  const app = worker(
    true,
    undefined,
    (sender) => sender === second || (live && sender === floating),
  );
  let requests = 0;
  let enter!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const user = {
    id: crypto.randomUUID(),
    email: 'reader@example.test',
    aud: 'authenticated',
    created_at: new Date().toISOString(),
    app_metadata: {},
    user_metadata: {},
  };
  globalThis.fetch = async (input) => {
    requests++;
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/logout')
      return new Response(null, { status: 204 });
    assert.equal(url.pathname, '/auth/v1/token');
    enter();
    await pending;
    return Response.json({
      access_token: crypto.randomUUID(),
      refresh_token: crypto.randomUUID(),
      expires_in: 3600,
      token_type: 'bearer',
      user,
    });
  };
  const started = authReplySchema.parse(
    await app.dispatch(
      { type: 'auth:start', language: 'en', inline: true },
      floating,
    ),
  );
  assert.ok(started.ok);
  const message = {
    type: 'auth:inline-password',
    epoch: started.status.epoch,
    email: user.email,
    password: crypto.randomUUID(),
  };
  assert.deepEqual(await app.dispatch(message, second), {
    ok: false,
    error: 'INVALID_ATTEMPT',
  });
  assert.deepEqual(
    await app.dispatch(
      { type: 'auth:inline-cancel', epoch: started.status.epoch },
      second,
    ),
    { ok: false, error: 'INVALID_ATTEMPT' },
  );
  assert.equal(requests, 0);
  const loggingIn = app.dispatch(message, floating);
  await entered;
  live = false;
  await app.cancelInlineDocument(floating);
  release();
  assert.deepEqual(await loggingIn, { ok: false, error: 'UNAVAILABLE' });
  const saved = app.writes.get(AUTH_RECORD_KEY) as AuthRecord;
  assert.equal(saved.session, null);
  assert.equal(saved.status.phase, 'signed_out');
  assert.equal(app.opened, 0);
  assert.equal(
    requests,
    2,
    'one token request, followed only by revocation of the discarded candidate',
  );
});
