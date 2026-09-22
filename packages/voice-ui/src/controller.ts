import {
  AUDIO_MAX_BYTES,
  RECORDING_MAX_MS,
  SPEECH_TEXT_MAX_LENGTH,
  unicodeLength,
  usageLimitSchema,
  type RecognitionLanguage,
  type TranscriptResponse,
  type UsageLimit,
} from '@adc/contracts';

export interface VoiceTransport {
  transcribe(
    audio: Blob,
    filename: string,
    language: RecognitionLanguage,
    signal: AbortSignal,
  ): Promise<TranscriptResponse>;
  speak(
    text: string,
    language: RecognitionLanguage,
    signal: AbortSignal,
  ): Promise<Blob>;
}

export type VoicePhase =
  | 'idle'
  | 'requesting_permission'
  | 'recording'
  | 'transcribing'
  | 'ready'
  | 'generating'
  | 'speaking'
  | 'cancelled'
  | 'error';

export type VoiceNotice =
  | VoicePhase
  | 'duration_reached'
  | 'silence_reached'
  | 'silence_unavailable'
  | 'no_speech'
  | 'play_ready'
  | 'autoplay_blocked'
  | 'stopped'
  | 'cleared';

/** Companion answers use native playback slowdown; provider speed stays normal. */
export const COMPANION_PLAYBACK_RATE = 0.9;

export interface VoiceControllerOptions {
  fixedPlaybackRate?: number;
  silenceAutoFinish?: boolean;
  /** Defaults to 30 seconds; desktop recording may opt in to at most 60 seconds. */
  maxRecordingMs?: number;
  silenceCountdownCues?: boolean;
}

export interface VoiceSnapshot {
  phase: VoicePhase;
  notice: VoiceNotice;
  text: string;
  language: RecognitionLanguage;
  hasAudio: boolean;
  playbackRate: number;
  speechEnabled: boolean;
  audioFeedback: boolean;
  silenceSecondsRemaining: number | null;
  errorCode: string | null;
  errorUsage: UsageLimit | null;
  errorOperation: 'transcribe' | 'speak' | null;
}

export interface MicrophoneStream {
  getTracks(): { stop(): void }[];
}

export interface Recorder {
  readonly mimeType: string;
  readonly state: string;
  ondata: (chunk: Blob) => void;
  onstop: () => void;
  onerror: () => void;
  start(): void;
  stop(): void;
}

export interface Playback {
  currentTime: number;
  playbackRate: number;
  onended: (() => void) | null;
  onerror: (() => void) | null;
  play(): Promise<void>;
  pause(): void;
  release(): void;
}

export interface VoiceDependencies {
  getMicrophone(): Promise<MicrophoneStream>;
  createRecorder(stream: MicrophoneStream): Recorder;
  createPlayback(url: string): Playback;
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
  schedule(callback: () => void, delay: number): unknown;
  unschedule(timer: unknown): void;
  observeAudioActivity?(
    stream: MicrophoneStream,
    onActivity: () => void,
    signal: AbortSignal,
    onUnavailable: () => void,
  ): Promise<() => void>;
  now?(): number;
  cue(kind?: 'start' | 'countdown' | 'submit'): void;
}

interface Recording {
  id: number;
  stream: MicrophoneStream;
  recorder: Recorder;
  chunks: Blob[];
  bytes: number;
  finished: boolean;
  submitted: boolean;
  timer: unknown;
  silenceTimer: unknown;
  silenceDeadline: number | null;
  lastCountdownCue: number | null;
  lastCueAt: number;
  ignoreActivityUntil: number;
  activityRequest: AbortController;
  stopActivity: (() => void) | undefined;
}

const QUESTION_SILENCE_MS = 5_000;
const COUNTDOWN_SETTLE_MS = 150;
// Covers the 60 ms local tone, analyser sample window and a short speaker echo.
const COUNTDOWN_ECHO_GUARD_MS = 250;

function stopTracks(stream: MicrophoneStream) {
  stream.getTracks().forEach((track) => track.stop());
}

function errorCode(error: unknown): string {
  if (error instanceof Error && error.name === 'NotAllowedError')
    return 'microphone_denied';
  if (error instanceof Error && error.name === 'NotFoundError')
    return 'microphone_missing';
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  )
    return error.code.toLowerCase();
  return 'request_failed';
}

export function audioFilename(mime: string): string {
  const format = mime.split(';')[0]?.trim();
  if (format === 'audio/webm') return 'recording.webm';
  if (format === 'audio/ogg') return 'recording.ogg';
  if (format === 'audio/mp4') return 'recording.m4a';
  throw new Error('Unsupported recording format');
}

function requestFailure(
  error: unknown,
  operation: 'transcribe' | 'speak',
): Pick<VoiceSnapshot, 'errorCode' | 'errorUsage' | 'errorOperation'> {
  const code = errorCode(error);
  const usage = usageLimitSchema.safeParse(
    code === 'app_rate_limited' &&
      error &&
      typeof error === 'object' &&
      'usage' in error
      ? error.usage
      : undefined,
  );
  return {
    errorCode: code,
    errorUsage: usage.success ? usage.data : null,
    errorOperation: operation,
  };
}

/** One session owns one microphone operation, request and generated audio buffer. */
export class VoiceController {
  private snapshot: VoiceSnapshot = {
    phase: 'idle',
    notice: 'idle',
    text: '',
    language: 'auto',
    hasAudio: false,
    playbackRate: 1,
    speechEnabled: false,
    audioFeedback: false,
    silenceSecondsRemaining: null,
    errorCode: null,
    errorUsage: null,
    errorOperation: null,
  };
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private recording: Recording | undefined;
  private request: AbortController | undefined;
  private playback: Playback | undefined;
  private audioUrl: string | undefined;
  private activePlay: { id: number; playback: Playback } | undefined;
  private disposed = false;
  private readonly transport: VoiceTransport;
  private readonly dependencies: VoiceDependencies;
  private readonly fixedPlaybackRate: number | undefined;
  private readonly silenceAutoFinish: boolean;
  private readonly silenceCountdownCues: boolean;
  private readonly maxRecordingMs: number;
  private automaticQuestion: string | null = null;
  private automaticQuestionGeneration: number | null = null;

  constructor(
    transport: VoiceTransport,
    dependencies: VoiceDependencies,
    options: VoiceControllerOptions = {},
  ) {
    this.transport = transport;
    this.dependencies = dependencies;
    this.fixedPlaybackRate = options.fixedPlaybackRate;
    this.silenceAutoFinish = options.silenceAutoFinish ?? false;
    this.silenceCountdownCues = options.silenceCountdownCues ?? false;
    this.maxRecordingMs = options.maxRecordingMs ?? RECORDING_MAX_MS;
    if (
      !Number.isInteger(this.maxRecordingMs) ||
      this.maxRecordingMs <= 0 ||
      this.maxRecordingMs > 60_000
    )
      throw new RangeError(
        'Recording duration must be between 1 and 60000 milliseconds.',
      );
    if (this.fixedPlaybackRate !== undefined)
      this.snapshot.playbackRate = this.fixedPlaybackRate;
  }

  getSnapshot = (): VoiceSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private update(patch: Partial<VoiceSnapshot>) {
    if (this.disposed) return;
    this.snapshot = {
      ...this.snapshot,
      ...(patch.errorCode !== undefined
        ? { errorUsage: null, errorOperation: null }
        : {}),
      ...patch,
    };
    this.listeners.forEach((listener) => listener());
  }

  private current(id: number) {
    return !this.disposed && this.generation === id;
  }

  /** A silence-finished transcript is claimable once by its companion owner. */
  claimAutomaticQuestion = (): string | null => {
    const question = this.automaticQuestion;
    this.automaticQuestion = null;
    return !this.disposed &&
      this.snapshot.phase === 'ready' &&
      question === this.snapshot.text
      ? question
      : null;
  };

  private stopActivity(recording: Recording) {
    this.dependencies.unschedule(recording.silenceTimer);
    recording.activityRequest.abort();
    try {
      recording.stopActivity?.();
    } catch {
      // Recorder and microphone cleanup must still run if analysis already ended.
    }
    recording.stopActivity = undefined;
    recording.silenceDeadline = null;
    recording.lastCountdownCue = null;
    recording.ignoreActivityUntil = 0;
    if (this.recording === recording)
      this.update({ silenceSecondsRemaining: null });
  }

  private async observeActivity(recording: Recording) {
    if (!this.silenceAutoFinish) return;
    const observe = this.dependencies.observeAudioActivity;
    const isRecording = () =>
      this.current(recording.id) &&
      this.recording === recording &&
      !recording.finished &&
      !recording.activityRequest.signal.aborted;
    if (!isRecording()) return;
    const now = () => this.dependencies.now?.() ?? performance.now();
    const unavailable = () => {
      if (!isRecording()) return;
      this.stopActivity(recording);
      this.update({ notice: 'silence_unavailable' });
    };
    const tick = () => {
      if (!isRecording() || recording.silenceDeadline === null) return;
      const remaining = Math.max(0, recording.silenceDeadline - now());
      if (remaining === 0) {
        this.finish('silence');
        return;
      }
      const seconds = Math.ceil(remaining / 1_000);
      this.update({ silenceSecondsRemaining: seconds });
      if (!isRecording()) return;
      if (
        this.silenceCountdownCues &&
        this.snapshot.audioFeedback &&
        recording.lastCountdownCue !== seconds &&
        now() - recording.lastCueAt >= 1_000
      ) {
        recording.lastCountdownCue = seconds;
        recording.lastCueAt = now();
        // Set the guard before sounding the cue: local speaker activity is not
        // user speech and must not continually extend the silence deadline.
        recording.ignoreActivityUntil = now() + COUNTDOWN_ECHO_GUARD_MS;
        this.cue('countdown');
      }
      if (!isRecording()) return;
      recording.silenceTimer = this.dependencies.schedule(
        tick,
        Math.min(remaining, 1_000),
      );
    };
    try {
      if (!observe) throw new Error('Audio activity detection unavailable');
      const stop = await observe(
        recording.stream,
        () => {
          if (!isRecording() || now() < recording.ignoreActivityUntil) return;
          const firstActivity = recording.silenceDeadline === null;
          recording.silenceDeadline = now() + QUESTION_SILENCE_MS;
          recording.lastCountdownCue = null;
          if (this.snapshot.silenceSecondsRemaining !== 5)
            this.update({ silenceSecondsRemaining: 5 });
          if (!isRecording()) return;
          if (this.silenceCountdownCues) {
            this.dependencies.unschedule(recording.silenceTimer);
            // Sustained activity postpones the first tone; resumed speech starts
            // a fresh countdown without allowing multiple tones in one second.
            recording.silenceTimer = this.dependencies.schedule(
              tick,
              Math.max(
                COUNTDOWN_SETTLE_MS,
                recording.lastCueAt + 1_000 - now(),
              ),
            );
          } else if (firstActivity)
            recording.silenceTimer = this.dependencies.schedule(tick, 1_000);
        },
        recording.activityRequest.signal,
        unavailable,
      );
      if (!isRecording()) stop();
      else recording.stopActivity = stop;
    } catch {
      unavailable();
    }
  }

  private cue(kind?: 'start' | 'countdown' | 'submit') {
    try {
      this.dependencies.cue(kind);
    } catch {
      // Optional local feedback cannot interrupt recording or submission.
    }
  }

  private releaseAudio() {
    this.activePlay = undefined;
    if (this.playback) {
      this.playback.pause();
      this.playback.onended = null;
      this.playback.onerror = null;
      this.playback.release();
      this.playback = undefined;
    }
    if (this.audioUrl) this.dependencies.revokeObjectURL(this.audioUrl);
    this.audioUrl = undefined;
    this.update({ hasAudio: false });
  }

  private stopRecording() {
    const recording = this.recording;
    this.recording = undefined;
    if (!recording) return;
    this.stopActivity(recording);
    this.dependencies.unschedule(recording.timer);
    try {
      if (recording.recorder.state !== 'inactive') recording.recorder.stop();
    } catch {
      // Track cleanup must still run if the browser already ended its recorder.
    } finally {
      stopTracks(recording.stream);
    }
    recording.chunks = [];
  }

  cancel = () => {
    this.automaticQuestion = null;
    this.automaticQuestionGeneration = null;
    this.generation += 1;
    this.request?.abort();
    this.request = undefined;
    this.stopRecording();
    this.activePlay = undefined;
    this.playback?.pause();
    if (this.playback) this.playback.currentTime = 0;
    this.update({
      phase: 'cancelled',
      notice: 'cancelled',
      errorCode: null,
      silenceSecondsRemaining: null,
    });
  };

  clear = () => {
    this.cancel();
    this.releaseAudio();
    this.update({ text: '', phase: 'idle', notice: 'cleared' });
  };

  dispose = () => {
    this.cancel();
    this.releaseAudio();
    this.snapshot = { ...this.snapshot, text: '' };
    this.disposed = true;
    this.listeners.clear();
  };

  editText = (text: string) => {
    if (text === this.snapshot.text) return;
    this.cancel();
    this.releaseAudio();
    this.update({
      text,
      phase: text.trim() ? 'ready' : 'idle',
      notice: text.trim() ? 'ready' : 'idle',
    });
  };

  setLanguage = (language: RecognitionLanguage) => {
    if (language === this.snapshot.language) return;
    this.cancel();
    this.releaseAudio();
    this.update({
      language,
      phase: this.snapshot.text.trim() ? 'ready' : 'idle',
      notice: 'idle',
    });
  };

  setPlaybackRate = (rate: number) => {
    if (this.fixedPlaybackRate !== undefined) return;
    if (![0.5, 0.75, 1, 1.25, 1.5, 2].includes(rate)) return;
    if (this.playback) this.playback.playbackRate = rate;
    this.update({ playbackRate: rate });
  };

  setSpeechEnabled = (enabled: boolean) => {
    if (
      !enabled &&
      (this.activePlay ||
        ['generating', 'speaking'].includes(this.snapshot.phase))
    )
      this.stopPlayback();
    this.update({ speechEnabled: enabled });
  };

  setAudioFeedback = (enabled: boolean) =>
    this.update({ audioFeedback: enabled });

  activate = () => {
    switch (this.snapshot.phase) {
      case 'recording':
        this.finish();
        break;
      case 'requesting_permission':
      case 'transcribing':
      case 'generating':
        this.cancel();
        break;
      case 'speaking':
        this.stopPlayback();
        break;
      default:
        void this.start();
    }
  };

  start = async () => {
    if (
      this.disposed ||
      ['requesting_permission', 'recording', 'transcribing'].includes(
        this.snapshot.phase,
      )
    )
      return;
    this.cancel();
    const id = this.generation;
    this.update({
      phase: 'requesting_permission',
      notice: 'requesting_permission',
      errorCode: null,
    });
    let stream: MicrophoneStream | undefined;
    try {
      stream = await this.dependencies.getMicrophone();
      if (!this.current(id)) {
        stopTracks(stream);
        return;
      }
      const recorder = this.dependencies.createRecorder(stream);
      audioFilename(recorder.mimeType);
      const recording: Recording = {
        id,
        stream,
        recorder,
        chunks: [],
        bytes: 0,
        finished: false,
        submitted: false,
        timer: undefined,
        silenceTimer: undefined,
        silenceDeadline: null,
        lastCountdownCue: null,
        lastCueAt: Number.NEGATIVE_INFINITY,
        ignoreActivityUntil: 0,
        activityRequest: new AbortController(),
        stopActivity: undefined,
      };
      this.recording = recording;
      recorder.ondata = (chunk) => {
        if (!this.current(id) || recording.submitted || chunk.size === 0)
          return;
        recording.bytes += chunk.size;
        if (recording.bytes > AUDIO_MAX_BYTES) {
          this.cancel();
          this.update({
            phase: 'error',
            notice: 'error',
            errorCode: 'audio_too_large',
          });
          return;
        }
        recording.chunks.push(chunk);
      };
      recorder.onerror = () => {
        if (!this.current(id)) return;
        this.cancel();
        this.update({
          phase: 'error',
          notice: 'error',
          errorCode: 'recording_failed',
        });
      };
      recorder.onstop = () => {
        stopTracks(recording.stream);
        this.stopActivity(recording);
        this.dependencies.unschedule(recording.timer);
        if (!this.current(id) || recording.submitted) return;
        if (!recording.finished) {
          this.cancel();
          this.update({
            phase: 'error',
            notice: 'error',
            errorCode: 'recording_failed',
          });
          return;
        }
        recording.submitted = true;
        this.recording = undefined;
        const blob = new Blob(recording.chunks, { type: recorder.mimeType });
        recording.chunks = [];
        if (!blob.size) {
          this.update({
            phase: 'error',
            notice: 'error',
            errorCode: 'empty_audio',
          });
          return;
        }
        if (this.silenceAutoFinish && this.snapshot.audioFeedback) {
          if (!this.silenceCountdownCues) this.cue();
          else if (this.automaticQuestionGeneration === recording.id)
            this.cue('submit');
        }
        void this.transcribe(blob, audioFilename(recorder.mimeType), id);
      };
      recorder.start();
      recording.timer = this.dependencies.schedule(
        () => this.finish(true),
        this.maxRecordingMs,
      );
      this.update({ phase: 'recording', notice: 'recording' });
      void this.observeActivity(recording);
      if (this.snapshot.audioFeedback && !this.silenceAutoFinish)
        this.cue('start');
    } catch (error) {
      if (stream) stopTracks(stream);
      if (!this.current(id)) return;
      this.stopRecording();
      this.update({
        phase: 'error',
        notice: 'error',
        errorCode: errorCode(error),
      });
    }
  };

  finish = (automatic: boolean | 'silence' = false) => {
    if (automatic === false) {
      // A deliberate review wins even if the silence timer already stopped the
      // recorder. Keep its final chunk and any pending transcription, but disarm
      // the later companion submission before publishing another state update.
      this.automaticQuestion = null;
      this.automaticQuestionGeneration = null;
      if (
        this.snapshot.phase === 'transcribing' &&
        this.snapshot.notice === 'silence_reached'
      )
        this.update({ notice: 'transcribing' });
    }
    const recording = this.recording;
    if (!recording || recording.finished || !this.current(recording.id)) return;
    recording.finished = true;
    this.automaticQuestionGeneration =
      automatic === 'silence' ? recording.id : null;
    this.stopActivity(recording);
    this.dependencies.unschedule(recording.timer);
    this.update({
      phase: 'transcribing',
      notice:
        automatic === 'silence'
          ? 'silence_reached'
          : automatic
            ? 'duration_reached'
            : 'transcribing',
    });
    try {
      recording.recorder.stop();
    } catch {
      this.cancel();
      this.update({
        phase: 'error',
        notice: 'error',
        errorCode: 'recording_failed',
      });
    }
  };

  private async transcribe(blob: Blob, filename: string, id: number) {
    const request = new AbortController();
    this.request = request;
    try {
      const response = await this.transport.transcribe(
        blob,
        filename,
        this.snapshot.language,
        request.signal,
      );
      if (!this.current(id)) return;
      this.releaseAudio();
      if (!this.current(id)) return;
      this.automaticQuestion =
        this.automaticQuestionGeneration === id && response.transcript.trim()
          ? response.transcript
          : null;
      this.automaticQuestionGeneration = null;
      // Preserve the provider transcript exactly, including whitespace and digits.
      this.update({
        text: response.transcript,
        phase: 'ready',
        notice: response.transcript.trim() ? 'ready' : 'no_speech',
      });
    } catch (error) {
      if (this.current(id))
        this.update({
          phase: 'error',
          notice: 'error',
          ...requestFailure(error, 'transcribe'),
        });
    } finally {
      if (this.request === request) this.request = undefined;
    }
  }

  readBack = async () => {
    if (
      this.disposed ||
      !this.snapshot.speechEnabled ||
      [
        'generating',
        'speaking',
        'recording',
        'requesting_permission',
        'transcribing',
      ].includes(this.snapshot.phase)
    )
      return;
    const text = this.snapshot.text;
    if (!text.trim() || unicodeLength(text) > SPEECH_TEXT_MAX_LENGTH) {
      this.update({
        phase: 'error',
        notice: 'error',
        errorCode: 'invalid_text',
      });
      return;
    }
    if (this.snapshot.hasAudio) {
      await this.play();
      return;
    }
    this.cancel();
    const id = this.generation;
    const request = new AbortController();
    this.request = request;
    this.update({ phase: 'generating', notice: 'generating', errorCode: null });
    try {
      if (!this.current(id) || !this.snapshot.speechEnabled) return;
      const blob = await this.transport.speak(
        text,
        this.snapshot.language,
        request.signal,
      );
      if (!this.current(id) || !this.snapshot.speechEnabled) return;
      if (!blob.size || !blob.type.startsWith('audio/'))
        throw new Error('Invalid audio response');
      this.releaseAudio();
      if (!this.current(id) || !this.snapshot.speechEnabled) return;
      this.audioUrl = this.dependencies.createObjectURL(blob);
      this.playback = this.dependencies.createPlayback(this.audioUrl);
      this.playback.playbackRate = this.snapshot.playbackRate;
      this.update({ hasAudio: true, phase: 'ready', notice: 'play_ready' });
      if (!this.current(id) || !this.snapshot.speechEnabled) return;
      await this.play();
    } catch (error) {
      if (this.current(id)) {
        this.releaseAudio();
        this.update({
          phase: 'error',
          notice: 'error',
          ...requestFailure(error, 'speak'),
        });
      }
    } finally {
      if (this.request === request) this.request = undefined;
    }
  };

  play = async () => {
    const playback = this.playback;
    if (
      !playback ||
      !this.snapshot.speechEnabled ||
      this.disposed ||
      this.activePlay ||
      [
        'generating',
        'recording',
        'requesting_permission',
        'transcribing',
      ].includes(this.snapshot.phase)
    )
      return;
    const id = this.generation;
    const attempt = { id, playback };
    this.activePlay = attempt;
    const isActive = () =>
      this.current(id) &&
      this.snapshot.speechEnabled &&
      this.activePlay === attempt;
    playback.pause();
    playback.currentTime = 0;
    playback.playbackRate =
      this.fixedPlaybackRate ?? this.snapshot.playbackRate;
    playback.onended = () => {
      if (isActive()) {
        this.activePlay = undefined;
        this.update({ phase: 'ready', notice: 'play_ready' });
      }
    };
    playback.onerror = () => {
      if (isActive()) {
        this.releaseAudio();
        this.update({
          phase: 'error',
          notice: 'error',
          errorCode: 'playback_failed',
        });
      }
    };
    this.update({ phase: 'speaking', notice: 'speaking', errorCode: null });
    try {
      if (!isActive()) return;
      await playback.play();
      if (!isActive() && this.activePlay?.playback !== playback)
        playback.pause();
    } catch (error) {
      if (!isActive()) return;
      this.activePlay = undefined;
      if (error instanceof Error && error.name === 'NotAllowedError') {
        this.update({ phase: 'ready', notice: 'autoplay_blocked' });
      } else {
        this.releaseAudio();
        this.update({
          phase: 'error',
          notice: 'error',
          errorCode: 'playback_failed',
        });
      }
    }
  };

  stopPlayback = () => {
    this.generation += 1;
    this.request?.abort();
    this.request = undefined;
    this.activePlay = undefined;
    this.playback?.pause();
    if (this.playback) this.playback.currentTime = 0;
    this.update({ phase: 'ready', notice: 'stopped', errorCode: null });
  };
}
