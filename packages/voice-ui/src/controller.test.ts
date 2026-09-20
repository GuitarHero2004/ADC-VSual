import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AUDIO_MAX_BYTES, RECORDING_MAX_MS } from '@adc/contracts';
import {
  VoiceController,
  audioFilename,
  type MicrophoneStream,
  type Playback,
  type Recorder,
  type VoiceDependencies,
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
    if (this.fail) throw new Error('Autoplay blocked');
  }
  pause() {
    this.pauses += 1;
  }
  release() {
    this.releases += 1;
  }
}

function harness(overrides: Partial<VoiceTransport> = {}) {
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
  const controller = new VoiceController(transport, dependencies);
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
  assert.equal(h.controller.getSnapshot().notice, 'play_ready');
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
