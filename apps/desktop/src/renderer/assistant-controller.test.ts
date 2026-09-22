import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DesktopCaptureTicket, DesktopSource } from '../bridge.ts';
import type { DesktopResponse } from '@adc/contracts';
import {
  DesktopAssistantController,
  type CapturedWindowFrame,
} from './assistant-controller.ts';
import {
  assistantHarness,
  answerFor,
  deferred,
  session,
  settle,
  source,
} from './test-helpers.ts';

async function ready(h = assistantHarness()) {
  const controller = new DesktopAssistantController(
    h.bridge,
    session.epoch,
    h.dependencies,
  );
  await controller.useActiveSource();
  controller.editQuestion('What is the revenue?');
  return { ...h, controller };
}

test('only Ask captures once, answers immediately and speaks once at 0.9; repeat reuses audio', async () => {
  const h = await ready();
  const pendingAudio = deferred<ArrayBuffer>();
  let speechRequests = 0;
  h.bridge.speak = async () => {
    speechRequests++;
    return pendingAudio.promise;
  };
  try {
    assert.equal(
      h.calls.captures,
      0,
      'enumeration, selection and typing must not acquire pixels',
    );
    const asking = h.controller.ask();
    await h.controller.ask();
    await asking;
    assert.equal(h.calls.captures, 1);
    assert.equal(h.calls.reads.length, 1);
    assert.equal(
      h.controller.getSnapshot().answer?.response.text,
      'Revenue is 1,200.',
    );
    assert.equal(h.controller.speech.getSnapshot().phase, 'generating');
    assert.equal(speechRequests, 1);
    assert.ok(
      new Uint8Array(h.calls.reads[0]!.bytes).every((byte) => byte === 0),
      'renderer screenshot buffer is wiped',
    );
    const audioBytes = new Uint8Array([1, 2, 3]).buffer;
    pendingAudio.resolve(audioBytes);
    await settle();
    assert.equal(h.playbacks[0]?.playbackRate, 0.9);
    assert.equal(h.playbacks[0]?.plays, 1);
    assert.ok(new Uint8Array(audioBytes).every((byte) => byte === 0));
    h.controller.speech.stopPlayback();
    await h.controller.speech.readBack();
    assert.equal(h.playbacks[0]?.plays, 2);
    assert.equal(speechRequests, 1);
  } finally {
    h.controller.dispose();
  }
});

test('desktop always speaks each new answer; Stop preserves text and explicit Repeat reuses audio', async () => {
  const h = await ready();
  try {
    assert.equal(h.controller.speech.getSnapshot().speechEnabled, true);
    await h.controller.ask();
    await settle();
    assert.equal(h.calls.speech.length, 1);
    h.controller.speech.stopPlayback();
    assert.equal(h.controller.speech.getSnapshot().phase, 'ready');
    assert.equal(
      h.controller.getSnapshot().answer?.response.text,
      'Revenue is 1,200.',
    );
    await h.controller.speech.readBack();
    assert.equal(h.calls.speech.length, 1);
    await h.controller.ask('What else is shown?');
    await settle();
    assert.equal(h.calls.speech.length, 2);
  } finally {
    h.controller.dispose();
  }
});

test('cancellation at preparation or capture rejects late work and preserves the question', async () => {
  const h = await ready();
  const ticket = deferred<DesktopCaptureTicket>();
  let requestId = '';
  h.bridge.prepareCapture = async (_id, id) => {
    requestId = id;
    return ticket.promise;
  };
  try {
    const asking = h.controller.ask();
    h.controller.cancel();
    ticket.resolve({
      ...source,
      requestId,
      epoch: session.epoch,
      captureId: crypto.randomUUID(),
    });
    await asking;
    assert.equal(h.calls.captures, 0);
    assert.equal(
      h.controller.question.getSnapshot().text,
      'What is the revenue?',
    );
    assert.ok(h.calls.cancelled.includes(requestId));
    h.bridge.prepareCapture = async (_id, id) => ({
      ...source,
      requestId: id,
      epoch: session.epoch,
      captureId: crypto.randomUUID(),
    });
    const frame = deferred<CapturedWindowFrame>();
    let captureSignal: AbortSignal | undefined;
    h.dependencies.capture = async (signal) => {
      captureSignal = signal;
      return frame.promise;
    };
    const capturing = h.controller.ask();
    await settle();
    h.controller.cancel();
    assert.equal(captureSignal?.aborted, true);
    const bytes = new Uint8Array([9, 8, 7]).buffer;
    frame.resolve({
      bytes,
      width: 50,
      height: 50,
      capturedAt: new Date().toISOString(),
    });
    await capturing;
    assert.equal(h.calls.reads.length, 0);
    assert.ok(new Uint8Array(bytes).every((byte) => byte === 0));
  } finally {
    h.controller.dispose();
  }
});

test('new work rejects stale answers and session disposal cancels and clears every transient value', async () => {
  const h = await ready();
  const oldAnswer = deferred<DesktopResponse>();
  let oldId = '';
  h.bridge.readScreen = async (input) => {
    oldId = input.requestId;
    return oldAnswer.promise;
  };
  const first = h.controller.ask();
  await settle();
  h.controller.cancel();
  h.bridge.readScreen = async (input) =>
    answerFor(input.requestId, 'New answer.');
  await h.controller.ask();
  oldAnswer.resolve(answerFor(oldId, 'Stale answer.'));
  await first;
  await settle();
  assert.equal(h.controller.getSnapshot().answer?.response.text, 'New answer.');
  assert.deepEqual(h.calls.speech, ['New answer.']);
  h.controller.dispose();
  assert.equal(h.controller.getSnapshot().answer, null);
  assert.equal(h.controller.question.getSnapshot().text, '');
  assert.equal(h.controller.speech.getSnapshot().text, '');
  assert.equal(h.playbacks[0]?.releases, 1);
  assert.equal(h.revoked.length, 1);
});

test('autoplay blocked audio is cached and stale speech after Stop or disposal never plays', async () => {
  const h = await ready();
  try {
    h.setPlaybackBlocked(true);
    await h.controller.ask();
    await settle();
    assert.equal(h.controller.speech.getSnapshot().notice, 'autoplay_blocked');
    assert.equal(h.controller.speech.getSnapshot().hasAudio, true);
    h.setPlaybackBlocked(false);
    await h.controller.speech.readBack();
    assert.equal(h.calls.speech.length, 1);
    assert.equal(h.playbacks[0]?.plays, 2);
    const lateAudio = deferred<ArrayBuffer>();
    h.bridge.speak = () => lateAudio.promise;
    await h.controller.ask();
    h.controller.speech.stopPlayback();
    const bytes = new Uint8Array([4, 5]).buffer;
    lateAudio.resolve(bytes);
    await settle();
    assert.equal(h.playbacks.length, 1);
    assert.ok(new Uint8Array(bytes).every((byte) => byte === 0));
    assert.ok(h.calls.cancelled.length > 0);
  } finally {
    h.controller.dispose();
  }
});

test('five seconds of silence submits once; manual finish only transcribes and recording stops answer audio', async () => {
  const h = await ready();
  try {
    await h.controller.ask();
    await settle();
    await h.controller.startRecording();
    assert.equal(h.controller.speech.getSnapshot().phase, 'ready');
    assert.ok(h.playbacks[0]!.pauses > 0);
    h.advance(300);
    h.activity();
    h.advance(4_000);
    assert.equal(h.calls.transcriptions, 0);
    h.activity();
    h.advance(4_000);
    assert.equal(h.calls.transcriptions, 0);
    h.advance(1_000);
    await settle();
    assert.equal(h.calls.transcriptions, 1);
    assert.equal(h.calls.captures, 2);
    assert.equal(h.controller.question.claimAutomaticQuestion(), null);
    await h.controller.startRecording();
    h.controller.question.finish();
    await settle();
    assert.equal(h.calls.transcriptions, 2);
    assert.equal(
      h.calls.captures,
      2,
      'Stop and review does not submit a screen request',
    );
    await h.controller.startRecording();
    h.controller.cancel();
    await settle();
    assert.equal(
      h.calls.transcriptions,
      2,
      'cancelling recording discards audio',
    );
    assert.ok(h.calls.trackStops >= 3);
  } finally {
    h.controller.dispose();
  }
});

test('invalid question, missing source, wrong capture epoch and mismatched answer never speak', async () => {
  const h = await ready();
  try {
    await h.controller.ask('');
    assert.equal(h.controller.getSnapshot().errorCode, 'invalid_question');
    h.bridge.getActiveSource = async () => null;
    await h.controller.useActiveSource();
    await h.controller.ask('Read this');
    assert.equal(h.controller.getSnapshot().errorCode, 'source_required');
    h.bridge.getActiveSource = async () => source;
    await h.controller.useActiveSource();
    h.bridge.prepareCapture = async (_id, requestId) => ({
      ...source,
      requestId,
      captureId: crypto.randomUUID(),
      epoch: 'old-session',
    });
    await h.controller.ask();
    assert.equal(h.controller.getSnapshot().errorCode, 'session_expired');
    assert.equal(h.calls.captures, 0);
    h.bridge.prepareCapture = async (_id, requestId) => ({
      ...source,
      requestId,
      captureId: crypto.randomUUID(),
      epoch: session.epoch,
    });
    h.bridge.readScreen = async () => answerFor(crypto.randomUUID());
    await h.controller.ask();
    assert.equal(h.controller.getSnapshot().errorCode, 'invalid_response');
    assert.equal(h.controller.getSnapshot().answer, null);
    assert.equal(h.calls.speech.length, 0);
  } finally {
    h.controller.dispose();
  }
});

test('foreground selection uses metadata only and newer activation wins over a late source', async () => {
  const h = assistantHarness();
  const controller = new DesktopAssistantController(
    h.bridge,
    session.epoch,
    h.dependencies,
  );
  try {
    await controller.useActiveSource();
    assert.equal(controller.getSnapshot().sourceId, source.id);
    assert.equal(h.calls.captures, 0);
    assert.equal(h.calls.transcriptions, 0);
    assert.equal(h.calls.speech.length, 0);
    const oldSource = deferred<DesktopSource | null>();
    h.bridge.getActiveSource = () => oldSource.promise;
    const oldActivation = controller.useActiveSource();
    assert.equal(
      controller.getSnapshot().sourceId,
      '',
      'Never keep the previous target while resolving activation',
    );
    const nextSource = { id: crypto.randomUUID(), title: 'New active report' };
    h.bridge.getActiveSource = async () => nextSource;
    await controller.useActiveSource();
    oldSource.resolve(source);
    await oldActivation;
    assert.equal(controller.getSnapshot().sourceId, nextSource.id);
    assert.equal(h.calls.captures, 0);
    h.bridge.getActiveSource = async () => null;
    await controller.useActiveSource();
    assert.equal(controller.getSnapshot().sourceId, '');
    await controller.ask('Read the report');
    assert.equal(controller.getSnapshot().errorCode, 'source_required');
    assert.equal(h.calls.captures, 0);
    assert.deepEqual(
      controller.getSnapshot().sources,
      [],
      'Unavailable detection retains no previous source',
    );
    h.bridge.getActiveSource = async () => source;
    await controller.useActiveSource();
    assert.equal(controller.getSnapshot().sourceId, source.id);
    assert.equal(
      h.calls.captures,
      0,
      'Reactivation never submits the preserved draft',
    );
  } finally {
    controller.dispose();
  }
});

test('new activation cancels pending answers, recording and audio without making a new capture', async () => {
  const h = await ready();
  try {
    const pendingAnswer = deferred<DesktopResponse>();
    let id = '';
    h.bridge.readScreen = async (input) => {
      id = input.requestId;
      return pendingAnswer.promise;
    };
    const asking = h.controller.ask();
    await settle();
    await h.controller.useActiveSource();
    assert.ok(h.calls.cancelled.includes(id));
    pendingAnswer.resolve(answerFor(id));
    await asking;
    assert.equal(h.controller.getSnapshot().answer, null);
    assert.equal(h.calls.speech.length, 0);
    assert.equal(h.calls.captures, 1);
    assert.equal(
      h.controller.question.getSnapshot().text,
      'What is the revenue?',
    );
    await h.controller.startRecording();
    await h.controller.useActiveSource();
    await settle();
    assert.equal(h.calls.transcriptions, 0);
    assert.ok(h.calls.trackStops > 0);
    h.bridge.readScreen = async (input) => answerFor(input.requestId);
    await h.controller.ask();
    await settle();
    assert.equal(h.playbacks[0]?.plays, 1);
    await h.controller.useActiveSource();
    assert.equal(h.playbacks[0]?.releases, 1);
    assert.equal(h.controller.getSnapshot().answer, null);
    assert.equal(h.calls.captures, 2);
  } finally {
    h.controller.dispose();
  }
});

test('desktop recording lasts up to sixty seconds; its local countdown is audible and cancellation silences it', async () => {
  const h = await ready();
  try {
    await h.controller.startRecording();
    h.advance(30_000);
    assert.equal(h.controller.question.getSnapshot().phase, 'recording');
    assert.equal(h.calls.transcriptions, 0);
    h.advance(30_000);
    await settle();
    assert.equal(h.calls.transcriptions, 1);
    assert.equal(
      h.calls.captures,
      0,
      'Duration limit transcribes for review, not automatic Ask',
    );
    await h.controller.startRecording();
    h.advance(300);
    h.activity();
    h.advance(1_200);
    assert.ok(h.calls.cues.includes('countdown'));
    h.controller.cancel();
    const cues = h.calls.cues.length;
    h.advance(60_000);
    await settle();
    assert.equal(h.calls.cues.length, cues);
    assert.equal(h.calls.transcriptions, 1);
    assert.equal(h.calls.captures, 0);
  } finally {
    h.controller.dispose();
  }
});

test('failed requests retain a safe reference and the last actual stage, without replaying work', async () => {
  for (const stage of ['preparing', 'capturing', 'asking'] as const) {
    const h = await ready();
    let requestId = '';
    const prepare = h.bridge.prepareCapture;
    h.bridge.prepareCapture = async (sourceId, id) => {
      requestId = id;
      if (stage === 'preparing') throw { code: 'UNAVAILABLE' };
      return prepare(sourceId, id);
    };
    if (stage === 'capturing')
      h.dependencies.capture = async () => {
        throw { code: 'CAPTURE_DENIED' };
      };
    if (stage === 'asking')
      h.bridge.readScreen = async () => {
        throw { code: 'PROVIDER_FAILURE' };
      };
    try {
      await h.controller.ask();
      assert.deepEqual(h.controller.getSnapshot().errorDetails, {
        requestId,
        stage,
      });
      assert.equal(
        h.controller.question.getSnapshot().text,
        'What is the revenue?',
      );
      assert.equal(h.calls.speech.length, 0);
      assert.equal(h.controller.getSnapshot().answer, null);
      h.controller.cancel();
      assert.equal(h.controller.getSnapshot().errorDetails, null);
    } finally {
      h.controller.dispose();
    }
  }
});

const talk = () => ({ id: crypto.randomUUID(), kind: 'talk' as const });

test('talk starts once with a listening cue; passive opening never records or captures', async () => {
  const h = await ready();
  try {
    await h.controller.activate({ id: crypto.randomUUID(), kind: 'open' });
    assert.equal(h.recorders.length, 0);
    const intent = talk();
    await Promise.all([
      h.controller.activate(intent),
      h.controller.activate(intent),
    ]);
    assert.equal(h.recorders.length, 1);
    assert.equal(h.controller.question.getSnapshot().phase, 'recording');
    assert.deepEqual(h.calls.cues, ['start']);
    assert.equal(h.calls.captures, 0);
    assert.equal(h.calls.transcriptions, 0);
    // A start tone must not count as user speech and arm a submission.
    h.activity();
    h.advance(5_000);
    assert.equal(h.calls.transcriptions, 0);
    h.activity();
    h.advance(5_000);
    await settle();
    assert.equal(h.calls.reads.length, 1);
    assert.equal(h.calls.speech.length, 1);
  } finally {
    h.controller.dispose();
  }
});

test('hotkey stops for review at the silence boundary without waiting for source lookup', async () => {
  const h = await ready();
  try {
    await h.controller.activate(talk());
    h.advance(300);
    h.activity();
    h.advance(4_999);
    h.bridge.getActiveSource = () => {
      throw new Error('Review must not look up another source');
    };
    const reviewing = h.controller.activate(talk());
    h.advance(1);
    await reviewing;
    await settle();
    assert.equal(h.calls.transcriptions, 1);
    assert.equal(h.calls.reads.length, 0);
    assert.equal(
      h.controller.question.getSnapshot().text,
      'What is the revenue?',
    );
  } finally {
    h.controller.dispose();
  }
});

test('cancel during native selection or pending microphone permission cannot start a late recording', async () => {
  const h = await ready();
  try {
    const selected = deferred<DesktopSource | null>();
    h.bridge.getActiveSource = () => selected.promise;
    const starting = h.controller.activate(talk());
    h.controller.cancel();
    selected.resolve(source);
    await starting;
    assert.equal(h.recorders.length, 0);
    h.bridge.getActiveSource = async () => source;
    const stream =
      deferred<
        Awaited<ReturnType<typeof h.dependencies.voice.getMicrophone>>
      >();
    h.dependencies.voice.getMicrophone = () => stream.promise;
    const permission = h.controller.activate(talk());
    await settle();
    assert.equal(
      h.controller.question.getSnapshot().phase,
      'requesting_permission',
    );
    await h.controller.activate(talk());
    let released = false;
    stream.resolve({
      getTracks: () => [
        {
          stop: () => {
            released = true;
          },
        },
      ],
    });
    await permission;
    assert.equal(released, true);
    assert.equal(h.recorders.length, 0);
  } finally {
    h.controller.dispose();
  }
});

test('talk during answering cancels without another capture or microphone and suppresses the late answer', async () => {
  const h = await ready();
  try {
    const result = deferred<DesktopResponse>();
    let requestId = '';
    h.bridge.readScreen = async (input) => {
      requestId = input.requestId;
      return result.promise;
    };
    const pending = h.controller.ask();
    await settle();
    await h.controller.activate(talk());
    result.resolve(answerFor(requestId));
    await pending;
    assert.equal(h.controller.getSnapshot().answer, null);
    assert.equal(h.calls.captures, 1);
    assert.equal(h.recorders.length, 0);
    assert.equal(h.calls.speech.length, 0);
  } finally {
    h.controller.dispose();
  }
});

test('talk cancels audio preparation; during playback it silences the player before recording', async () => {
  const h = await ready();
  try {
    const delayed = deferred<ArrayBuffer>();
    const speak = h.bridge.speak;
    h.bridge.speak = () => delayed.promise;
    await h.controller.ask();
    await h.controller.activate(talk());
    delayed.resolve(new Uint8Array([1]).buffer);
    await settle();
    assert.equal(h.playbacks.length, 0);
    assert.equal(h.recorders.length, 0);
    assert.ok(h.controller.getSnapshot().answer);
    h.bridge.speak = speak;
    await h.controller.speech.readBack();
    assert.equal(h.playbacks[0]?.plays, 1);
    const getMicrophone = h.dependencies.voice.getMicrophone;
    h.dependencies.voice.getMicrophone = async () => {
      assert.ok(h.playbacks[0]!.pauses > 0);
      return getMicrophone();
    };
    await h.controller.activate(talk());
    assert.equal(h.recorders.length, 1);
    assert.equal(h.controller.question.getSnapshot().phase, 'recording');
  } finally {
    h.controller.dispose();
  }
});

test('missing target and denied microphone are recoverable and do not submit preserved drafts', async () => {
  const h = await ready();
  try {
    h.bridge.getActiveSource = async () => null;
    await h.controller.activate(talk());
    assert.equal(h.controller.getSnapshot().errorCode, 'source_required');
    h.bridge.getActiveSource = async () => source;
    h.dependencies.voice.getMicrophone = async () => {
      throw new DOMException('Denied', 'NotAllowedError');
    };
    await h.controller.activate(talk());
    assert.equal(
      h.controller.question.getSnapshot().errorCode,
      'microphone_denied',
    );
    assert.equal(
      h.controller.question.getSnapshot().text,
      'What is the revenue?',
    );
    assert.equal(h.calls.reads.length, 0);
    assert.equal(h.calls.transcriptions, 0);
  } finally {
    h.controller.dispose();
  }
});
