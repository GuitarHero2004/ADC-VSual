import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DesktopActivation } from './activation.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture() {
  let foreground: () => Promise<string | null> = async () => 'window:42:0';
  const calls: string[] = [];
  const activation = new DesktopActivation({
    foreground: () => {
      calls.push('lookup');
      return foreground();
    },
    ownSource: () => 'window:99:1',
    stopWork: () => {
      calls.push('stop');
    },
    show: () => {
      calls.push('show');
    },
  });
  return {
    activation,
    calls,
    foreground: (read: typeof foreground) => {
      foreground = read;
    },
  };
}

test('first activation resolves the native target before showing VSual', async () => {
  const f = fixture();
  const target = deferred<string | null>();
  f.foreground(() => target.promise);
  const activating = f.activation.activate();
  await Promise.resolve();
  assert.deepEqual(f.calls, ['stop', 'lookup']);
  assert.equal(f.activation.nativeId, null);
  target.resolve('window:42:0');
  await activating;
  assert.equal(f.activation.nativeId, 'window:42:0');
  assert.deepEqual(f.calls, ['stop', 'lookup', 'show']);
});

test('repeated activation shares one lookup and publishes once', async () => {
  const f = fixture();
  const target = deferred<string | null>();
  f.foreground(() => target.promise);
  const first = f.activation.activate();
  const second = f.activation.activate();
  assert.equal(first, second);
  target.resolve('window:42:0');
  await Promise.all([first, second]);
  assert.deepEqual(f.calls, ['stop', 'lookup', 'show']);
});

test('only an actual native VSual match preserves the preceding target', async () => {
  const f = fixture();
  await f.activation.activate();
  f.foreground(async () => 'window:99:0');
  await f.activation.activate();
  assert.equal(f.activation.nativeId, 'window:42:0');
  f.foreground(async () => 'window:55:0');
  await f.activation.activate();
  assert.equal(f.activation.nativeId, 'window:55:0');
  assert.equal(f.calls.filter((value) => value === 'lookup').length, 3);
});

test('unavailable or invalid native results clear a stale target', async () => {
  for (const result of [null, 'screen:42:0', 'window:0:0', 'window:42:7']) {
    const f = fixture();
    await f.activation.activate();
    f.foreground(async () => result);
    await f.activation.activate();
    assert.equal(f.activation.nativeId, null);
  }
});

test('native lookup failure opens recoverable UI without guessing a target', async () => {
  const f = fixture();
  await f.activation.activate();
  f.foreground(async () => {
    throw new Error('Unavailable');
  });
  await f.activation.activate();
  assert.equal(f.activation.nativeId, null);
  assert.equal(f.calls.filter((value) => value === 'show').length, 2);
});

test('hide or account invalidation prevents a late lookup from reopening VSual', async () => {
  for (const clearTarget of [false, true]) {
    const f = fixture();
    const target = deferred<string | null>();
    f.foreground(() => target.promise);
    const work = f.activation.activate();
    f.activation.invalidate(clearTarget);
    target.resolve('window:42:0');
    await work;
    assert.equal(f.activation.nativeId, null);
    assert.equal(f.calls.includes('show'), false);
  }
});

test('initial sign-in retains only selected metadata while account loss clears it', async () => {
  const f = fixture();
  await f.activation.activate();
  f.activation.invalidate(false);
  assert.equal(f.activation.nativeId, 'window:42:0');
  f.activation.invalidate(true);
  assert.equal(f.activation.nativeId, null);
  f.foreground(async () => 'window:99:0');
  await f.activation.activate();
  assert.equal(f.activation.nativeId, null);
});

test('an older lookup cannot replace a newer activation after cancellation', async () => {
  const f = fixture();
  const old = deferred<string | null>();
  f.foreground(() => old.promise);
  const previous = f.activation.activate();
  await Promise.resolve();
  f.activation.invalidate();
  f.foreground(async () => 'window:55:0');
  await f.activation.activate();
  old.resolve('window:42:0');
  await previous;
  assert.equal(f.activation.nativeId, 'window:55:0');
  assert.equal(f.calls.filter((value) => value === 'show').length, 1);
});
