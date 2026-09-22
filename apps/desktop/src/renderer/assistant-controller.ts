import {
  desktopResponseSchema,
  desktopSpeechText,
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
import type {
  DesktopActivationEvent,
  DesktopBridge,
  DesktopSource,
} from '../bridge.ts';

export const DESKTOP_RECORDING_MAX_MS = 60_000;

/** Only standalone option phrases are commands; names and arbitrary numbers stay questions. */
function spokenChoice(text: string): number | null {
  const value = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replaceAll('đ', 'd')
    .toLowerCase()
    .replace(/[.!?,]+$/g, '')
    .trim();
  const match =
    /^(?:(?:choose|option|choose option|chon|lua chon|cau|cau hoi|so)\s+)?(\d+|one|two|three|four|five|mot|hai|ba|bon|nam)$/.exec(
      value,
    );
  if (!match) return null;
  const words: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    mot: 1,
    hai: 2,
    ba: 3,
    bon: 4,
    nam: 5,
  };
  return words[match[1]!] ?? Number(match[1]);
}
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
  private readonly beforeWork: () => void;
  private readonly activationIds = new Set<string>();

  constructor(
    bridge: DesktopBridge,
    epoch: string,
    dependencies: AssistantDependencies,
    beforeWork: () => void = () => {},
  ) {
    this.bridge = bridge;
    this.epoch = epoch;
    this.dependencies = dependencies;
    this.beforeWork = beforeWork;
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
      recordingStartCue: true,
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
    const previous =
      this.state.sources.find((item) => item.id === this.state.sourceId) ??
      this.state.sources[0];
    const generation = ++this.sourceGeneration;
    this.update({
      sourceId: '',
      phase: 'idle',
      loadingSources: true,
      errorCode: null,
      errorUsage: null,
      errorDetails: null,
    });
    try {
      const source = await this.bridge.getActiveSource();
      if (this.disposed || generation !== this.sourceGeneration) return;
      const sameSource =
        source?.id === previous?.id && source?.title === previous?.title;
      if (!sameSource) this.speech.clear();
      this.update({
        sourceId: source?.id ?? '',
        sources: source ? [source] : [],
        loadingSources: false,
        answer: sameSource ? this.state.answer : null,
        phase: sameSource && this.state.answer ? 'ready' : 'idle',
      });
    } catch (error) {
      if (!this.disposed && generation === this.sourceGeneration) {
        this.speech.clear();
        this.update({
          sourceId: '',
          sources: [],
          answer: null,
          loadingSources: false,
          errorCode: safeErrorCode(error),
        });
      }
    }
  };

  /** One trusted shortcut intent, never inferred from focus, login or rerenders. */
  activate = async (event: DesktopActivationEvent) => {
    if (this.disposed || this.activationIds.has(event.id)) return;
    this.activationIds.add(event.id);
    // A bounded session-only replay guard. The preload also rejects duplicate IDs.
    if (this.activationIds.size > 64)
      this.activationIds.delete(this.activationIds.values().next().value!);
    if (event.kind === 'open') {
      await this.useActiveSource();
      return;
    }
    this.beforeWork();
    const phase = this.question.getSnapshot().phase;
    if (phase === 'recording') {
      // Synchronous: disarm the silence timer before waiting on native metadata.
      this.question.finish();
      return;
    }
    if (
      this.pending ||
      this.state.loadingSources ||
      phase === 'requesting_permission' ||
      phase === 'transcribing' ||
      this.speech.getSnapshot().phase === 'generating'
    ) {
      this.cancel();
      return;
    }
    // Playback stops before source lookup or a microphone permission request.
    this.speech.stopPlayback();
    const selecting = this.useActiveSource();
    const generation = this.generation;
    await selecting;
    if (this.disposed || generation !== this.generation) return;
    await this.startRecording();
  };

  editQuestion = (text: string) => {
    if (this.disposed) return;
    if (this.pending) this.cancel();
    this.question.editText(text);
  };

  startRecording = async () => {
    if (this.disposed || this.pending || this.state.loadingSources) return;
    this.beforeWork();
    if (!this.state.sourceId) {
      this.update({ errorCode: 'source_required', phase: 'error' });
      return;
    }
    this.speech.stopPlayback();
    this.update({ errorCode: null, errorUsage: null, errorDetails: null });
    await this.question.start();
  };

  chooseFollowUp = async (index: number, requestId: string) => {
    if (this.disposed || this.pending || this.state.loadingSources) return;
    if (
      ['requesting_permission', 'recording', 'transcribing'].includes(
        this.question.getSnapshot().phase,
      )
    )
      return;
    const answer = this.state.answer;
    const option = answer?.response.follow_ups[index];
    if (
      !Number.isInteger(index) ||
      !option ||
      answer.response.request_id !== requestId
    ) {
      this.update({
        phase: 'error',
        errorCode: 'invalid_choice',
        errorUsage: null,
        errorDetails: null,
      });
      return;
    }
    this.question.editText(option.question);
    await this.ask(option.question, requestId);
  };

  askSomethingElse = () => {
    if (this.disposed) return;
    this.cancel();
    this.question.clear();
    this.speech.clear();
    this.update({ answer: null, phase: 'idle' });
  };

  ask = async (
    supplied = this.question.getSnapshot().text,
    expectedRequestId?: string,
  ) => {
    if (this.disposed || this.pending || this.state.loadingSources) return;
    this.beforeWork();
    const previous = this.state.answer;
    if (
      expectedRequestId &&
      previous?.response.request_id !== expectedRequestId
    )
      return;
    let question = supplied.trim();
    const choice = previous?.response.follow_ups.length
      ? spokenChoice(question)
      : null;
    if (choice !== null) {
      const option = previous!.response.follow_ups[choice - 1];
      if (!option) {
        this.question.cancel();
        this.speech.stopPlayback();
        this.update({
          phase: 'error',
          errorCode: 'invalid_choice',
          errorUsage: null,
          errorDetails: null,
        });
        return;
      }
      question = option.question;
      this.question.editText(question);
    }
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
    this.speech.stopPlayback();
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
      errorCode: null,
      errorUsage: null,
      errorDetails: null,
    });
    let capturedBytes: ArrayBuffer | null = null;
    try {
      if (previous) {
        // Recheck the native target before using a previous exchange; never carry it to another app.
        const active = await this.bridge.getActiveSource();
        if (!current()) return;
        if (active?.id !== source.id || active.title !== source.title) {
          this.speech.clear();
          this.update({
            answer: null,
            sourceId: active?.id ?? '',
            sources: active ? [active] : [],
          });
          throw Object.assign(new Error('Follow-up source changed'), {
            code: 'SOURCE_CHANGED',
          });
        }
      }
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
        ...(previous
          ? { followUpRequestId: previous.response.request_id }
          : {}),
        ...frame,
      });
      new Uint8Array(capturedBytes).fill(0);
      const parsed = desktopResponseSchema.safeParse(await responsePending);
      if (!current()) return;
      if (
        !parsed.success ||
        parsed.data.request_id !== pending.id ||
        parsed.data.source_id !== source.id
      )
        throw Object.assign(new Error('Mismatched answer'), {
          code: 'INVALID_RESPONSE',
        });
      const response = parsed.data;
      this.pending = null;
      this.update({
        phase: 'ready',
        answer: { response, title: ticket.title, question },
      });
      this.speech.clear();
      this.speech.setLanguage(response.answer_language);
      this.speech.editText(desktopSpeechText(response));
      // Deliberately not an effect: each accepted response gets one automatic attempt.
      void this.speech.readBack();
    } catch (error) {
      if (current()) {
        const code = safeErrorCode(error);
        if (previous && code === 'source_unavailable') {
          this.speech.clear();
          this.update({ answer: null });
        }
        const usage = usageLimitSchema.safeParse(
          error && typeof error === 'object' && 'usage' in error
            ? error.usage
            : null,
        );
        this.update({
          phase: 'error',
          errorCode: code,
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
