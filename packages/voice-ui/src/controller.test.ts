import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AUDIO_MAX_BYTES,
  RECORDING_MAX_MS,
  type UsageLimit,
} from '@adc/contracts';
import {
  COMPANION_PLAYBACK_RATE,
  VoiceController,
  audioFilename,
  type MicrophoneStream,
  type Playback,
  type Recorder,
  type VoiceDependencies,
  type VoiceControllerOptions,
  type VoiceTransport,
} from './controller.ts';
import { errorText } from './strings.ts';
import { VoiceTransportError } from './transport.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

class FakeRecorder implements Recorder {
  mimeType = 'audio/webm;codecs=opus';
  state = 'inactive';
  stops = 0;
  ondata: (chunk: Blob) => void = () => {};
  onstop = () => {};
  onerror = () => {};
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.stops += 1;
  }
  end(final = 'final') {
    this.ondata(new Blob([final]));
    this.onstop();
  }
}

class FakePlayback implements Playback {
  currentTime = 0;
  playbackRate = 1;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  plays = 0;
  pauses = 0;
  releases = 0;
  fail = false;
  async play() {
    this.plays += 1;
    if (this.fail)
      throw new DOMException('Autoplay blocked', 'NotAllowedError');
  }
  pause() {
    this.pauses += 1;
  }
  release() {
    this.releases += 1;
  }
}

function harness(
  overrides: Partial<VoiceTransport> = {},
  options: VoiceControllerOptions = {},
) {
  const recorders: FakeRecorder[] = [];
  const audio = new FakePlayback();
  let trackStops = 0;
  const stream: MicrophoneStream = {
    getTracks: () => [
      {
        stop: () => {
          trackStops += 1;
        },
      },
    ],
  };
  const calls: {
    transcripts: { blob: Blob; filename: string; signal: AbortSignal }[];
    speech: { text: string; signal: AbortSignal }[];
  } = { transcripts: [], speech: [] };
  let timer: (() => void) | undefined;
  let scheduledDelay = 0;
  let urls = 0;
  const revoked: string[] = [];
  const dependencies: VoiceDependencies = {
    getMicrophone: async () => stream,
    createRecorder: () => {
      const recorder = new FakeRecorder();
      recorders.push(recorder);
      return recorder;
    },
    createPlayback: () => audio,
    createObjectURL: () => `blob:${++urls}`,
    revokeObjectURL: (url) => {
      revoked.push(url);
    },
    schedule: (callback, delay) => {
      timer = callback;
      scheduledDelay = delay;
      return 1;
    },
    unschedule: () => {
      timer = undefined;
    },
    cue: () => {},
  };
  const transport: VoiceTransport = {
    async transcribe(blob, filename, language, signal) {
      calls.transcripts.push({ blob, filename, signal });
      if (overrides.transcribe)
        return overrides.transcribe(blob, filename, language, signal);
      return { transcript: 'Doanh thu 1.250.000 đồng.', request_id: 'test' };
    },
    async speak(text, language, signal) {
      calls.speech.push({ text, signal });
      if (overrides.speak) return overrides.speak(text, language, signal);
      return new Blob(['mp3'], { type: 'audio/mpeg' });
    },
  };
  const controller = new VoiceController(transport, dependencies, options);
  return {
    controller,
    dependencies,
    calls,
    audio,
    recorders,
    stream,
    revoked,
    get trackStops() {
      return trackStops;
    },
    get urls() {
      return urls;
    },
    get scheduledDelay() {
      return scheduledDelay;
    },
    fireTimer: () => timer?.(),
  };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function silenceHarness(
  overrides: Partial<VoiceTransport> = {},
  options: VoiceControllerOptions = {},
) {
  const h = harness(overrides, { silenceAutoFinish: true, ...options });
  let now = 0;
  let nextTimer = 0;
  const timers = new Map<number, { at: number; run(): void }>();
  let activity = () => {};
  let observerStops = 0;
  let observerSignal: AbortSignal | undefined;
  let unavailable = () => {};
  h.dependencies.now = () => now;
  h.dependencies.schedule = (run, delay) => {
    const id = ++nextTimer;
    timers.set(id, { at: now + delay, run });
    return id;
  };
  h.dependencies.unschedule = (id) => {
    timers.delete(id as number);
  };
  h.dependencies.observeAudioActivity = async (
    _stream,
    onActivity,
    signal,
    onUnavailable,
  ) => {
    activity = onActivity;
    observerSignal = signal;
    unavailable = onUnavailable;
    return () => {
      observerStops++;
    };
  };
  return {
    ...h,
    get trackStops() {
      return h.trackStops;
    },
    get observerStops() {
      return observerStops;
    },
    get observerSignal() {
      return observerSignal;
    },
    get timerCount() {
      return timers.size;
    },
    activity: () => activity(),
    unavailable: () => unavailable(),
    advance(ms: number) {
      const end = now + ms;
      while (true) {
        const next = [...timers.entries()]
          .filter(([, timer]) => timer.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at;
        timers.delete(next[0]);
        next[1].run();
      }
      now = end;
    },
  };
}

test('finish retains the final audio chunk and transcribes once', async () => {
  const h = harness();
  await h.controller.start();
  const recorder = h.recorders[0]!;
  recorder.ondata(new Blob(['first']));
  h.controller.finish();
  h.controller.finish();
  assert.equal(recorder.stops, 1);
  assert.equal(h.calls.transcripts.length, 0);
  recorder.end();
  recorder.onstop();
  await settle();
  assert.equal(h.calls.transcripts.length, 1);
  assert.equal(await h.calls.transcripts[0]!.blob.text(), 'firstfinal');
  assert.equal(h.calls.transcripts[0]!.blob.type, 'audio/webm;codecs=opus');
  assert.equal(h.calls.transcripts[0]!.filename, 'recording.webm');
  assert.equal(h.controller.getSnapshot().text, 'Doanh thu 1.250.000 đồng.');
  assert.ok(h.trackStops > 0);
});

test('30-second deadline finishes once, while Cancel never submits', async () => {
  const h = harness();
  await h.controller.start();
  assert.equal(h.scheduledDelay, RECORDING_MAX_MS);
  h.fireTimer();
  h.fireTimer();
  assert.equal(h.controller.getSnapshot().notice, 'duration_reached');
  h.recorders[0]!.end();
  await settle();
  assert.equal(h.calls.transcripts.length, 1);
  await h.controller.start();
  h.controller.cancel();
  h.recorders[1]!.end();
  assert.equal(h.calls.transcripts.length, 1);
});

test('cancel during pending permission stops a late stream without recording', async () => {
  const h = harness();
  const permission = deferred<MicrophoneStream>();
  h.dependencies.getMicrophone = () => permission.promise;
  const start = h.controller.start();
  assert.equal(h.controller.getSnapshot().phase, 'requesting_permission');
  h.controller.cancel();
  permission.resolve(h.stream);
  await start;
  assert.equal(h.trackStops, 1);
  assert.equal(h.recorders.length, 0);
  assert.equal(h.calls.transcripts.length, 0);
});

test('oversized final audio chunk is discarded without upload', async () => {
  const h = harness();
  await h.controller.start();
  h.controller.finish();
  const recorder = h.recorders[0]!;
  recorder.ondata(new Blob([new Uint8Array(AUDIO_MAX_BYTES + 1)]));
  recorder.onstop();
  assert.equal(h.calls.transcripts.length, 0);
  assert.equal(h.controller.getSnapshot().errorCode, 'audio_too_large');
  assert.ok(h.trackStops > 0);
});

test('cancelled transcription cannot overwrite edited text', async () => {
  const response = deferred<{ transcript: string; request_id: string }>();
  const h = harness({ transcribe: () => response.promise });
  await h.controller.start();
  h.controller.finish();
  h.recorders[0]!.end();
  h.controller.editText('Newer text 12.34');
  assert.equal(h.calls.transcripts[0]!.signal.aborted, true);
  response.resolve({ transcript: 'stale response', request_id: 'old' });
  await settle();
  assert.equal(h.controller.getSnapshot().text, 'Newer text 12.34');
});

test('cancelled synthesis cannot allocate audio or start playback', async () => {
  const response = deferred<Blob>();
  const h = harness({ speak: () => response.promise });
  h.controller.setSpeechEnabled(true);
  h.controller.editText('Q3 revenue');
  const pending = h.controller.readBack();
  h.controller.editText('Q2 revenue');
  response.resolve(new Blob(['old speech'], { type: 'audio/mpeg' }));
  await pending;
  assert.equal(h.urls, 0);
  assert.equal(h.audio.plays, 0);
  assert.equal(h.controller.getSnapshot().text, 'Q2 revenue');
});

test('Repeat, Read back with unchanged text and playback speed reuse audio', async () => {
  const h = harness();
  h.controller.setSpeechEnabled(true);
  const text = 'Ngày 03/04, 1.250.000 đồng; USD 12.34.';
  h.controller.editText(text);
  await h.controller.readBack();
  h.controller.stopPlayback();
  await h.controller.play();
  h.controller.setPlaybackRate(1.5);
  h.controller.stopPlayback();
  await h.controller.readBack();
  assert.equal(h.calls.speech.length, 1);
  assert.equal(h.calls.speech[0]!.text, text);
  assert.equal(h.audio.playbackRate, 1.5);
  assert.equal(h.audio.plays, 3);
  assert.ok(h.audio.pauses >= 3);
});

test('editing text or language releases cached audio', async () => {
  const h = harness();
  h.controller.setSpeechEnabled(true);
  h.controller.editText('One');
  await h.controller.readBack();
  h.controller.editText('Two');
  assert.equal(h.controller.getSnapshot().hasAudio, false);
  assert.equal(h.audio.releases, 1);
  assert.deepEqual(h.revoked, ['blob:1']);
  await h.controller.readBack();
  h.controller.setLanguage('vi');
  assert.equal(h.controller.getSnapshot().hasAudio, false);
  assert.equal(h.audio.releases, 2);
  assert.equal(h.controller.getSnapshot().text, 'Two');
});

test('quota and timeout errors preserve text and allow an explicit retry', async () => {
  let attempt = 0;
  const h = harness({
    async speak() {
      attempt += 1;
      if (attempt < 3)
        throw { code: attempt === 1 ? 'QUOTA_EXHAUSTED' : 'TIMEOUT' };
      return new Blob(['mp3'], { type: 'audio/mpeg' });
    },
  });
  h.controller.editText('Preserve 123');
  h.controller.setSpeechEnabled(true);
  await h.controller.readBack();
  assert.equal(h.controller.getSnapshot().errorCode, 'quota_exhausted');
  await h.controller.readBack();
  assert.equal(h.controller.getSnapshot().errorCode, 'timeout');
  assert.equal(h.controller.getSnapshot().text, 'Preserve 123');
  await h.controller.readBack();
  assert.equal(h.controller.getSnapshot().phase, 'speaking');
  assert.equal(attempt, 3);
});

test('provider access errors surface actionable bilingual guidance without losing text or retrying', async () => {
  const h = harness({
    async speak() {
      throw new VoiceTransportError(
        'PROVIDER_ACCESS_REQUIRED',
        'The configured voice requires account changes.',
      );
    },
  });
  const text = 'Doanh thu 1.250.000 đồng; USD 12.34.';
  h.controller.editText(text);
  h.controller.setSpeechEnabled(true);
  await h.controller.readBack();
  const snapshot = h.controller.getSnapshot();
  assert.equal(snapshot.phase, 'error');
  assert.equal(snapshot.errorCode, 'provider_access_required');
  assert.equal(snapshot.text, text);
  assert.equal(snapshot.hasAudio, false);
  assert.equal(h.urls, 0);
  assert.match(errorText('en', snapshot.errorCode!), /eligible voice.*plan/);
  assert.match(errorText('vi', snapshot.errorCode!), /chọn giọng.*đổi gói/);
  await settle();
  await h.controller.play();
  h.controller.setPlaybackRate(1.5);
  assert.equal(h.calls.speech.length, 1);
  assert.equal(h.audio.plays, 0);
  h.controller.editText(`${text} Edited.`);
  assert.equal(h.controller.getSnapshot().phase, 'ready');
  assert.equal(h.calls.speech.length, 1);
});

test('logout disposal clears text/audio and aborts pending requests', async () => {
  const pending = deferred<Blob>();
  let first = true;
  const h = harness({
    speak: () => {
      if (first) {
        first = false;
        return Promise.resolve(new Blob(['mp3'], { type: 'audio/mpeg' }));
      }
      return pending.promise;
    },
  });
  h.controller.editText('Old');
  h.controller.setSpeechEnabled(true);
  await h.controller.readBack();
  h.controller.editText('New');
  const operation = h.controller.readBack();
  h.controller.dispose();
  assert.equal(h.calls.speech[1]!.signal.aborted, true);
  assert.equal(h.controller.getSnapshot().text, '');
  assert.equal(h.controller.getSnapshot().hasAudio, false);
  pending.resolve(new Blob(['late'], { type: 'audio/mpeg' }));
  await operation;
  assert.equal(h.audio.plays, 1);
  assert.equal(h.urls, 1);
});

test('Unicode code points, not UTF-16 units, bound read-back', async () => {
  const h = harness();
  h.controller.setSpeechEnabled(true);
  h.controller.editText('😀'.repeat(1000));
  await h.controller.readBack();
  assert.equal(h.calls.speech.length, 1);
  h.controller.editText('😀'.repeat(1001));
  await h.controller.readBack();
  assert.equal(h.calls.speech.length, 1);
  assert.equal(h.controller.getSnapshot().errorCode, 'invalid_text');
});

test('autoplay rejection keeps a playable result without another synthesis', async () => {
  const h = harness();
  h.controller.editText('Hello');
  h.controller.setSpeechEnabled(true);
  h.audio.fail = true;
  await h.controller.readBack();
  assert.equal(h.controller.getSnapshot().notice, 'autoplay_blocked');
  assert.equal(h.controller.getSnapshot().hasAudio, true);
  h.audio.fail = false;
  await h.controller.play();
  assert.equal(h.calls.speech.length, 1);
  assert.equal(h.controller.getSnapshot().phase, 'speaking');
});

test('voice opt-out never generates speech, while shortcut toggles recording/cancellation', async () => {
  const h = harness();
  h.controller.editText('Typed fallback');
  await h.controller.readBack();
  assert.equal(h.calls.speech.length, 0);
  h.controller.activate();
  await settle();
  assert.equal(h.controller.getSnapshot().phase, 'recording');
  h.controller.activate();
  assert.equal(h.controller.getSnapshot().phase, 'transcribing');
  h.controller.activate();
  h.recorders[0]!.end();
  assert.equal(h.calls.transcripts.length, 0);
});

test('empty result remains editable, recording format and filename stay matched', async () => {
  const h = harness({
    transcribe: async () => ({ transcript: '', request_id: 'empty' }),
  });
  await h.controller.start();
  h.controller.finish();
  h.recorders[0]!.end();
  await settle();
  assert.equal(h.controller.getSnapshot().notice, 'no_speech');
  h.controller.editText('Fallback');
  assert.equal(h.controller.getSnapshot().phase, 'ready');
  assert.equal(audioFilename('audio/ogg;codecs=opus'), 'recording.ogg');
  assert.equal(audioFilename('audio/mp4'), 'recording.m4a');
  assert.throws(() => audioFilename('text/html'));
});

test('turning speech off during synthesis aborts and discards its late result', async () => {
  const response = deferred<Blob>();
  const h = harness({ speak: () => response.promise });
  h.controller.editText('Screen reader only');
  h.controller.setSpeechEnabled(true);
  const pending = h.controller.readBack();
  h.controller.setSpeechEnabled(false);
  assert.equal(h.calls.speech[0]!.signal.aborted, true);
  response.resolve(new Blob(['late'], { type: 'audio/mpeg' }));
  await pending;
  assert.equal(h.urls, 0);
  assert.equal(h.audio.plays, 0);
  assert.equal(h.controller.getSnapshot().text, 'Screen reader only');
});

test('recorder stop failures cannot prevent microphone cleanup', async () => {
  const h = harness();
  await h.controller.start();
  h.recorders[0]!.stop = () => {
    throw new Error('Recorder already closed');
  };
  h.controller.cancel();
  assert.equal(h.trackStops, 1);
  assert.equal(h.controller.getSnapshot().phase, 'cancelled');
  assert.equal(h.calls.transcripts.length, 0);
});

test('disposing during permission setup releases the late stream', async () => {
  const h = harness();
  const response = deferred<MicrophoneStream>();
  h.dependencies.getMicrophone = () => response.promise;
  const pending = h.controller.start();
  h.controller.dispose();
  response.resolve(h.stream);
  await pending;
  assert.equal(h.trackStops, 1);
  assert.equal(h.recorders.length, 0);
});

test('Stop prevents a pending autoplay promise from restarting playback', async () => {
  const h = harness();
  const started = deferred<void>();
  h.audio.play = () => started.promise;
  h.controller.editText('Read once');
  h.controller.setSpeechEnabled(true);
  const operation = h.controller.readBack();
  await settle();
  assert.equal(h.controller.getSnapshot().phase, 'speaking');
  h.controller.stopPlayback();
  const pausesAtStop = h.audio.pauses;
  started.resolve();
  await operation;
  assert.ok(h.audio.pauses > pausesAtStop);
  assert.equal(h.controller.getSnapshot().notice, 'stopped');
});

test('repeated Read back clicks cannot submit concurrent synthesis requests', async () => {
  const response = deferred<Blob>();
  const h = harness({ speak: () => response.promise });
  h.controller.editText('Explicit request');
  h.controller.setSpeechEnabled(true);
  const first = h.controller.readBack();
  await h.controller.readBack();
  assert.equal(h.calls.speech.length, 1);
  response.resolve(new Blob(['mp3'], { type: 'audio/mpeg' }));
  await first;
});

test('fixed companion speed applies to generated, replayed and replaced audio', async () => {
  const h = harness({}, { fixedPlaybackRate: COMPANION_PLAYBACK_RATE });
  h.controller.setSpeechEnabled(true);
  h.controller.editText('Read the answer');
  await h.controller.readBack();
  assert.equal(h.audio.playbackRate, 0.9);
  h.controller.setPlaybackRate(2);
  assert.equal(h.controller.getSnapshot().playbackRate, 0.9);
  h.controller.stopPlayback();
  h.audio.playbackRate = 1;
  await h.controller.play();
  assert.equal(h.audio.playbackRate, 0.9);
  assert.equal(h.calls.speech.length, 1);
  h.controller.editText('A new answer');
  await h.controller.readBack();
  assert.equal(h.audio.playbackRate, 0.9);
  assert.equal(h.calls.speech.length, 2);
});

test('Stop during synthesis aborts immediately and a late result stays silent', async () => {
  const response = deferred<Blob>();
  const h = harness({ speak: () => response.promise });
  h.controller.setSpeechEnabled(true);
  h.controller.editText('The completed answer stays visible.');
  const pending = h.controller.readBack();
  h.controller.stopPlayback();
  assert.equal(h.calls.speech[0]!.signal.aborted, true);
  assert.equal(h.controller.getSnapshot().notice, 'stopped');
  response.resolve(new Blob(['late'], { type: 'audio/mpeg' }));
  await pending;
  assert.equal(h.audio.plays, 0);
  assert.equal(h.urls, 0);
  assert.equal(
    h.controller.getSnapshot().text,
    'The completed answer stays visible.',
  );
});

test('rapid Read and Play clicks do not restart a pending or active player', async () => {
  const h = harness();
  const started = deferred<void>();
  h.audio.play = () => {
    h.audio.plays += 1;
    return started.promise;
  };
  h.controller.editText('Read once');
  h.controller.setSpeechEnabled(true);
  const first = h.controller.readBack();
  await settle();
  await Promise.all([
    h.controller.readBack(),
    h.controller.play(),
    h.controller.play(),
  ]);
  assert.equal(h.calls.speech.length, 1);
  assert.equal(h.audio.plays, 1);
  started.resolve();
  await first;
  await h.controller.readBack();
  await h.controller.play();
  assert.equal(h.audio.plays, 1);
  h.audio.onended?.();
  await h.controller.play();
  assert.equal(h.audio.plays, 2);
  assert.equal(h.calls.speech.length, 1);
});

test('Speech OFF invalidates a pending play promise and ON does not resume it', async () => {
  const h = harness();
  const started = deferred<void>();
  h.audio.play = () => started.promise;
  h.controller.setSpeechEnabled(true);
  h.controller.editText('Use a screen reader instead');
  const pending = h.controller.readBack();
  await settle();
  h.controller.setSpeechEnabled(false);
  const pausesAtStop = h.audio.pauses;
  await h.controller.readBack();
  await h.controller.play();
  h.controller.setSpeechEnabled(true);
  started.resolve();
  await pending;
  assert.ok(h.audio.pauses > pausesAtStop);
  assert.equal(h.controller.getSnapshot().phase, 'ready');
  assert.equal(h.controller.getSnapshot().notice, 'stopped');
  assert.equal(h.calls.speech.length, 1);
});

test('disposing during a pending play stops it and releases cached resources', async () => {
  const h = harness();
  const started = deferred<void>();
  h.audio.play = () => started.promise;
  h.controller.setSpeechEnabled(true);
  h.controller.editText('Account A only');
  const pending = h.controller.readBack();
  await settle();
  h.controller.dispose();
  const pausesAtDisposal = h.audio.pauses;
  started.resolve();
  await pending;
  assert.ok(h.audio.pauses > pausesAtDisposal);
  assert.equal(h.audio.releases, 1);
  assert.deepEqual(h.revoked, ['blob:1']);
  assert.equal(h.controller.getSnapshot().hasAudio, false);
  assert.equal(h.controller.getSnapshot().text, '');
});

test('a decoding failure discards broken audio but preserves text for explicit retry', async () => {
  const h = harness();
  h.controller.setSpeechEnabled(true);
  h.controller.editText('The answer and evidence remain available.');
  h.audio.play = async () => {
    throw new DOMException('Unsupported audio', 'NotSupportedError');
  };
  await h.controller.readBack();
  assert.equal(h.controller.getSnapshot().hasAudio, false);
  assert.equal(h.controller.getSnapshot().errorCode, 'playback_failed');
  assert.equal(
    h.controller.getSnapshot().text,
    'The answer and evidence remain available.',
  );
  assert.deepEqual(h.revoked, ['blob:1']);
  await h.controller.play();
  assert.equal(h.calls.speech.length, 1);
  h.audio.play = async () => {
    h.audio.plays += 1;
  };
  await h.controller.readBack();
  assert.equal(h.calls.speech.length, 2);
  assert.equal(h.controller.getSnapshot().phase, 'speaking');
});

test('a media error after playback started discards the invalid cache', async () => {
  const h = harness();
  h.controller.setSpeechEnabled(true);
  h.controller.editText('Keep the answer');
  await h.controller.readBack();
  h.audio.onerror?.();
  assert.equal(h.controller.getSnapshot().errorCode, 'playback_failed');
  assert.equal(h.controller.getSnapshot().hasAudio, false);
  assert.equal(h.controller.getSnapshot().text, 'Keep the answer');
  assert.deepEqual(h.revoked, ['blob:1']);
});

test('cancellation from a state subscriber prevents work before synthesis and playback', async () => {
  const h = harness();
  h.controller.setSpeechEnabled(true);
  h.controller.editText('Stop before starting');
  const unsubscribe = h.controller.subscribe(() => {
    if (h.controller.getSnapshot().phase === 'generating')
      h.controller.stopPlayback();
  });
  await h.controller.readBack();
  assert.equal(h.calls.speech.length, 0);
  unsubscribe();
  h.controller.subscribe(() => {
    if (h.controller.getSnapshot().notice === 'play_ready')
      h.controller.stopPlayback();
  });
  await h.controller.readBack();
  assert.equal(h.calls.speech.length, 1);
  assert.equal(h.audio.plays, 0);
});

test('a stopped play promise cannot stop a newer deliberate replay of the same audio', async () => {
  const h = harness();
  const oldPlay = deferred<void>();
  h.audio.play = () => oldPlay.promise;
  h.controller.setSpeechEnabled(true);
  h.controller.editText('The same cached answer');
  const pending = h.controller.readBack();
  await settle();
  h.controller.stopPlayback();
  h.audio.play = async () => {
    h.audio.plays += 1;
  };
  await h.controller.play();
  const pausesBeforeOldResolution = h.audio.pauses;
  oldPlay.resolve();
  await pending;
  assert.equal(h.audio.pauses, pausesBeforeOldResolution);
  assert.equal(h.controller.getSnapshot().phase, 'speaking');
  assert.equal(h.calls.speech.length, 1);
});

test('starting a recording aborts old synthesis and ignores the late audio', async () => {
  const response = deferred<Blob>();
  const h = harness({ speak: () => response.promise });
  h.controller.setSpeechEnabled(true);
  h.controller.editText('The previous response');
  const synthesis = h.controller.readBack();
  await h.controller.start();
  assert.equal(h.calls.speech[0]!.signal.aborted, true);
  assert.equal(h.controller.getSnapshot().phase, 'recording');
  response.resolve(new Blob(['old'], { type: 'audio/mpeg' }));
  await synthesis;
  assert.equal(h.audio.plays, 0);
  assert.equal(h.urls, 0);
  assert.equal(h.controller.getSnapshot().phase, 'recording');
  h.controller.cancel();
});

test('late media events from a stopped attempt cannot change a new playback state', async () => {
  const h = harness();
  h.controller.setSpeechEnabled(true);
  h.controller.editText('Replay this response');
  await h.controller.readBack();
  const oldEnded = h.audio.onended;
  const oldError = h.audio.onerror;
  h.controller.stopPlayback();
  await h.controller.play();
  oldEnded?.();
  oldError?.();
  assert.equal(h.controller.getSnapshot().phase, 'speaking');
  assert.equal(h.controller.getSnapshot().hasAudio, true);
  assert.equal(h.controller.getSnapshot().errorCode, null);
  assert.equal(h.calls.speech.length, 1);
});

test('five seconds of silence after activity finishes one recording with its final chunk', async () => {
  const h = silenceHarness({
    transcribe: async () => ({
      transcript: 'Compare August with July',
      request_id: 'silence',
    }),
  });
  let cues = 0;
  h.dependencies.cue = () => {
    assert.ok(
      h.trackStops > 0,
      'Completion cue happens after microphone tracks stop',
    );
    cues++;
  };
  h.controller.setAudioFeedback(true);
  await h.controller.start();
  const recorder = h.recorders[0]!;
  recorder.ondata(new Blob(['first phrase']));
  assert.equal(cues, 0, 'No start cue can enter the silence detector');
  h.advance(5_000);
  assert.equal(h.controller.getSnapshot().phase, 'recording');
  assert.equal(
    h.controller.getSnapshot().silenceSecondsRemaining,
    null,
    'Initial quiet does not auto-submit',
  );
  h.activity();
  assert.equal(h.controller.getSnapshot().silenceSecondsRemaining, 5);
  h.advance(4_900);
  assert.equal(h.controller.getSnapshot().silenceSecondsRemaining, 1);
  h.activity();
  recorder.ondata(new Blob([' and continuation']));
  assert.equal(h.controller.getSnapshot().silenceSecondsRemaining, 5);
  h.advance(4_999);
  assert.equal(
    recorder.stops,
    0,
    'Continued speech resets the same recording deadline',
  );
  h.advance(1);
  assert.equal(recorder.stops, 1);
  assert.equal(h.controller.getSnapshot().notice, 'silence_reached');
  assert.equal(h.controller.getSnapshot().silenceSecondsRemaining, null);
  assert.equal(
    h.calls.transcripts.length,
    0,
    'Wait for the final recording chunk',
  );
  h.activity();
  h.controller.finish('silence');
  recorder.end(' final word');
  recorder.onstop();
  await settle();
  assert.equal(h.calls.transcripts.length, 1);
  assert.equal(
    await h.calls.transcripts[0]!.blob.text(),
    'first phrase and continuation final word',
  );
  assert.equal(cues, 1);
  assert.equal(
    h.controller.claimAutomaticQuestion(),
    'Compare August with July',
  );
  assert.equal(
    h.controller.claimAutomaticQuestion(),
    null,
    'The completed transcript is claimable once',
  );
  assert.equal(h.observerStops, 1);
  assert.equal(h.observerSignal?.aborted, true);
  assert.equal(h.timerCount, 0);
});

test('Stop and review disarms a silence completion before the final chunk or during transcription', async () => {
  for (const reviewAt of ['final-chunk', 'transcription'] as const) {
    const response = deferred<{ transcript: string; request_id: string }>();
    const h = silenceHarness({ transcribe: () => response.promise });
    await h.controller.start();
    const recorder = h.recorders[0]!;
    recorder.ondata(new Blob(['first phrase;']));
    h.activity();
    h.advance(5_000);
    assert.equal(h.controller.getSnapshot().notice, 'silence_reached');
    assert.equal(recorder.stops, 1);
    if (reviewAt === 'final-chunk') h.controller.finish();
    recorder.end('final word');
    if (reviewAt === 'transcription') h.controller.finish();
    h.controller.finish();
    h.controller.finish('silence');
    recorder.onstop();
    assert.equal(h.calls.transcripts.length, 1);
    assert.equal(h.calls.transcripts[0]!.signal.aborted, false);
    assert.equal(h.controller.getSnapshot().notice, 'transcribing');
    assert.equal(
      await h.calls.transcripts[0]!.blob.text(),
      'first phrase;final word',
    );
    response.resolve({
      transcript: 'Compare the current chart, including 1.25.',
      request_id: 'review',
    });
    await settle();
    assert.equal(
      h.controller.getSnapshot().text,
      'Compare the current chart, including 1.25.',
    );
    assert.equal(h.controller.getSnapshot().phase, 'ready');
    assert.equal(h.controller.claimAutomaticQuestion(), null, reviewAt);
    assert.equal(h.calls.transcripts.length, 1);
    assert.equal(recorder.stops, 1);
    assert.ok(h.trackStops > 0);
    h.controller.dispose();
  }
});

test('manual Finish and the 30-second cap preserve review without automatic submission', async () => {
  for (const finish of ['manual', 'limit'] as const) {
    const h = silenceHarness();
    await h.controller.start();
    if (finish === 'limit') h.advance(29_000);
    h.activity();
    if (finish === 'manual') h.controller.finish();
    else h.advance(1_000);
    assert.equal(
      h.controller.getSnapshot().notice,
      finish === 'limit' ? 'duration_reached' : 'transcribing',
    );
    h.recorders[0]!.end();
    await settle();
    assert.equal(h.calls.transcripts.length, 1);
    assert.equal(h.controller.claimAutomaticQuestion(), null);
    assert.equal(h.observerStops, 1);
    assert.equal(h.timerCount, 0);
  }
});

test('an opted-in 60-second cap preserves the default 30-second deadline elsewhere', async () => {
  for (const maxRecordingMs of [undefined, 60_000]) {
    const h = silenceHarness({}, maxRecordingMs ? { maxRecordingMs } : {});
    await h.controller.start();
    const recorder = h.recorders[0]!;
    const duration = maxRecordingMs ?? RECORDING_MAX_MS;
    h.advance(duration - 1);
    assert.equal(recorder.stops, 0);
    assert.equal(h.controller.getSnapshot().phase, 'recording');
    h.advance(1);
    assert.equal(recorder.stops, 1);
    assert.equal(h.controller.getSnapshot().notice, 'duration_reached');
    recorder.end('exact typed transcript stays unchanged');
    await settle();
    assert.equal(h.calls.transcripts.length, 1);
    assert.equal(h.controller.claimAutomaticQuestion(), null);
    assert.equal(h.timerCount, 0);
    h.controller.dispose();
  }
});

test('recording duration configuration rejects values outside the bounded integer range', () => {
  for (const maxRecordingMs of [
    0,
    -1,
    60_001,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])
    assert.throws(() => harness({}, { maxRecordingMs }), RangeError);
});

test('opted-in silence cues count 5 through 1 once each and ignore their own speaker activity', async () => {
  const transcript = 'Keep the exact words, 1.25, and punctuation.';
  const h = silenceHarness(
    { transcribe: async () => ({ transcript, request_id: 'cue' }) },
    {
      silenceCountdownCues: true,
      maxRecordingMs: 60_000,
    },
  );
  const cues: {
    kind: string | undefined;
    second: number | null;
    at: number;
  }[] = [];
  h.dependencies.cue = (kind) => {
    cues.push({
      kind,
      second: h.controller.getSnapshot().silenceSecondsRemaining,
      at: h.dependencies.now!(),
    });
    if (kind === 'countdown') {
      h.activity();
      h.dependencies.schedule(() => h.activity(), 150);
    } else assert.ok(h.trackStops > 0, 'Submit sound occurs after tracks stop');
  };
  h.controller.setAudioFeedback(true);
  await h.controller.start();
  h.advance(2_000);
  assert.equal(cues.length, 0, 'Initial quiet is not a countdown');
  // Sustained user speech must not cause repeated 5-second cue ticks.
  for (let index = 0; index < 10; index++) {
    h.activity();
    h.advance(50);
  }
  assert.equal(cues.length, 0);
  h.advance(4_950);
  assert.deepEqual(
    cues.map((cue) => cue.second),
    [5, 4, 3, 2, 1],
  );
  assert.ok(
    cues.every(
      (cue, index) => index === 0 || cue.at - cues[index - 1]!.at >= 1_000,
    ),
  );
  assert.equal(
    h.recorders[0]!.stops,
    1,
    'Own tones never extend the silence deadline',
  );
  h.recorders[0]!.end('recorded words');
  h.recorders[0]!.onstop();
  await settle();
  assert.equal(cues.filter((cue) => cue.kind === 'submit').length, 1);
  assert.equal(h.calls.transcripts.length, 1);
  assert.equal(h.controller.getSnapshot().text, transcript);
  assert.equal(h.controller.claimAutomaticQuestion(), transcript);
  assert.equal(h.controller.claimAutomaticQuestion(), null);
  assert.equal(h.timerCount, 0);
  h.controller.dispose();
});

test('real speech after a countdown tone resets the timer without duplicate or rapid cues', async () => {
  const h = silenceHarness({}, { silenceCountdownCues: true });
  const cues: { second: number | null; at: number }[] = [];
  h.dependencies.cue = (kind) => {
    if (kind === 'countdown')
      cues.push({
        second: h.controller.getSnapshot().silenceSecondsRemaining,
        at: h.dependencies.now!(),
      });
  };
  h.controller.setAudioFeedback(true);
  await h.controller.start();
  h.activity();
  h.advance(1_500);
  assert.deepEqual(
    cues.map((cue) => cue.second),
    [5, 4],
  );
  h.activity();
  h.activity();
  assert.equal(h.controller.getSnapshot().silenceSecondsRemaining, 5);
  h.advance(4_999);
  assert.equal(h.recorders[0]!.stops, 0);
  h.advance(1);
  assert.equal(h.recorders[0]!.stops, 1);
  assert.deepEqual(
    cues.map((cue) => cue.second),
    [5, 4, 5, 4, 3, 2, 1],
  );
  assert.ok(
    cues.every(
      (cue, index) => index === 0 || cue.at - cues[index - 1]!.at >= 1_000,
    ),
  );
  h.controller.cancel();
});

test('countdown sounds require both opt-ins and feedback can be disabled mid-countdown', async () => {
  for (const options of [{}, { silenceCountdownCues: true }]) {
    const h = silenceHarness({}, options);
    const cues: unknown[] = [];
    h.dependencies.cue = (kind) => cues.push(kind);
    if (!options.silenceCountdownCues) h.controller.setAudioFeedback(true);
    await h.controller.start();
    h.activity();
    h.advance(5_000);
    assert.equal(cues.length, 0);
    h.controller.cancel();
  }
  const h = silenceHarness({}, { silenceCountdownCues: true });
  const cues: unknown[] = [];
  h.dependencies.cue = (kind) => cues.push(kind);
  h.controller.setAudioFeedback(true);
  await h.controller.start();
  h.activity();
  h.advance(150);
  assert.equal(cues.length, 1);
  h.controller.setAudioFeedback(false);
  h.advance(5_000);
  h.recorders[0]!.end();
  await settle();
  assert.equal(cues.length, 1);
  h.controller.dispose();
});

test('Stop and review or cancellation clear cue timers and never play a submit tone', async () => {
  for (const action of ['finish', 'cancel', 'dispose'] as const) {
    const h = silenceHarness({}, { silenceCountdownCues: true });
    const cues: unknown[] = [];
    h.dependencies.cue = (kind) => cues.push(kind);
    h.controller.setAudioFeedback(true);
    await h.controller.start();
    h.activity();
    h.advance(150);
    assert.equal(cues.length, 1);
    h.controller[action]();
    h.activity();
    h.advance(60_000);
    h.recorders[0]!.end('review this exact question');
    h.recorders[0]!.onstop();
    await settle();
    assert.equal(cues.length, 1, action);
    assert.equal(h.controller.claimAutomaticQuestion(), null);
    assert.equal(h.calls.transcripts.length, action === 'finish' ? 1 : 0);
    assert.equal(h.timerCount, 0);
    h.controller.dispose();
  }
});

test('subscriber cancellation at a countdown update prevents a late tone or timer', async () => {
  const h = silenceHarness({}, { silenceCountdownCues: true });
  let cues = 0;
  h.dependencies.cue = () => {
    cues++;
  };
  h.controller.setAudioFeedback(true);
  await h.controller.start();
  h.activity();
  const remove = h.controller.subscribe(() => {
    if (h.controller.getSnapshot().silenceSecondsRemaining === 5)
      h.controller.cancel();
  });
  h.advance(150);
  assert.equal(cues, 0);
  assert.equal(h.timerCount, 0);
  remove();
  h.controller.dispose();
});

test('Cancel discards a silent recording and ignores detector and recorder callbacks', async () => {
  const h = silenceHarness();
  await h.controller.start();
  h.activity();
  h.advance(4_900);
  h.controller.cancel();
  h.activity();
  h.advance(10_000);
  h.recorders[0]!.end();
  await settle();
  assert.equal(h.calls.transcripts.length, 0);
  assert.equal(h.controller.claimAutomaticQuestion(), null);
  assert.equal(h.controller.getSnapshot().silenceSecondsRemaining, null);
  assert.equal(h.observerSignal?.aborted, true);
  assert.equal(h.observerStops, 1);
  assert.equal(h.timerCount, 0);
});

test('a detector that resolves after disposal is immediately released', async () => {
  const h = silenceHarness();
  const observer = deferred<() => void>();
  let signal: AbortSignal | undefined;
  let stops = 0;
  h.dependencies.observeAudioActivity = (_stream, _activity, abortSignal) => {
    signal = abortSignal;
    return observer.promise;
  };
  await h.controller.start();
  h.controller.dispose();
  assert.equal(signal?.aborted, true);
  observer.resolve(() => {
    stops++;
  });
  await settle();
  assert.equal(stops, 1);
  assert.equal(h.trackStops, 1);
  assert.equal(h.timerCount, 0);
  assert.equal(h.controller.claimAutomaticQuestion(), null);
});

test('unavailable analysis keeps manual recording and the existing duration cap usable', async () => {
  for (const missing of [true, false]) {
    const h = silenceHarness();
    if (missing) delete h.dependencies.observeAudioActivity;
    else
      h.dependencies.observeAudioActivity = async () => {
        throw new Error('AudioContext cannot start');
      };
    await h.controller.start();
    await settle();
    assert.equal(h.controller.getSnapshot().phase, 'recording');
    assert.equal(h.controller.getSnapshot().notice, 'silence_unavailable');
    h.advance(30_000);
    h.recorders[0]!.end();
    await settle();
    assert.equal(h.calls.transcripts.length, 1);
    assert.equal(h.controller.claimAutomaticQuestion(), null);
  }
});

test('empty silence transcription and a cancelled late transcription cannot auto-submit', async () => {
  for (const result of ['empty', 'cancelled'] as const) {
    const response = deferred<{ transcript: string; request_id: string }>();
    const h = silenceHarness({ transcribe: () => response.promise });
    await h.controller.start();
    h.activity();
    h.advance(5_000);
    h.recorders[0]!.end();
    if (result === 'cancelled') h.controller.cancel();
    response.resolve({
      transcript: result === 'empty' ? '' : 'An old request',
      request_id: 'late',
    });
    await settle();
    assert.equal(h.controller.claimAutomaticQuestion(), null);
    assert.equal(h.controller.getSnapshot().text, '');
  }
});

test('editing, cancellation, clearing, starting again and disposal invalidate an unclaimed transcript', async () => {
  for (const action of [
    'edit',
    'cancel',
    'clear',
    'start',
    'dispose',
  ] as const) {
    const h = silenceHarness();
    await h.controller.start();
    h.activity();
    h.advance(5_000);
    h.recorders[0]!.end();
    await settle();
    if (action === 'edit') h.controller.editText('My reviewed question');
    else if (action === 'start') await h.controller.start();
    else h.controller[action]();
    assert.equal(h.controller.claimAutomaticQuestion(), null, action);
    h.controller.dispose();
  }
});

test('a late old recorder stop cannot clear the new recording countdown', async () => {
  const h = silenceHarness();
  await h.controller.start();
  const old = h.recorders[0]!;
  h.controller.cancel();
  await h.controller.start();
  h.activity();
  old.end();
  assert.equal(h.controller.getSnapshot().silenceSecondsRemaining, 5);
  assert.equal(h.controller.getSnapshot().phase, 'recording');
  h.controller.dispose();
});

test('analysis suspension cancels an armed silence deadline and falls back to manual Finish', async () => {
  const h = silenceHarness();
  await h.controller.start();
  h.activity();
  h.advance(4_000);
  h.unavailable();
  h.activity();
  h.advance(5_000);
  assert.equal(h.controller.getSnapshot().phase, 'recording');
  assert.equal(h.controller.getSnapshot().notice, 'silence_unavailable');
  assert.equal(h.controller.getSnapshot().silenceSecondsRemaining, null);
  assert.equal(h.recorders[0]!.stops, 0);
  assert.equal(h.observerSignal?.aborted, true);
  assert.equal(h.observerStops, 1);
  h.controller.finish();
  h.recorders[0]!.end();
  await settle();
  assert.equal(h.calls.transcripts.length, 1);
  assert.equal(h.controller.claimAutomaticQuestion(), null);
});

test('validated application limits identify the failing operation, preserve text and clear on explicit recovery', async () => {
  const usage: UsageLimit = {
    minute_count: 24,
    minute_limit: 24,
    day_count: 73,
    day_limit: 240,
    limited_by: 'minute',
    retry_after_seconds: 42,
    retry_at: '2026-09-21T00:01:00.000Z',
  };
  let fail = true;
  const h = harness({
    transcribe: async () => {
      throw new VoiceTransportError('APP_RATE_LIMITED', 'Request limit', usage);
    },
    speak: async () => {
      if (fail)
        throw new VoiceTransportError(
          'APP_RATE_LIMITED',
          'Request limit',
          usage,
        );
      return new Blob(['audio'], { type: 'audio/mpeg' });
    },
  });
  h.controller.editText('Preserve the earlier question');
  await h.controller.start();
  h.controller.finish();
  h.recorders[0]!.end();
  await settle();
  assert.deepEqual(h.controller.getSnapshot().errorUsage, usage);
  assert.equal(h.controller.getSnapshot().errorOperation, 'transcribe');
  assert.equal(
    h.controller.getSnapshot().text,
    'Preserve the earlier question',
  );
  assert.match(
    errorText('en', 'app_rate_limited', 'transcribe'),
    /^Transcription could not finish\./,
  );
  assert.match(
    errorText('vi', 'app_rate_limited', 'transcribe'),
    /^Chưa thể hoàn tất chép lời\./,
  );
  h.controller.editText('The completed answer');
  assert.equal(h.controller.getSnapshot().errorUsage, null);
  assert.equal(h.controller.getSnapshot().errorOperation, null);
  h.controller.setSpeechEnabled(true);
  await h.controller.readBack();
  assert.equal(h.controller.getSnapshot().errorOperation, 'speak');
  assert.deepEqual(h.controller.getSnapshot().errorUsage, usage);
  assert.equal(h.controller.getSnapshot().text, 'The completed answer');
  assert.match(
    errorText('en', 'app_rate_limited', 'speak'),
    /^Read-back audio could not be generated\./,
  );
  await settle();
  assert.equal(
    h.calls.speech.length,
    1,
    'The stored retry estimate never automatically resubmits',
  );
  fail = false;
  await h.controller.readBack();
  assert.equal(h.controller.getSnapshot().errorCode, null);
  assert.equal(h.controller.getSnapshot().errorUsage, null);
  assert.equal(h.controller.getSnapshot().errorOperation, null);
  assert.equal(h.calls.speech.length, 2);
  h.controller.dispose();
});

test('unvalidated or provider usage data cannot appear as application counters', async () => {
  const valid: UsageLimit = {
    minute_count: 12,
    minute_limit: 12,
    day_count: 30,
    day_limit: 80,
    limited_by: 'minute',
    retry_after_seconds: 10,
    retry_at: '2026-09-21T00:01:00.000Z',
  };
  for (const error of [
    { code: 'APP_RATE_LIMITED', usage: { ...valid, day_count: -1 } },
    { code: 'APP_RATE_LIMITED', usage: { ...valid, retry_at: 'not a date' } },
    {
      code: 'APP_RATE_LIMITED',
      usage: { ...valid, retry_after_seconds: 100_000 },
    },
    { code: 'PROVIDER_RATE_LIMITED', usage: valid },
    { code: 'RATE_LIMITED', usage: valid },
  ]) {
    const h = harness({
      speak: async () => {
        throw error;
      },
    });
    h.controller.editText('Text remains');
    h.controller.setSpeechEnabled(true);
    await h.controller.readBack();
    assert.equal(h.controller.getSnapshot().errorUsage, null);
    assert.equal(h.controller.getSnapshot().text, 'Text remains');
    h.controller.cancel();
    assert.equal(h.controller.getSnapshot().errorOperation, null);
  }
  assert.match(
    errorText('en', 'rate_limited'),
    /source and retry time were not provided/,
  );
  assert.match(
    errorText('en', 'provider_rate_limited'),
    /ElevenLabs temporarily/,
  );
  assert.doesNotMatch(
    errorText('en', 'rate_limited'),
    /ElevenLabs|VSual application/,
  );
});
