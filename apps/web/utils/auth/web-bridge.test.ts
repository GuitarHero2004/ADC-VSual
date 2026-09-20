import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import type { AuthStatus, AuthWebsiteMessage } from '@adc/contracts';
import {
  extensionAttempt,
  browserAuthSender,
  WebAuthError,
  WebExtensionBridge,
} from './web-bridge.ts';

const attempt = { recipient: 'a'.repeat(32), attemptId: randomUUID() };
const secret = randomBytes(32).toString('hex');
const status: AuthStatus = {
  phase: 'signed_out',
  account: null,
  workspace: 'unknown',
  epoch: randomUUID(),
  attempt: { id: attempt.attemptId, expiresAt: Date.now() + 100_000 },
  error: null,
  logoutConfirmed: null,
};
const hello = { ok: true, status, secret, google: true };
const expected = (code: string) => (error: unknown) =>
  error instanceof WebAuthError && error.code === code;

test('extension login URL accepts only one exact recipient, attempt and optional UI language; no credentials or destinations', () => {
  assert.equal(extensionAttempt(new URLSearchParams()), null);
  assert.deepEqual(
    extensionAttempt(
      new URLSearchParams({
        extension: attempt.recipient,
        attempt: attempt.attemptId,
        lang: 'vi',
      }),
    ),
    attempt,
  );
  for (const value of [
    `extension=${attempt.recipient}`,
    `attempt=${attempt.attemptId}`,
    `extension=invalid&attempt=${attempt.attemptId}`,
    `extension=${attempt.recipient}&extension=${attempt.recipient}&attempt=${attempt.attemptId}`,
    `extension=${attempt.recipient}&attempt=${attempt.attemptId}&next=//other.example`,
    `extension=${attempt.recipient}&attempt=${attempt.attemptId}&access_token=value`,
  ])
    assert.throws(
      () => extensionAttempt(new URLSearchParams(value)),
      expected('INVALID_ATTEMPT'),
    );
});

test('verified bridge targets exactly the initiating recipient and never hands web code extension tokens', async () => {
  const messages: AuthWebsiteMessage[] = [];
  const connected = {
    ...status,
    phase: 'signed_in' as const,
    account: { id: randomUUID(), email: 'member@example.test' },
    workspace: 'allowed' as const,
  };
  const bridge = new WebExtensionBridge(attempt, async (recipient, message) => {
    assert.equal(recipient, attempt.recipient);
    messages.push(message);
    return message.type === 'auth:hello'
      ? hello
      : { ok: true, status: connected };
  });
  assert.equal((await bridge.hello()).google, true);
  const supplied = randomBytes(16).toString('hex');
  assert.equal(
    (await bridge.password('member@example.test', supplied)).account?.id,
    connected.account.id,
  );
  assert.equal(messages[1]?.type, 'auth:password');
  assert.equal(
    messages[1] && 'secret' in messages[1] && messages[1].secret,
    secret,
  );
  assert.deepEqual(Object.keys(messages[1] ?? {}).sort(), [
    'attemptId',
    'email',
    'password',
    'recipient',
    'secret',
    'type',
  ]);
  await assert.rejects(bridge.hello(), expected('INVALID_ATTEMPT'));
});

test('invalid, mismatched, expired and replayed external attempts surface only stable application errors', async () => {
  for (const error of [
    'INVALID_ATTEMPT',
    'ATTEMPT_EXPIRED',
    'CANCELLED',
  ] as const) {
    const bridge = new WebExtensionBridge(attempt, async () => ({
      ok: false,
      error,
    }));
    await assert.rejects(bridge.hello(), expected(error));
  }
  for (const reply of [
    { ...hello, headers: { Authorization: 'not-a-token' } },
    { ...hello, access_token: 'not-a-token' },
    { ok: true, status },
  ]) {
    const bridge = new WebExtensionBridge(attempt, async () => reply);
    await assert.rejects(bridge.hello(), expected('INVALID_ATTEMPT'));
  }
  const bridge = new WebExtensionBridge(attempt, async () => hello);
  await bridge.hello();
  await assert.rejects(
    bridge.action('auth:status'),
    expected('INVALID_ATTEMPT'),
  );
});

test('cancel during sign-in makes a late successful callback unusable and prevents retry on the old proof', async () => {
  let resolve!: (reply: unknown) => void;
  const calls: string[] = [];
  const bridge = new WebExtensionBridge(
    attempt,
    async (_recipient, message) => {
      calls.push(message.type);
      if (message.type === 'auth:hello') return hello;
      if (message.type === 'auth:cancel') return { ok: true, status };
      return new Promise((done) => {
        resolve = done;
      });
    },
  );
  await bridge.hello();
  const pending = bridge.action('auth:google');
  await bridge.cancel();
  resolve({ ok: true, status: { ...status, phase: 'signed_in' } });
  await assert.rejects(pending, expected('CANCELLED'));
  await assert.rejects(
    bridge.action('auth:google'),
    expected('INVALID_ATTEMPT'),
  );
  assert.deepEqual(calls, ['auth:hello', 'auth:google', 'auth:cancel']);
});

test('unmount invalidates an in-flight handshake and never stores its late secret', async () => {
  let resolve!: (reply: unknown) => void;
  const calls: string[] = [];
  const bridge = new WebExtensionBridge(
    attempt,
    async (_recipient, message) => {
      calls.push(message.type);
      return new Promise((done) => {
        resolve = done;
      });
    },
  );
  const pending = bridge.hello();
  bridge.dispose();
  resolve(hello);
  await assert.rejects(pending, expected('CANCELLED'));
  await assert.rejects(
    bridge.action('auth:status'),
    expected('INVALID_ATTEMPT'),
  );
  assert.deepEqual(calls, ['auth:hello']);
});

test('explicit cancel before hello arrives uses its late proof only to cancel the original extension attempt', async () => {
  let resolve!: (reply: unknown) => void;
  const sent: AuthWebsiteMessage[] = [];
  const bridge = new WebExtensionBridge(attempt, async (recipient, message) => {
    assert.equal(recipient, attempt.recipient);
    sent.push(message);
    if (message.type === 'auth:hello')
      return new Promise((done) => {
        resolve = done;
      });
    return { ok: true, status };
  });
  const pending = bridge.hello();
  await bridge.cancel();
  assert.deepEqual(
    sent.map((message) => message.type),
    ['auth:hello'],
  );
  resolve(hello);
  await assert.rejects(pending, expected('CANCELLED'));
  assert.deepEqual(sent, [
    { type: 'auth:hello', ...attempt },
    { type: 'auth:cancel', ...attempt, secret },
  ]);
  await assert.rejects(
    bridge.action('auth:status'),
    expected('INVALID_ATTEMPT'),
  );
});

test('explicit pre-handshake cancel never forwards a mismatched or credential-bearing late reply', async () => {
  for (const reply of [
    {
      ...hello,
      status: { ...status, attempt: { ...status.attempt, id: randomUUID() } },
    },
    { ...hello, headers: { Authorization: 'not-a-token' } },
  ]) {
    let resolve!: (reply: unknown) => void;
    let calls = 0;
    const bridge = new WebExtensionBridge(attempt, async () => {
      calls++;
      return new Promise((done) => {
        resolve = done;
      });
    });
    const pending = bridge.hello();
    await bridge.cancel();
    resolve(reply);
    await assert.rejects(pending, expected('CANCELLED'));
    assert.equal(calls, 1);
  }
});

test('Google interaction remains pending beyond two minutes but has a bounded five-minute attempt grace', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let callback!: (reply: unknown) => void;
  const sender = browserAuthSender({
    chrome: {
      runtime: {
        sendMessage(
          _recipient: string,
          _message: AuthWebsiteMessage,
          reply: (value: unknown) => void,
        ) {
          callback = reply;
        },
      },
    },
  } as unknown as Window);
  let settled = false;
  const pending = sender(attempt.recipient, {
    type: 'auth:google',
    ...attempt,
    secret,
  }).finally(() => {
    settled = true;
  });
  context.mock.timers.tick(120_001);
  await Promise.resolve();
  assert.equal(settled, false);
  callback({ ok: true, status });
  await pending;
  const deadline = sender(attempt.recipient, {
    type: 'auth:google',
    ...attempt,
    secret,
  });
  const rejected = assert.rejects(deadline, expected('UNAVAILABLE'));
  context.mock.timers.tick(310_000);
  await rejected;
});
