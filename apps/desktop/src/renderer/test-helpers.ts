import type { DesktopResponse } from '@adc/contracts';
import type { DesktopBridge, DesktopScreenInput } from '../bridge.ts';
import type { DesktopSessionState } from '../session-types.ts';
import type {
  Playback,
  Recorder,
} from '../../../../packages/voice-ui/src/controller.ts';
import type { AssistantDependencies } from './assistant-controller.ts';

export const session: DesktopSessionState = {
  phase: 'signed_in',
  account: { id: 'account-a', email: 'member@example.test' },
  workspace: 'allowed',
  epoch: '7d64d21b-5139-46b8-b4a5-47298bd7c4c3',
  errorCode: null,
  logoutConfirmed: null,
};
export const source = {
  id: '1789e461-0475-469f-a1a7-1859e291190b',
  title: 'Quarterly report',
};
export function answerFor(
  requestId: string,
  text = 'Revenue is 1,200.',
): DesktopResponse {
  return {
    source_kind: 'desktop_window',
    request_id: requestId,
    snapshot_id: 'b11d0933-8e2a-4a68-a942-f68cd4d243eb',
    source_id: source.id,
    fingerprint: '1'.repeat(64),
    captured_at: '2026-09-22T09:00:00.000Z',
    status: 'answer',
    answer_language: 'en',
    text,
    evidence: [
      {
        image_id: 'image-1',
        region: { x: 0.1, y: 0.2, width: 0.3, height: 0.2 },
        description: 'Revenue appears in the report summary.',
      },
    ],
  };
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
export async function settle() {
  for (let index = 0; index < 16; index++) await Promise.resolve();
}

export function assistantHarness() {
  const calls = {
    captures: 0,
    reads: [] as DesktopScreenInput[],
    speech: [] as string[],
    cues: [] as string[],
    transcriptions: 0,
    cancelled: [] as string[],
    trackStops: 0,
  };
  const sessionListeners = new Set<(state: DesktopSessionState) => void>();
  const suspendListeners = new Set<() => void>();
  const activationListeners = new Set<() => void>();
  const playbacks: (Playback & {
    plays: number;
    pauses: number;
    releases: number;
  })[] = [];
  const recorders: Recorder[] = [];
  const revoked: string[] = [];
  let playbackBlocked = false;
  let clock = 0;
  let timerId = 0;
  let activity = () => {};
  const timers = new Map<number, { at: number; callback: () => void }>();
  const dependencies: AssistantDependencies = {
    capture: async () => {
      calls.captures++;
      return {
        bytes: new Uint8Array([0xff, 0xd8, 0xff]).buffer,
        width: 800,
        height: 600,
        capturedAt: '2026-09-22T09:00:00.000Z',
      };
    },
    voice: {
      getMicrophone: async () => ({
        getTracks: () => [
          {
            stop: () => {
              calls.trackStops++;
            },
          },
        ],
      }),
      createRecorder: () => {
        let state = 'inactive';
        const recorder: Recorder = {
          mimeType: 'audio/webm',
          get state() {
            return state;
          },
          ondata: () => {},
          onstop: () => {},
          onerror: () => {},
          start: () => {
            state = 'recording';
          },
          stop: () => {
            state = 'inactive';
            queueMicrotask(() => {
              recorder.ondata(new Blob(['recording'], { type: 'audio/webm' }));
              recorder.onstop();
            });
          },
        };
        recorders.push(recorder);
        return recorder;
      },
      createObjectURL: () => `blob:${playbacks.length + 1}`,
      revokeObjectURL: (url) => {
        revoked.push(url);
      },
      createPlayback: () => {
        const playback: Playback & {
          plays: number;
          pauses: number;
          releases: number;
        } = {
          currentTime: 0,
          playbackRate: 1,
          onended: null,
          onerror: null,
          plays: 0,
          pauses: 0,
          releases: 0,
          async play() {
            this.plays++;
            if (playbackBlocked)
              throw new DOMException('Autoplay blocked', 'NotAllowedError');
          },
          pause() {
            this.pauses++;
          },
          release() {
            this.releases++;
          },
        };
        playbacks.push(playback);
        return playback;
      },
      now: () => clock,
      schedule: (callback, delay) => {
        const id = ++timerId;
        timers.set(id, { callback, at: clock + delay });
        return id;
      },
      unschedule: (id) => {
        timers.delete(id as number);
      },
      observeAudioActivity: async (_stream, onActivity) => {
        activity = onActivity;
        return () => {
          activity = () => {};
        };
      },
      cue: (kind) => {
        calls.cues.push(kind ?? 'start');
      },
    },
  };
  const bridge: DesktopBridge = {
    getState: async () => ({
      preferences: { language: 'en', shortcut: 'Control+Alt+Space' },
      shortcutRegistered: true,
      preferencesSaved: true,
      issue: null,
    }),
    updatePreferences: async (preferences) => ({
      preferences,
      shortcutRegistered: true,
      preferencesSaved: true,
      issue: null,
    }),
    hide: async () => {
      suspendListeners.forEach((listener) => listener());
    },
    quit: async () => {},
    onState: () => () => {},
    onActivate: (listener) => {
      activationListeners.add(listener);
      return () => {
        activationListeners.delete(listener);
      };
    },
    getActiveSource: async () => source,
    getSession: async () => session,
    signIn: async () => session,
    retrySession: async () => session,
    signOut: async () => {
      const next: DesktopSessionState = {
        ...session,
        account: null,
        phase: 'signed_out',
        workspace: 'unknown',
        epoch: crypto.randomUUID(),
        logoutConfirmed: true,
      };
      sessionListeners.forEach((listener) => listener(next));
      return next;
    },
    onSession: (listener) => {
      sessionListeners.add(listener);
      return () => {
        sessionListeners.delete(listener);
      };
    },
    onSuspend: (listener) => {
      suspendListeners.add(listener);
      return () => {
        suspendListeners.delete(listener);
      };
    },
    prepareCapture: async (id, requestId) => ({
      id,
      title: source.title,
      requestId,
      epoch: session.epoch,
      captureId: crypto.randomUUID(),
    }),
    readScreen: async (input) => {
      calls.reads.push(input);
      return answerFor(input.requestId);
    },
    transcribe: async (input) => {
      calls.transcriptions++;
      return {
        request_id: input.requestId,
        transcript: 'What is the revenue?',
      };
    },
    speak: async (input) => {
      calls.speech.push(input.text);
      return new Uint8Array([1, 2, 3]).buffer;
    },
    cancelOperation: async (id) => {
      calls.cancelled.push(id);
    },
  };
  return {
    bridge,
    dependencies,
    calls,
    playbacks,
    recorders,
    revoked,
    sessionListeners,
    suspendListeners,
    activationListeners,
    setPlaybackBlocked(value: boolean) {
      playbackBlocked = value;
    },
    activity: () => activity(),
    advance(milliseconds: number) {
      const end = clock + milliseconds;
      for (;;) {
        const first = [...timers.entries()]
          .filter(([, timer]) => timer.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!first) break;
        clock = first[1].at;
        timers.delete(first[0]);
        first[1].callback();
      }
      clock = end;
    },
  };
}
