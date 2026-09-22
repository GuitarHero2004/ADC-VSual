import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DESKTOP_SHORTCUTS, DESKTOP_STOP_SHORTCUT } from '../bridge.ts';
import {
  DesktopGuideController,
  guideCopy,
  guideSpeechText,
  type GuideDependencies,
} from './guide.ts';
import { assistantHarness, session } from './test-helpers.ts';

function voice(lang = 'en-US', isDefault = true): SpeechSynthesisVoice {
  return {
    lang,
    default: isDefault,
    localService: true,
    name: `Local ${lang}`,
    voiceURI: `local:${lang}`,
  };
}

function fixture(signedIn = true) {
  const h = assistantHarness();
  let voices: SpeechSynthesisVoice[] = [voice()];
  let cancellations = 0;
  const utterances: SpeechSynthesisUtterance[] = [];
  const listeners = new Set<() => void>();
  const timers = new Set<() => void>();
  const dependencies: GuideDependencies = {
    getVoices: () => voices,
    createUtterance: (text) => ({ text }) as SpeechSynthesisUtterance,
    speak: (utterance) => utterances.push(utterance),
    cancel: () => {
      cancellations++;
    },
    onVoicesChanged: (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    schedule: (callback, delayMs) => {
      assert.equal(delayMs, 1_500);
      timers.add(callback);
      return () => timers.delete(callback);
    },
  };
  h.bridge.getGuideSeenVersion = async () => {
    throw new Error('Local guidance must not read old first-use storage');
  };
  h.bridge.markGuideSeenVersion = async () => {
    throw new Error('Local guidance must not write old first-use storage');
  };
  const controller = new DesktopGuideController(h.bridge, dependencies);
  if (signedIn) controller.setSession(session);
  return {
    ...h,
    dependencies,
    controller,
    utterances,
    listeners,
    timers,
    cancellations: () => cancellations,
    setVoices(next: SpeechSynthesisVoice[]) {
      voices = next;
      for (const callback of [...listeners]) callback();
    },
    timeout() {
      for (const callback of [...timers]) callback();
    },
  };
}

test('welcome starts after sign-in without requiring workspace or provider access', async () => {
  const h = fixture(false);
  h.controller.beforeWork();
  await h.controller.automatic('Welcome.', 'en');
  assert.equal(h.utterances.length, 0);
  h.controller.setSession({ ...session, workspace: 'denied' });
  await h.controller.automatic('Welcome.', 'en');
  assert.equal(h.utterances.length, 1);
  assert.equal(h.utterances[0]!.rate, 0.9);
  assert.equal(h.utterances[0]!.voice?.localService, true);
  assert.deepEqual(h.calls.speech, []);
  assert.equal(h.calls.captures, 0);
  assert.equal(h.calls.transcriptions, 0);
});

test('Windows automatic and replay narration pronounce the brand as Visual while written guidance retains VSual', async () => {
  for (const language of ['en', 'vi'] as const) {
    const h = fixture();
    h.setVoices([voice(language === 'en' ? 'en-US' : 'vi-VN')]);
    const text = guideSpeechText(
      language,
      'Control+Alt+Space',
      DESKTOP_STOP_SHORTCUT,
      true,
    );
    await h.controller.automatic(text, language);
    assert.match(h.utterances[0]!.text, /Visual/);
    assert.doesNotMatch(h.utterances[0]!.text, /VSual/);
    assert.match(text, /VSual/);
    assert.match(guideCopy[language].title, /VSual/);
    h.utterances[0]!.onend?.({} as SpeechSynthesisEvent);
    await h.controller.replay(text, language);
    assert.equal(h.utterances[1]!.text, h.utterances[0]!.text);
    assert.deepEqual(h.calls.speech, []);
  }
});

test('automatic narration reserves once per run; explicit replay uses the local default voice', async () => {
  const h = fixture();
  h.setVoices([voice('en-GB', false), voice('en-US')]);
  await Promise.all([
    h.controller.automatic('Welcome.', 'en'),
    h.controller.automatic('Welcome.', 'en'),
    h.controller.replay('Welcome.', 'en'),
  ]);
  assert.equal(h.utterances.length, 1);
  assert.equal(h.utterances[0]!.voice?.lang, 'en-US');
  const cancels = h.cancellations();
  h.controller.setSession({ ...session });
  assert.equal(h.cancellations(), cancels);
  h.utterances[0]!.onend?.({} as SpeechSynthesisEvent);
  assert.equal(h.controller.getSnapshot().phase, 'complete');
  await h.controller.automatic('Welcome.', 'en');
  assert.equal(h.utterances.length, 1);
  await h.controller.replay('Welcome.', 'en');
  assert.equal(h.utterances.length, 2);
  assert.deepEqual(h.calls.speech, []);
});

test('Stop and user work cancel pending voices and suppress a late welcome', async () => {
  for (const stop of ['stop', 'beforeWork', 'interrupt'] as const) {
    const h = fixture();
    h.setVoices([]);
    const pending = h.controller.automatic('Welcome.', 'en');
    assert.equal(h.listeners.size, 1);
    h.controller[stop]();
    h.setVoices([voice()]);
    await pending;
    await h.controller.automatic('Welcome.', 'en');
    assert.equal(h.utterances.length, 0);
    assert.equal(h.listeners.size, 0);
    assert.equal(h.timers.size, 0);
    assert.equal(h.controller.getSnapshot().phase, 'stopped');
    await h.controller.replay('Welcome.', 'en');
    assert.equal(h.utterances.length, 1);
  }
});

test('logout, changed account and teardown cancel speech and ignore old completion', async () => {
  for (const change of ['logout', 'account', 'clear'] as const) {
    const h = fixture();
    await h.controller.automatic('Welcome.', 'en');
    const cancels = h.cancellations();
    if (change === 'logout') h.controller.setSession(null);
    else if (change === 'account')
      h.controller.setSession({
        ...session,
        epoch: crypto.randomUUID(),
        account: { id: 'account-b', email: 'other@example.test' },
      });
    else h.controller.clear();
    const phase = h.controller.getSnapshot().phase;
    assert.ok(h.cancellations() > cancels);
    h.utterances[0]!.onend?.({} as SpeechSynthesisEvent);
    h.utterances[0]!.onerror?.({} as SpeechSynthesisErrorEvent);
    assert.equal(h.controller.getSnapshot().phase, phase);
    await h.controller.automatic('Welcome again.', 'en');
    assert.equal(h.utterances.length, 1);
  }
});

test('waits briefly for matching local voices and never falls back to remote or wrong-language speech', async () => {
  const h = fixture();
  h.setVoices([voice(), { ...voice('vi-VN'), localService: false }]);
  const missing = h.controller.automatic('Xin chào.', 'vi');
  h.timeout();
  await missing;
  assert.equal(h.controller.getSnapshot().phase, 'unavailable');
  assert.equal(h.utterances.length, 0);
  const retry = h.controller.replay('Xin chào.', 'vi');
  h.setVoices([voice('vi-VN')]);
  await retry;
  assert.equal(h.utterances[0]!.lang, 'vi-VN');
  assert.equal(h.listeners.size, 0);
  assert.equal(h.timers.size, 0);
});

test('Windows playback failure is recoverable without automatic retries', async () => {
  const h = fixture();
  const speak = h.dependencies.speak;
  h.dependencies.speak = () => {
    throw new Error('Windows voice unavailable');
  };
  await h.controller.automatic('Welcome.', 'en');
  assert.equal(h.controller.getSnapshot().phase, 'failed');
  h.dependencies.speak = speak;
  await h.controller.automatic('Welcome.', 'en');
  assert.equal(h.utterances.length, 0);
  await h.controller.replay('Welcome.', 'en');
  assert.equal(h.controller.getSnapshot().phase, 'speaking');
  h.controller.stop();
  h.utterances[0]!.onend?.({} as SpeechSynthesisEvent);
  assert.equal(h.controller.getSnapshot().phase, 'stopped');
});

test('spoken guidance states the actual registered shortcuts in English and Vietnamese', () => {
  for (const language of ['en', 'vi'] as const)
    for (const shortcut of DESKTOP_SHORTCUTS)
      for (const talkRegistered of [false, true])
        for (const stopRegistered of [false, true]) {
          const text = guideSpeechText(
            language,
            shortcut,
            DESKTOP_STOP_SHORTCUT,
            stopRegistered,
            talkRegistered,
          );
          assert.equal(
            text.includes(shortcut.replaceAll('+', ', ')),
            talkRegistered,
          );
          assert.equal(text.includes('Backspace'), stopRegistered);
          assert.match(text, /Escape/);
        }
});
