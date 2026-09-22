import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { browserDependencies } from './browser.ts';

function cueEnvironment(t: TestContext, state: AudioContextState = 'running') {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  const tones: { frequency: number; gain: number; stop: number }[] = [];
  const ended: (() => void)[] = [];
  let closes = 0;
  class Context {
    state = state;
    currentTime = 10;
    destination = {};
    createOscillator() {
      const oscillator = {
        frequency: { value: 0 },
        onended: null as (() => void) | null,
        connect: () => undefined,
        start: () => undefined,
        stop: (time: number) => {
          tones.push({
            frequency: oscillator.frequency.value,
            gain: this.gain.gain.value,
            stop: time,
          });
          ended.push(() => oscillator.onended?.());
        },
      };
      return oscillator;
    }
    gain = { gain: { value: 0 }, connect: () => undefined };
    createGain() {
      return this.gain;
    }
    async close() {
      closes++;
    }
  }
  Object.defineProperty(globalThis, 'AudioContext', {
    configurable: true,
    value: Context,
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'AudioContext', original);
    else Reflect.deleteProperty(globalThis, 'AudioContext');
  });
  return { tones, ended, closes: () => closes };
}

test('local cues preserve the default tone and provide short countdown and distinct submit tones', (t) => {
  const h = cueEnvironment(t);
  browserDependencies.cue();
  browserDependencies.cue('countdown');
  browserDependencies.cue('submit');
  assert.deepEqual(h.tones, [
    { frequency: 660, gain: 0.08, stop: 10.12 },
    { frequency: 440, gain: 0.025, stop: 10.06 },
    { frequency: 880, gain: 0.08, stop: 10.12 },
  ]);
  h.ended.forEach((end) => end());
  assert.equal(h.closes(), 3);
});

test('a suspended AudioContext never queues a delayed tone outside the echo guard', (t) => {
  const h = cueEnvironment(t, 'suspended');
  browserDependencies.cue('countdown');
  assert.equal(h.tones.length, 0);
  assert.equal(h.closes(), 1);
});
