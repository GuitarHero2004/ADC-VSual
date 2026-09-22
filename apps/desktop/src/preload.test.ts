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
  const activate = () => {
    for (const listener of events.get('desktop:activated') ?? []) listener();
  };
  activate();
  await Promise.resolve();
  let first = 0;
  let second = 0;
  const unsubscribe = bridge.onActivate(() => first++);
  unsubscribe();
  const remove = bridge.onActivate(() => second++);
  await Promise.resolve();
  assert.equal(first, 0);
  assert.equal(second, 1);
  await Promise.resolve();
  assert.equal(second, 1, 'No replay from later microtasks');
  activate();
  await Promise.resolve();
  assert.equal(second, 2);
  remove();
  activate();
  await Promise.resolve();
  assert.equal(second, 2);
  assert.deepEqual(Object.keys(bridge).sort(), [
    'getState',
    'hide',
    'onActivate',
    'onState',
    'quit',
    'updatePreferences',
  ]);
  await bridge.getState();
  await bridge.hide();
  await bridge.quit();
  assert.deepEqual(calls, [
    ['desktop:state'],
    ['desktop:hide'],
    ['desktop:quit'],
  ]);
  assert.equal(
    calls.some((call) => /record|capture|fetch/.test(String(call[0]))),
    false,
  );
});
