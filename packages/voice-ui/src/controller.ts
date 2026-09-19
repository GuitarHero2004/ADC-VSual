import {
  AUDIO_MAX_BYTES,
  RECORDING_MAX_MS,
  SPEECH_TEXT_MAX_LENGTH,
  unicodeLength,
  type RecognitionLanguage,
  type TranscriptResponse,
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
  | 'no_speech'
  | 'play_ready'
  | 'stopped'
  | 'cleared';

export interface VoiceSnapshot {
  phase: VoicePhase;
  notice: VoiceNotice;
  text: string;
  language: RecognitionLanguage;
  hasAudio: boolean;
  playbackRate: number;
  speechEnabled: boolean;
  audioFeedback: boolean;
  errorCode: string | null;
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
  cue(): void;
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
}

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
    errorCode: null,
  };
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private recording: Recording | undefined;
  private request: AbortController | undefined;
  private playback: Playback | undefined;
  private audioUrl: string | undefined;
  private disposed = false;
  private readonly transport: VoiceTransport;
  private readonly dependencies: VoiceDependencies;

  constructor(transport: VoiceTransport, dependencies: VoiceDependencies) {
    this.transport = transport;
    this.dependencies = dependencies;
  }

  getSnapshot = (): VoiceSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private update(patch: Partial<VoiceSnapshot>) {
    if (this.disposed) return;
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  private current(id: number) {
    return !this.disposed && this.generation === id;
  }

  private releaseAudio() {
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
    this.generation += 1;
    this.request?.abort();
    this.request = undefined;
    this.stopRecording();
    this.playback?.pause();
    if (this.playback) this.playback.currentTime = 0;
    this.update({ phase: 'cancelled', notice: 'cancelled', errorCode: null });
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
    if (![0.5, 0.75, 1, 1.25, 1.5, 2].includes(rate)) return;
    if (this.playback) this.playback.playbackRate = rate;
    this.update({ playbackRate: rate });
  };

  setSpeechEnabled = (enabled: boolean) => {
    if (!enabled && ['generating', 'speaking'].includes(this.snapshot.phase))
      this.cancel();
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
        void this.transcribe(blob, audioFilename(recorder.mimeType), id);
      };
      recorder.start();
      recording.timer = this.dependencies.schedule(
        () => this.finish(true),
        RECORDING_MAX_MS,
      );
      this.update({ phase: 'recording', notice: 'recording' });
      if (this.snapshot.audioFeedback) this.dependencies.cue();
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

  finish = (automatic = false) => {
    const recording = this.recording;
    if (!recording || recording.finished || !this.current(recording.id)) return;
    recording.finished = true;
    this.dependencies.unschedule(recording.timer);
    this.update({
      phase: 'transcribing',
      notice: automatic ? 'duration_reached' : 'transcribing',
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
          errorCode: errorCode(error),
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
      const blob = await this.transport.speak(
        text,
        this.snapshot.language,
        request.signal,
      );
      if (!this.current(id)) return;
      if (!blob.size || !blob.type.startsWith('audio/'))
        throw new Error('Invalid audio response');
      this.releaseAudio();
      this.audioUrl = this.dependencies.createObjectURL(blob);
      this.playback = this.dependencies.createPlayback(this.audioUrl);
      this.playback.playbackRate = this.snapshot.playbackRate;
      this.update({ hasAudio: true, phase: 'ready', notice: 'play_ready' });
      await this.play();
    } catch (error) {
      if (this.current(id)) {
        this.releaseAudio();
        this.update({
          phase: 'error',
          notice: 'error',
          errorCode: errorCode(error),
        });
      }
    } finally {
      if (this.request === request) this.request = undefined;
    }
  };

  play = async () => {
    const playback = this.playback;
    if (!playback || !this.snapshot.speechEnabled || this.disposed) return;
    const id = this.generation;
    playback.pause();
    playback.currentTime = 0;
    playback.onended = () => {
      if (this.current(id))
        this.update({ phase: 'ready', notice: 'play_ready' });
    };
    playback.onerror = () => {
      if (this.current(id))
        this.update({
          phase: 'error',
          notice: 'error',
          errorCode: 'playback_failed',
        });
    };
    this.update({ phase: 'speaking', notice: 'speaking', errorCode: null });
    try {
      await playback.play();
      if (!this.current(id)) playback.pause();
    } catch {
      if (this.current(id))
        this.update({ phase: 'ready', notice: 'play_ready' });
    }
  };

  stopPlayback = () => {
    this.generation += 1;
    this.playback?.pause();
    if (this.playback) this.playback.currentTime = 0;
    this.update({ phase: 'ready', notice: 'stopped' });
  };
}
