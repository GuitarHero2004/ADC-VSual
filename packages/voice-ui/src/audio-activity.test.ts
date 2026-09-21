import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { observeAudioActivity } from './audio-activity.ts';

function environment(t: TestContext, pending = false) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const original = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  let resolveResume = () => {};
  const stateListeners = new Set<() => void>();
  let amplitude = 0;
  const stats = {
    connections: 0,
    disconnected: 0,
    closes: 0,
    activities: 0,
    unavailable: 0,
    created: 0,
  };
  const analyser = {
    fftSize: 0,
    getFloatTimeDomainData(samples: Float32Array) {
      samples.fill(amplitude);
    },
    disconnect() {
      stats.disconnected++;
    },
  };
  const contexts: FakeContext[] = [];
  class FakeContext {
    state: AudioContextState = pending ? 'suspended' : 'running';
    constructor() {
      stats.created++;
      contexts.push(this);
    }
    createMediaStreamSource() {
      return {
        connect(destination: unknown) {
          assert.equal(
            destination,
            analyser,
            'Microphone analysis must never connect to speakers',
          );
          stats.connections++;
        },
        disconnect() {
          stats.disconnected++;
        },
      };
    }
    createAnalyser() {
      return analyser;
    }
    async resume() {
      if (pending)
        await new Promise<void>((resolve) => {
          resolveResume = resolve;
        });
    }
    addEventListener(_type: string, listener: () => void) {
      stateListeners.add(listener);
    }
    removeEventListener(_type: string, listener: () => void) {
      stateListeners.delete(listener);
    }
    async close() {
      stats.closes++;
      this.state = 'closed';
    }
  }
  Object.defineProperty(globalThis, 'AudioContext', {
    configurable: true,
    writable: true,
    value: FakeContext,
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'AudioContext', original);
    else Reflect.deleteProperty(globalThis, 'AudioContext');
  });
  const signal = new AbortController();
  return {
    stats,
    signal,
    start: () =>
      observeAudioActivity(
        { getTracks: () => [] },
        () => {
          stats.activities++;
        },
        signal.signal,
        () => {
          stats.unavailable++;
        },
      ),
    amplitude(value: number) {
      amplitude = value;
    },
    resume() {
      contexts[0]!.state = 'running';
      resolveResume();
    },
    suspend() {
      contexts[0]!.state = 'suspended';
      stateListeners.forEach((listener) => listener());
    },
  };
}

test('local analysis ignores quiet and isolated clicks, reports sustained activity, and never uses speakers', async (t) => {
  const h = environment(t);
  const stop = await h.start();
  t.mock.timers.tick(100);
  assert.equal(h.stats.activities, 0);
  h.amplitude(0.04);
  t.mock.timers.tick(50);
  h.amplitude(0);
  t.mock.timers.tick(50);
  assert.equal(
    h.stats.activities,
    0,
    'A single click does not arm automatic submission',
  );
  h.amplitude(0.04);
  t.mock.timers.tick(50);
  t.mock.timers.tick(50);
  assert.equal(h.stats.activities, 1);
  t.mock.timers.tick(50);
  assert.equal(
    h.stats.activities,
    2,
    'Continued activity refreshes the existing recording',
  );
  h.amplitude(0.0001);
  t.mock.timers.tick(50);
  assert.equal(h.stats.activities, 2);
  stop();
  stop();
  t.mock.timers.tick(1_000);
  assert.equal(h.stats.activities, 2);
  assert.equal(h.stats.connections, 1);
  assert.equal(h.stats.disconnected, 2);
  assert.equal(h.stats.closes, 1);
});

test('cancelling a pending AudioContext resume closes resources immediately', async (t) => {
  const h = environment(t, true);
  const pending = h.start();
  const rejection = assert.rejects(pending, { name: 'AbortError' });
  h.signal.abort();
  assert.equal(h.stats.closes, 1);
  assert.equal(h.stats.disconnected, 2);
  await rejection;
  h.resume();
  t.mock.timers.tick(3_000);
  assert.equal(h.stats.activities, 0);
  assert.equal(h.stats.closes, 1);
});

test('audio analysis setup times out instead of waiting for a blocked user gesture indefinitely', async (t) => {
  const h = environment(t, true);
  const pending = h.start();
  const rejection = assert.rejects(pending, /setup timed out/);
  t.mock.timers.tick(2_000);
  await rejection;
  assert.equal(h.stats.closes, 1);
  assert.equal(h.stats.disconnected, 2);
  h.resume();
  t.mock.timers.tick(3_000);
  assert.equal(h.stats.activities, 0);
});

test('suspended running analysis reports unavailability and stops sampling instead of treating it as silence', async (t) => {
  const h = environment(t);
  h.amplitude(0.04);
  const stop = await h.start();
  t.mock.timers.tick(50);
  assert.equal(h.stats.activities, 1);
  h.suspend();
  assert.equal(h.stats.unavailable, 1);
  assert.equal(h.stats.closes, 1);
  t.mock.timers.tick(5_000);
  assert.equal(h.stats.activities, 1);
  stop();
  assert.equal(h.stats.closes, 1);
});

test('an already cancelled observer does not allocate an AudioContext', async (t) => {
  const h = environment(t);
  h.signal.abort();
  const stop = await h.start();
  stop();
  assert.equal(h.stats.created, 0);
});
