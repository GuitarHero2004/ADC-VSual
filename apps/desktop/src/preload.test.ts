import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import type { DesktopBridge } from './bridge.ts';

test('preload preserves cold activation, cleans subscribers, and exposes only named capabilities', async () => {
  const events = new Map<string, Set<(...args: unknown[]) => void>>();
  const calls: unknown[][] = [];
  let bridge!: DesktopBridge;
  const ipc = {
    on(channel: string, callback: (...args: unknown[]) => void) {
      if (!events.has(channel)) events.set(channel, new Set());
      events.get(channel)!.add(callback);
    },
    removeListener(channel: string, callback: (...args: unknown[]) => void) {
      events.get(channel)?.delete(callback);
    },
    async invoke(...args: unknown[]) {
      calls.push(args);
    },
  };
  runInNewContext(
    ts.transpileModule(
      readFileSync(new URL('./preload.ts', import.meta.url), 'utf8'),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText,
    {
      exports: {},
      queueMicrotask,
      require(name: string) {
        assert.equal(
          name,
          'electron',
          'Sandbox preload must only require Electron',
        );
        return {
          ipcRenderer: ipc,
          contextBridge: {
            exposeInMainWorld(name: string, value: DesktopBridge) {
              assert.equal(name, 'vsualDesktop');
              bridge = value;
            },
          },
        };
      },
    },
  );
  const emit = (channel: string, input?: unknown) => {
    for (const listener of events.get(channel) ?? []) listener({}, input);
  };
  const activate = (id = crypto.randomUUID()) => {
    emit('desktop:activated', { id, kind: 'talk' });
    return id;
  };
  const initialId = activate();
  await Promise.resolve();
  let first = 0;
  let second = 0;
  const unsubscribe = bridge.onActivate(() => first++);
  unsubscribe();
  const remove = bridge.onActivate((event) => {
    assert.equal(event.kind, 'talk');
    second++;
  });
  await Promise.resolve();
  assert.equal(
    second,
    0,
    'A subscriber alone does not bypass initial session hydration',
  );
  await bridge.activationReady();
  await Promise.resolve();
  assert.equal(first, 0);
  assert.equal(second, 1);
  await Promise.resolve();
  assert.equal(second, 1, 'No replay from later microtasks');
  activate(initialId);
  emit('desktop:activated', { id: 'bad', kind: 'talk' });
  await Promise.resolve();
  assert.equal(second, 1, 'Duplicate and malformed native events are rejected');
  activate();
  await Promise.resolve();
  assert.equal(second, 2);
  remove();
  activate();
  await Promise.resolve();
  assert.equal(second, 2);
  emit('assistant:suspend');
  const removeLater = bridge.onActivate(() => second++);
  await Promise.resolve();
  assert.equal(
    second,
    2,
    'Stop clears an activation queued during unsubscribe',
  );
  removeLater();
  assert.deepEqual(Object.keys(bridge).sort(), [
    'activationReady',
    'cancelOperation',
    'getActiveSource',
    'getGuideSeenVersion',
    'getSession',
    'getState',
    'hide',
    'markGuideSeenVersion',
    'onActivate',
    'onSession',
    'onState',
    'onSuspend',
    'prepareCapture',
    'quit',
    'readScreen',
    'retrySession',
    'signIn',
    'signOut',
    'speak',
    'stopWork',
    'transcribe',
    'updatePreferences',
  ]);
  await bridge.getState();
  await bridge.hide();
  await bridge.quit();
  assert.deepEqual(calls, [
    ['desktop:activation-ready'],
    ['desktop:state'],
    ['desktop:hide'],
    ['desktop:quit'],
  ]);
  assert.equal(
    calls.some((call) => /record|capture|fetch/.test(String(call[0]))),
    false,
  );
});

test('assistant failures reject cloneable safe records with codes and usage rather than custom Error properties', async () => {
  const usage = {
    minute_count: 24,
    minute_limit: 24,
    day_count: 30,
    day_limit: 240,
    limited_by: 'minute',
    retry_after_seconds: 30,
    retry_at: '2026-09-22T09:00:30.000Z',
  };
  const requestId = crypto.randomUUID();
  const expected = {
    code: 'APP_RATE_LIMITED',
    message: 'Synthetic safe error.',
    requestId,
    usage,
  };
  let result: unknown = {
    ok: false,
    error: { ...expected, privateDetail: 'must not cross the bridge' },
  };
  let bridge!: DesktopBridge;
  runInNewContext(
    ts.transpileModule(
      readFileSync(new URL('./preload.ts', import.meta.url), 'utf8'),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText,
    {
      exports: {},
      queueMicrotask,
      require(name: string) {
        assert.equal(name, 'electron');
        return {
          ipcRenderer: {
            on() {},
            removeListener() {},
            async invoke() {
              return result;
            },
          },
          contextBridge: {
            exposeInMainWorld(_name: string, value: DesktopBridge) {
              bridge = value;
            },
          },
        };
      },
    },
  );
  await assert.rejects(
    bridge.speak({ requestId, text: 'Synthetic text', language: 'en' }),
    (error: unknown) => {
      assert.deepEqual(structuredClone(error), expected);
      assert.equal(Object.prototype.toString.call(error), '[object Object]');
      return true;
    },
  );
  result = {
    ok: false,
    error: { code: 'UNAUTHENTICATED', message: 'Sign in first.' },
  };
  await assert.rejects(
    bridge.prepareCapture(crypto.randomUUID(), requestId),
    (error: unknown) => {
      assert.deepEqual(structuredClone(error), {
        code: 'UNAUTHENTICATED',
        message: 'Sign in first.',
      });
      return true;
    },
  );
  result = { ok: true, value: null };
  assert.equal(await bridge.getActiveSource(), null);
});
