import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import {
  beginExtensionSignIn,
  blockExtensionSession,
  clearExtensionSession,
  extensionSessionStorage,
  isExtensionSignedOut,
} from './auth.ts';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const stored = new Map<string, string>();
let writeGate: Promise<void> | undefined;
const previousChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
beforeEach(async () => {
  stored.clear();
  writeGate = undefined;
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      storage: {
        session: {
          async get(key: string) {
            return { [key]: stored.get(key) };
          },
          async set(values: Record<string, string>) {
            await writeGate;
            for (const [key, value] of Object.entries(values))
              stored.set(key, value);
          },
          async remove(key: string) {
            stored.delete(key);
          },
        },
      },
    },
  });
  await beginExtensionSignIn();
});
afterEach(() => {
  if (previousChrome)
    Object.defineProperty(globalThis, 'chrome', previousChrome);
  else Reflect.deleteProperty(globalThis, 'chrome');
});

test('logout stops refresh and removes a refresh write that was already in flight', async () => {
  const write = deferred();
  writeGate = write.promise;
  const pendingWrite = extensionSessionStorage.setItem(
    'adc:auth:session',
    'late-token',
  );
  let stopped = false;
  const logout = clearExtensionSession({
    auth: {
      async stopAutoRefresh() {
        stopped = true;
      },
      async signOut() {
        await pendingWrite;
        return { error: null };
      },
    },
  });
  assert.equal(isExtensionSignedOut(), true);
  assert.equal(await extensionSessionStorage.getItem('adc:auth:session'), null);
  write.resolve();
  await logout;
  assert.equal(stopped, true);
  assert.equal(stored.has('adc:auth:session'), false);
  await extensionSessionStorage.setItem('adc:auth:session', 'later-refresh');
  assert.equal(stored.has('adc:auth:session'), false);
});

test('a failed SDK sign-out still clears a late session value in finally', async () => {
  await assert.rejects(
    clearExtensionSession({
      auth: {
        async stopAutoRefresh() {},
        async signOut() {
          stored.set('adc:auth:session', 'refresh-before-failure');
          throw new Error('Auth unavailable');
        },
      },
    }),
    /Auth unavailable/,
  );
  assert.equal(stored.has('adc:auth:session'), false);
  assert.equal(isExtensionSignedOut(), true);
});

test('explicit sign-in waits for pending logout before accepting a new session', async () => {
  const ending = deferred();
  const logout = clearExtensionSession({
    auth: {
      async stopAutoRefresh() {},
      async signOut() {
        await ending.promise;
        return { error: null };
      },
    },
  });
  const signIn = beginExtensionSignIn();
  await Promise.resolve();
  assert.equal(isExtensionSignedOut(), true);
  ending.resolve();
  await Promise.all([logout, signIn]);
  await extensionSessionStorage.setItem('adc:auth:session', 'new-session');
  assert.equal(
    await extensionSessionStorage.getItem('adc:auth:session'),
    'new-session',
  );
  blockExtensionSession();
  assert.equal(await extensionSessionStorage.getItem('adc:auth:session'), null);
});
