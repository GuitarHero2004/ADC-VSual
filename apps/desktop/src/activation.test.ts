import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DesktopActivationEvent } from './bridge.ts';
import { DesktopActivation } from './activation.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture(ownSource = 'window:99:1') {
  let foreground: () => Promise<string | null> = async () => 'window:42:0';
  const calls: string[] = [];
  const events: DesktopActivationEvent[] = [];
  const activation = new DesktopActivation({
    foreground: () => {
      calls.push('lookup');
      return foreground();
    },
    ownSource: () => ownSource,
    stopWork: () => {
      calls.push('stop');
    },
    announce: (event) => {
      events.push(event);
    },
    show: () => {
      calls.push('show');
    },
  });
  return {
    activation,
    calls,
    events,
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

test('Talk is delivered before native lookup without cancelling the current recording', async () => {
  const f = fixture();
  const target = deferred<string | null>();
  f.foreground(() => target.promise);
  const work = f.activation.activate('talk');
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0]?.kind, 'talk');
  assert.equal(f.calls.includes('stop'), false);
  let ready = false;
  void f.activation.ready().then(() => {
    ready = true;
  });
  await Promise.resolve();
  assert.equal(ready, false);
  assert.equal(f.calls.includes('show'), false);
  assert.equal(f.activation.activate('talk'), work);
  assert.equal(
    f.events.length,
    1,
    'Repeated shortcut is not delivered twice during lookup',
  );
  target.resolve('window:42:0');
  await work;
  assert.equal(ready, true);
  assert.equal(f.activation.nativeId, 'window:42:0');
  assert.equal(f.events.length, 1);
  assert.equal(f.calls.includes('show'), true);
});

test('Talk upgrades a passive cold activation without a second later open event', async () => {
  const f = fixture();
  const target = deferred<string | null>();
  f.foreground(() => target.promise);
  const opening = f.activation.activate();
  const talking = f.activation.activate('talk');
  assert.equal(opening, talking);
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0]?.kind, 'talk');
  target.resolve('window:42:0');
  await talking;
  assert.equal(f.events.length, 1);
});

test('Stop invalidates late Talk lookup and a new intent has its own ID', async () => {
  const f = fixture();
  const target = deferred<string | null>();
  f.foreground(() => target.promise);
  const work = f.activation.activate('talk');
  await Promise.resolve();
  const oldId = f.events[0]?.id;
  f.activation.invalidate();
  target.resolve('window:42:0');
  await work;
  assert.equal(f.calls.includes('show'), false);
  f.foreground(async () => 'window:55:0');
  await f.activation.activate('talk');
  assert.notEqual(f.events[1]?.id, oldId);
  assert.equal(f.activation.nativeId, 'window:55:0');
});

test('Electron own-window suffixes above one preserve the previously selected native target', async () => {
  for (const suffix of [2, 17]) {
    const f = fixture(`window:99:${suffix}`);
    await f.activation.activate();
    f.foreground(async () => 'window:99:0');
    await f.activation.activate('talk');
    assert.equal(f.activation.nativeId, 'window:42:0');
    assert.equal(f.events.at(-1)?.kind, 'talk');
  }
});
