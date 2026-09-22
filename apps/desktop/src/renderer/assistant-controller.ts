import {
  desktopResponseSchema,
  usageLimitSchema,
  VISUAL_LIMITS,
  type DesktopResponse,
  type UsageLimit,
} from '@adc/contracts';
import {
  COMPANION_PLAYBACK_RATE,
  VoiceController,
  type VoiceDependencies,
  type VoiceTransport,
} from '../../../../packages/voice-ui/src/controller.ts';
import type { DesktopBridge, DesktopSource } from '../bridge.ts';

export const DESKTOP_RECORDING_MAX_MS = 60_000;
export interface CapturedWindowFrame {
  bytes: ArrayBuffer;
  width: number;
  height: number;
  capturedAt: string;
}
export interface AssistantDependencies {
  capture(signal: AbortSignal): Promise<CapturedWindowFrame>;
  voice: VoiceDependencies;
}
export interface AssistantSnapshot {
  phase:
    | 'idle'
    | 'preparing'
    | 'capturing'
    | 'asking'
    | 'ready'
    | 'cancelled'
    | 'error';
  sources: DesktopSource[];
  sourceId: string;
  loadingSources: boolean;
  errorCode: string | null;
  errorUsage: UsageLimit | null;
  errorDetails: {
    requestId: string;
    stage: 'preparing' | 'capturing' | 'asking';
  } | null;
  answer: { response: DesktopResponse; title: string; question: string } | null;
}

export function safeErrorCode(error: unknown): string {
  return error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string' &&
    /^[a-z][a-z0-9_]{0,63}$/i.test(error.code)
    ? error.code.toLowerCase()
    : 'request_failed';
}

export function createDesktopVoiceTransport(
  bridge: DesktopBridge,
): VoiceTransport {
  async function request<T>(
    signal: AbortSignal,
    operation: (requestId: string) => Promise<T>,
    discard?: (value: T) => void,
  ): Promise<T> {
    signal.throwIfAborted();
    const requestId = crypto.randomUUID();
    const cancel = () => {
      void bridge.cancelOperation(requestId).catch(() => {});
    };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      const result = await operation(requestId);
      if (signal.aborted) discard?.(result);
      signal.throwIfAborted();
      return result;
    } finally {
      signal.removeEventListener('abort', cancel);
    }
  }
  return {
    async transcribe(audio, filename, language, signal) {
      const bytes = await audio.arrayBuffer();
      try {
        signal.throwIfAborted();
        // Electron clones invocation arguments before returning the promise.
        return request(signal, (requestId) =>
          bridge.transcribe({
            requestId,
            bytes,
            mimeType: audio.type,
            filename,
            language,
          }),
        );
      } finally {
        new Uint8Array(bytes).fill(0);
      }
    },
    async speak(text, language, signal) {
      const wipe = (bytes: ArrayBuffer) => {
        new Uint8Array(bytes).fill(0);
      };
      const bytes = await request(
        signal,
        (requestId) => bridge.speak({ requestId, text, language }),
        wipe,
      );
      try {
        return new Blob([bytes], { type: 'audio/mpeg' });
      } finally {
        wipe(bytes);
      }
    },
  };
}

/** Session-owned work; only ask() or a claimed silence completion can capture pixels. */
export class DesktopAssistantController {
  readonly question: VoiceController;
  readonly speech: VoiceController;
  private state: AssistantSnapshot;
  private readonly listeners = new Set<() => void>();
  private pending: { id: string; abort: AbortController } | null = null;
  private generation = 0;
  private sourceGeneration = 0;
  private disposed = false;
  private removeQuestionListener: () => void;
  private readonly bridge: DesktopBridge;
  private readonly epoch: string;
  private readonly dependencies: AssistantDependencies;

  constructor(
    bridge: DesktopBridge,
    epoch: string,
    dependencies: AssistantDependencies,
  ) {
    this.bridge = bridge;
    this.epoch = epoch;
    this.dependencies = dependencies;
    this.state = {
      phase: 'idle',
      sources: [],
      sourceId: '',
      loadingSources: false,
      errorCode: null,
      errorUsage: null,
      errorDetails: null,
      answer: null,
    };
    const transport = createDesktopVoiceTransport(bridge);
    this.question = new VoiceController(transport, dependencies.voice, {
      silenceAutoFinish: true,
      maxRecordingMs: DESKTOP_RECORDING_MAX_MS,
      silenceCountdownCues: true,
    });
    this.speech = new VoiceController(transport, dependencies.voice, {
      fixedPlaybackRate: COMPANION_PLAYBACK_RATE,
    });
    this.question.setAudioFeedback(true);
    this.speech.setSpeechEnabled(true);
    this.removeQuestionListener = this.question.subscribe(() => {
      const question = this.question.claimAutomaticQuestion();
      if (question !== null) void this.ask(question);
    });
  }

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<AssistantSnapshot>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  useActiveSource = async () => {
    if (this.disposed) return;
    this.cancel();
    this.speech.clear();
    const generation = ++this.sourceGeneration;
    this.update({
      sourceId: '',
      answer: null,
      phase: 'idle',
      loadingSources: true,
      errorCode: null,
      errorUsage: null,
      errorDetails: null,
    });
    try {
      const source = await this.bridge.getActiveSource();
      if (this.disposed || generation !== this.sourceGeneration) return;
      this.update({
        sourceId: source?.id ?? '',
        sources: source ? [source] : [],
        loadingSources: false,
      });
    } catch (error) {
      if (!this.disposed && generation === this.sourceGeneration)
        this.update({ loadingSources: false, errorCode: safeErrorCode(error) });
    }
  };

  editQuestion = (text: string) => {
    if (this.disposed) return;
    if (this.pending) this.cancel();
    this.question.editText(text);
  };

  startRecording = async () => {
    if (this.disposed || this.pending) return;
    if (!this.state.sourceId) {
      this.update({ errorCode: 'source_required', phase: 'error' });
      return;
    }
    this.speech.stopPlayback();
    this.update({ errorCode: null, errorUsage: null, errorDetails: null });
    await this.question.start();
  };

  ask = async (supplied = this.question.getSnapshot().text) => {
    if (this.disposed || this.pending) return;
    const question = supplied.trim();
    if (
      !question ||
      Array.from(question).length > VISUAL_LIMITS.questionCodePoints
    ) {
      this.update({
        phase: 'error',
        errorCode: 'invalid_question',
        errorUsage: null,
        errorDetails: null,
      });
      return;
    }
    const source = this.state.sources.find(
      (item) => item.id === this.state.sourceId,
    );
    if (!source) {
      this.update({
        phase: 'error',
        errorCode: 'source_required',
        errorUsage: null,
        errorDetails: null,
      });
      return;
    }
    this.question.cancel();
    this.speech.clear();
    const generation = ++this.generation;
    const pending = { id: crypto.randomUUID(), abort: new AbortController() };
    let stage: NonNullable<AssistantSnapshot['errorDetails']>['stage'] =
      'preparing';
    this.pending = pending;
    const current = () =>
      !this.disposed &&
      this.generation === generation &&
      this.pending === pending &&
      !pending.abort.signal.aborted;
    const timeout = setTimeout(() => {
      if (!current()) return;
      this.cancel();
      this.update({
        phase: 'error',
        errorCode: 'timeout',
        errorDetails: { requestId: pending.id, stage },
      });
    }, VISUAL_LIMITS.taskTimeoutMs);
    this.update({
      phase: 'preparing',
      answer: null,
      errorCode: null,
      errorUsage: null,
      errorDetails: null,
    });
    let capturedBytes: ArrayBuffer | null = null;
    try {
      const ticket = await this.bridge.prepareCapture(source.id, pending.id);
      if (!current()) return;
      if (
        ticket.epoch !== this.epoch ||
        ticket.requestId !== pending.id ||
        ticket.id !== source.id
      )
        throw Object.assign(new Error('Capture session changed'), {
          code: 'SESSION_EXPIRED',
        });
      stage = 'capturing';
      this.update({ phase: stage });
      const frame = await this.dependencies.capture(pending.abort.signal);
      capturedBytes = frame.bytes;
      if (!current()) return;
      stage = 'asking';
      this.update({ phase: stage });
      const responsePending = this.bridge.readScreen({
        captureId: ticket.captureId,
        requestId: pending.id,
        question,
        ...frame,
      });
      new Uint8Array(capturedBytes).fill(0);
      const parsed = desktopResponseSchema.safeParse(await responsePending);
      if (!current()) return;
      if (!parsed.success || parsed.data.request_id !== pending.id)
        throw Object.assign(new Error('Mismatched answer'), {
          code: 'INVALID_RESPONSE',
        });
      const response = parsed.data;
      this.pending = null;
      this.update({
        phase: 'ready',
        answer: { response, title: ticket.title, question },
      });
      this.speech.setLanguage(response.answer_language);
      this.speech.editText(response.text);
      // Deliberately not an effect: each accepted response gets one automatic attempt.
      void this.speech.readBack();
    } catch (error) {
      if (current()) {
        const usage = usageLimitSchema.safeParse(
          error && typeof error === 'object' && 'usage' in error
            ? error.usage
            : null,
        );
        this.update({
          phase: 'error',
          errorCode: safeErrorCode(error),
          errorUsage: usage.success ? usage.data : null,
          // Our attempt ID exists even when capture fails before any HTTP request.
          errorDetails: { requestId: pending.id, stage },
        });
      }
    } finally {
      if (capturedBytes) new Uint8Array(capturedBytes).fill(0);
      clearTimeout(timeout);
      if (this.pending === pending) this.pending = null;
      // Also releases an unused capture ticket after denial, encoding failure or timeout.
      void this.bridge.cancelOperation(pending.id).catch(() => {});
    }
  };

  cancel = () => {
    if (this.disposed) return;
    this.generation++;
    this.sourceGeneration++;
    const pending = this.pending;
    this.pending = null;
    pending?.abort.abort();
    if (pending) void this.bridge.cancelOperation(pending.id).catch(() => {});
    this.question.cancel();
    this.speech.cancel();
    this.update({
      phase: 'cancelled',
      loadingSources: false,
      errorCode: null,
      errorUsage: null,
      errorDetails: null,
    });
  };

  dispose = () => {
    this.cancel();
    this.removeQuestionListener();
    this.question.dispose();
    this.speech.dispose();
    this.state = { ...this.state, sources: [], sourceId: '', answer: null };
    this.disposed = true;
    this.listeners.clear();
  };
}
