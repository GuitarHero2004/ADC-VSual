import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  AUDIO_MAX_BYTES,
  DESKTOP_LIMITATIONS,
  VISUAL_LIMITS,
  desktopRequestSchema,
  desktopResponseSchema,
  fingerprintDesktopSnapshot,
  transcriptResponseSchema,
  voiceErrorResponseSchema,
  speechSynthesisInputSchema,
  type DesktopSnapshot,
  type UsageLimit,
} from '@adc/contracts';
import type { DesktopAuth } from './auth.ts';
import type { DesktopConfigurationResult } from './config.ts';
import type {
  DesktopCaptureTicket,
  DesktopScreenInput,
  DesktopSource,
  DesktopSpeakInput,
  DesktopTranscribeInput,
} from './bridge.ts';

export class DesktopRequestError extends Error {
  readonly code: string;
  readonly requestId: string | undefined;
  readonly usage: UsageLimit | undefined;
  constructor(
    code: string,
    message: string,
    requestId?: string,
    usage?: UsageLimit,
  ) {
    super(message);
    this.code = code;
    this.requestId = requestId;
    this.usage = usage;
  }
}
const invalid = () =>
  new DesktopRequestError(
    'INVALID_INPUT',
    'The desktop request is invalid. Try again.',
  );
const cancelled = () =>
  new DesktopRequestError(
    'CANCELLED',
    'Cancelled. Your question is preserved.',
  );
const uuid = z.uuid();
const language = z.enum(['auto', 'en', 'vi']);
const sourceTitle = (name: string) =>
  Array.from(
    Array.from(name)
      .map((character) => {
        const code = character.codePointAt(0)!;
        return code < 32 || code === 127 ? ' ' : character;
      })
      .join('')
      .trim() || 'Window',
  )
    .slice(0, 160)
    .join('');
// Electron app windows and the native source list can differ in the trailing flag.
const sameWindow = (first: string, second: string) =>
  first.split(':').slice(0, 2).join(':') ===
  second.split(':').slice(0, 2).join(':');
export interface NativeSource {
  id: string;
  name: string;
}
type PendingCapture = DesktopCaptureTicket & {
  nativeId: string;
  userId: string;
  workspaceId: string | undefined;
  expiresAt: number;
  granted: boolean;
  startedAt: number;
};
type PreviousExchange = {
  requestId: string;
  sourceId: string;
  title: string;
  epoch: string;
  userId: string;
  workspaceId: string | undefined;
  question: string;
  answer: string;
};
type AuthOwner = Pick<DesktopAuth, 'authorized' | 'snapshot'>;
export interface AssistantDependencies {
  auth: AuthOwner;
  configuration(): DesktopConfigurationResult;
  sources(): Promise<NativeSource[]>;
  excludedSourceId(): string;
  fetch?: typeof fetch;
  now?: () => number;
}

/** One native owner binds requests to the verified account and selected window. */
export class DesktopAssistant {
  private readonly sources = new Map<string, NativeSource>();
  private readonly operations = new Map<
    string,
    { kind: string; controller: AbortController }
  >();
  private readonly used = new Set<string>();
  private pending: PendingCapture | undefined;
  private previousExchange: PreviousExchange | undefined;
  private generation = 0;
  private disposed = false;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly dependencies: AssistantDependencies;
  constructor(dependencies: AssistantDependencies) {
    this.dependencies = dependencies;
    this.fetcher = dependencies.fetch ?? fetch;
    this.now = dependencies.now ?? Date.now;
  }
  async listSources(): Promise<DesktopSource[]> {
    const version = this.generation;
    this.requireSession();
    const available = await this.dependencies.sources();
    if (this.disposed || version !== this.generation) throw cancelled();
    // Enumeration has no thumbnails: no pixel capture happens here.
    const previous = new Map(
      [...this.sources].map(([key, source]) => [source.id, key]),
    );
    this.sources.clear();
    for (const source of available.slice(0, 100)) {
      if (
        sameWindow(source.id, this.dependencies.excludedSourceId()) ||
        !source.id.startsWith('window:')
      )
        continue;
      const id = previous.get(source.id) ?? randomUUID();
      this.sources.set(id, { id: source.id, name: sourceTitle(source.name) });
    }
    if (this.previousExchange) {
      const previous = this.sources.get(this.previousExchange.sourceId);
      if (!previous || previous.name !== this.previousExchange.title)
        this.clearContext();
    }
    return [...this.sources].map(([id, source]) => ({
      id,
      title: source.name,
    }));
  }
  /** Native identity is supplied only by the main-process activation owner. */
  async sourceForNative(
    nativeId: string | null,
  ): Promise<DesktopSource | null> {
    if (!nativeId || !/^window:[1-9][0-9]*:[01]$/.test(nativeId)) {
      this.clearContext();
      return null;
    }
    const sources = await this.listSources();
    const selected =
      sources.find((source) => {
        const native = this.sources.get(source.id);
        return native && sameWindow(native.id, nativeId);
      }) ?? null;
    if (
      this.previousExchange &&
      (selected?.id !== this.previousExchange.sourceId ||
        selected.title !== this.previousExchange.title)
    )
      this.clearContext();
    return selected;
  }
  async prepareCapture(
    sourceId: string,
    requestId: string,
  ): Promise<DesktopCaptureTicket> {
    if (!uuid.safeParse(sourceId).success || !uuid.safeParse(requestId).success)
      throw invalid();
    if (this.previousExchange && sourceId !== this.previousExchange.sourceId)
      this.clearContext();
    const operation = this.begin(requestId, 'screen');
    try {
      const identity = await this.dependencies.auth.authorized(
        operation.signal,
      );
      operation.signal.throwIfAborted();
      const source = this.sources.get(sourceId);
      if (!source)
        throw new DesktopRequestError(
          'SOURCE_UNAVAILABLE',
          'Switch to the intended app and press the VSual shortcut again before asking.',
        );
      const present = (await this.dependencies.sources()).find(
        (item) => item.id === source.id,
      );
      operation.signal.throwIfAborted();
      if (
        !present ||
        sameWindow(present.id, this.dependencies.excludedSourceId()) ||
        sourceTitle(present.name) !== source.name
      ) {
        this.clearContext();
        throw new DesktopRequestError(
          'SOURCE_UNAVAILABLE',
          'The selected window changed or closed. Switch to the intended app and press the VSual shortcut again.',
        );
      }
      const ticket: PendingCapture = {
        id: sourceId,
        title: source.name,
        captureId: randomUUID(),
        requestId,
        epoch: identity.epoch,
        nativeId: source.id,
        userId: identity.userId,
        workspaceId: this.workspaceId(),
        expiresAt: this.now() + VISUAL_LIMITS.captureStageTimeoutMs,
        granted: false,
        startedAt: this.now(),
      };
      this.pending = ticket;
      return {
        id: ticket.id,
        title: ticket.title,
        captureId: ticket.captureId,
        requestId,
        epoch: ticket.epoch,
      };
    } catch (error) {
      this.cancel(requestId);
      throw error;
    }
  }
  /** Called only by the owned frame's display-media permission handler. */
  async claimCaptureSource(): Promise<NativeSource | null> {
    const ticket = this.pending;
    if (
      !ticket ||
      ticket.granted ||
      ticket.expiresAt < this.now() ||
      !this.operations.has(ticket.requestId)
    )
      return null;
    if (this.dependencies.auth.snapshot().epoch !== ticket.epoch) return null;
    ticket.granted = true; // reserve before asynchronous enumeration
    const available = await this.dependencies.sources();
    if (
      this.pending !== ticket ||
      ticket.expiresAt < this.now() ||
      !this.operations.has(ticket.requestId) ||
      this.dependencies.auth.snapshot().epoch !== ticket.epoch ||
      this.dependencies.auth.snapshot().phase !== 'signed_in' ||
      this.dependencies.auth.snapshot().workspace !== 'allowed'
    )
      return null;
    return (
      available.find(
        (source) =>
          source.id === ticket.nativeId &&
          sourceTitle(source.name) === ticket.title &&
          !sameWindow(source.id, this.dependencies.excludedSourceId()),
      ) ?? null
    );
  }
  hasCaptureGrant() {
    return (
      !!this.pending &&
      this.pending.expiresAt >= this.now() &&
      this.operations.has(this.pending.requestId)
    );
  }
  async readScreen(value: DesktopScreenInput) {
    try {
      return await this.readScreenBytes(value);
    } finally {
      if (value?.bytes instanceof ArrayBuffer)
        new Uint8Array(value.bytes).fill(0);
    }
  }
  private async readScreenBytes(value: DesktopScreenInput) {
    const input = z
      .strictObject({
        captureId: uuid,
        requestId: uuid,
        question: z.string().min(1).max(4000),
        followUpRequestId: uuid.optional(),
        bytes: z.instanceof(ArrayBuffer),
        width: z.number().int().positive().max(VISUAL_LIMITS.longestSide),
        height: z.number().int().positive().max(VISUAL_LIMITS.longestSide),
        capturedAt: z.iso.datetime(),
      })
      .parse(value);
    const ticket = this.pending;
    const active = this.operations.get(input.requestId);
    if (
      !ticket ||
      !ticket.granted ||
      ticket.captureId !== input.captureId ||
      ticket.requestId !== input.requestId ||
      !active ||
      ticket.expiresAt < this.now() ||
      !this.isCurrentIdentity(ticket)
    )
      throw cancelled();
    this.pending = undefined; // pixels can be dispatched only once for this ticket
    const signal = active.controller.signal;
    const bytes = Buffer.from(input.bytes);
    try {
      const previous = this.previousExchange;
      if (
        input.followUpRequestId &&
        (!previous ||
          previous.requestId !== input.followUpRequestId ||
          previous.sourceId !== ticket.id ||
          previous.title !== ticket.title ||
          previous.epoch !== ticket.epoch ||
          previous.userId !== ticket.userId ||
          previous.workspaceId !== ticket.workspaceId)
      )
        throw new DesktopRequestError(
          'SOURCE_UNAVAILABLE',
          'This follow-up belongs to an earlier answer or window. Ask a new question about the current window.',
        );
      if (
        !bytes.length ||
        bytes.length > VISUAL_LIMITS.imageBytes ||
        input.width * input.height > VISUAL_LIMITS.imagePixels
      )
        throw new DesktopRequestError(
          'INPUT_TOO_LARGE',
          'The captured image is too large. Choose a smaller window.',
        );
      const captured = Date.parse(input.capturedAt);
      if (captured < ticket.startedAt - 1000 || captured > this.now() + 1000)
        throw invalid();
      const available = await this.dependencies.sources();
      signal.throwIfAborted();
      if (
        !available.some(
          (source) =>
            source.id === ticket.nativeId &&
            sourceTitle(source.name) === ticket.title,
        )
      ) {
        this.clearContext();
        throw new DesktopRequestError(
          'SOURCE_UNAVAILABLE',
          'The selected window changed or closed. Capture it again.',
        );
      }
      const metadata = {
        id: 'image-1' as const,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        captured_at: input.capturedAt,
        width: input.width,
        height: input.height,
        redactions: [],
      };
      const snapshot: DesktopSnapshot = {
        source_kind: 'desktop_window',
        snapshot_id: randomUUID(),
        source_id: ticket.id,
        title: ticket.title,
        captured_at: input.capturedAt,
        fingerprint: '0'.repeat(64),
        images: [metadata],
        limitations: [...DESKTOP_LIMITATIONS],
      };
      snapshot.fingerprint = await fingerprintDesktopSnapshot(snapshot);
      const body = desktopRequestSchema.parse({
        request_id: input.requestId,
        question: input.question,
        consent: true,
        snapshot,
        images: [
          {
            id: 'image-1',
            mime_type: 'image/jpeg',
            base64: bytes.toString('base64'),
          },
        ],
        ...(input.followUpRequestId && previous
          ? {
              follow_up_context: {
                request_id: previous.requestId,
                source_id: previous.sourceId,
                question: previous.question,
                answer: previous.answer,
              },
            }
          : {}),
      });
      const response = desktopResponseSchema.parse(
        await this.post(
          '/api/desktop-read',
          JSON.stringify(body),
          input.requestId,
          signal,
          true,
        ),
      );
      signal.throwIfAborted();
      if (
        response.request_id !== input.requestId ||
        response.snapshot_id !== snapshot.snapshot_id ||
        response.source_id !== ticket.id ||
        response.fingerprint !== snapshot.fingerprint ||
        response.captured_at !== snapshot.captured_at ||
        !this.isCurrentIdentity(ticket)
      )
        throw cancelled();
      const currentSources = await this.dependencies.sources();
      signal.throwIfAborted();
      if (
        !this.isCurrentIdentity(ticket) ||
        !currentSources.some(
          (source) =>
            source.id === ticket.nativeId &&
            sourceTitle(source.name) === ticket.title,
        )
      ) {
        this.clearContext();
        throw new DesktopRequestError(
          'SOURCE_UNAVAILABLE',
          'The selected window changed or closed. Ask again about the current window.',
        );
      }
      this.previousExchange = {
        requestId: input.requestId,
        sourceId: ticket.id,
        title: ticket.title,
        epoch: ticket.epoch,
        userId: ticket.userId,
        workspaceId: ticket.workspaceId,
        question: body.question,
        answer: response.text,
      };
      return response;
    } finally {
      bytes.fill(0);
      this.finish(input.requestId, active.controller);
    }
  }
  async transcribe(value: DesktopTranscribeInput) {
    try {
      return await this.transcribeBytes(value);
    } finally {
      if (value?.bytes instanceof ArrayBuffer)
        new Uint8Array(value.bytes).fill(0);
    }
  }
  private async transcribeBytes(value: DesktopTranscribeInput) {
    const input = z
      .strictObject({
        requestId: uuid,
        bytes: z.instanceof(ArrayBuffer),
        mimeType: z.string().max(80),
        filename: z.string().max(50),
        language,
      })
      .parse(value);
    if (!input.bytes.byteLength || input.bytes.byteLength > AUDIO_MAX_BYTES)
      throw new DesktopRequestError(
        'INPUT_TOO_LARGE',
        'Recording is empty or too large. Record again.',
      );
    const extensions: Record<string, string> = {
      'audio/webm': 'webm',
      'audio/ogg': 'ogg',
      'audio/mp4': 'm4a',
    };
    const extension = extensions[input.mimeType.split(';')[0] ?? ''];
    if (!extension || input.filename !== `recording.${extension}`)
      throw invalid();
    const controller = this.begin(input.requestId, 'transcribe');
    try {
      const form = new FormData();
      form.set(
        'audio',
        new Blob([input.bytes], { type: input.mimeType }),
        `recording.${extension}`,
      );
      form.set('language', input.language);
      const result = transcriptResponseSchema.parse(
        await this.post(
          '/api/voice/transcribe',
          form,
          input.requestId,
          controller.signal,
        ),
      );
      if (result.request_id !== input.requestId) throw cancelled();
      return result;
    } finally {
      new Uint8Array(input.bytes).fill(0);
      this.finish(input.requestId, controller);
    }
  }
  async speak(value: DesktopSpeakInput): Promise<ArrayBuffer> {
    const input = z
      .strictObject({ requestId: uuid, text: z.string(), language })
      .parse(value);
    const body = speechSynthesisInputSchema.parse({
      text: input.text,
      ...(input.language === 'auto' ? {} : { language: input.language }),
    });
    const controller = this.begin(input.requestId, 'speak');
    try {
      return (await this.post(
        '/api/voice/speak',
        JSON.stringify(body),
        input.requestId,
        controller.signal,
        true,
        true,
      )) as ArrayBuffer;
    } finally {
      this.finish(input.requestId, controller);
    }
  }
  cancel(requestId: string) {
    this.operations.get(requestId)?.controller.abort();
    this.operations.delete(requestId);
    if (this.pending?.requestId === requestId) this.pending = undefined;
  }
  suspend() {
    for (const id of this.operations.keys()) this.cancel(id);
    this.pending = undefined;
  }
  reset() {
    this.generation++;
    this.suspend();
    this.sources.clear();
    this.previousExchange = undefined;
  }
  dispose() {
    this.disposed = true;
    this.reset();
  }
  private requireSession() {
    const state = this.dependencies.auth.snapshot();
    if (this.previousExchange && !this.isCurrentIdentity(this.previousExchange))
      this.clearContext();
    if (
      this.disposed ||
      state.phase !== 'signed_in' ||
      state.workspace !== 'allowed'
    )
      throw new DesktopRequestError(
        'UNAUTHENTICATED',
        'Sign in and check workspace access before reading a window.',
      );
  }
  private workspaceId() {
    const configuration = this.dependencies.configuration();
    return configuration.ok ? configuration.value.workspaceId : undefined;
  }
  private isCurrentIdentity(identity: {
    epoch: string;
    userId: string;
    workspaceId: string | undefined;
  }) {
    const state = this.dependencies.auth.snapshot();
    return (
      state.phase === 'signed_in' &&
      state.workspace === 'allowed' &&
      state.epoch === identity.epoch &&
      state.account?.id === identity.userId &&
      this.workspaceId() === identity.workspaceId
    );
  }
  private clearContext() {
    this.previousExchange = undefined;
    for (const [id, operation] of this.operations)
      if (operation.kind === 'screen') this.cancel(id);
  }
  private begin(id: string, kind: string) {
    this.requireSession();
    if (!uuid.safeParse(id).success || this.used.has(id)) throw cancelled();
    for (const [otherId, active] of this.operations)
      if (active.kind === kind) this.cancel(otherId);
    this.used.add(id);
    if (this.used.size > 256)
      this.used.delete(this.used.values().next().value!);
    const controller = new AbortController();
    this.operations.set(id, { kind, controller });
    return controller;
  }
  private finish(id: string, controller: AbortController) {
    if (this.operations.get(id)?.controller === controller)
      this.operations.delete(id);
  }
  private async post(
    path: string,
    body: BodyInit,
    id: string,
    signal: AbortSignal,
    json = false,
    audio = false,
  ): Promise<unknown> {
    const configuration = this.dependencies.configuration();
    if (!configuration.ok)
      throw new DesktopRequestError(
        'SETUP_REQUIRED',
        'Desktop connection settings are missing.',
      );
    const timeout = AbortSignal.timeout(VISUAL_LIMITS.taskTimeoutMs);
    const bounded = AbortSignal.any([signal, timeout]);
    const identity = await this.dependencies.auth.authorized(bounded);
    bounded.throwIfAborted();
    try {
      const response = await this.fetcher(
        new URL(path, configuration.value.apiBaseUrl),
        {
          method: 'POST',
          headers: {
            ...identity.headers,
            'X-Request-ID': id,
            ...(json ? { 'Content-Type': 'application/json' } : {}),
          },
          body,
          signal: bounded,
          redirect: 'error',
          cache: 'no-store',
        },
      );
      const bytes = await readBounded(
        response,
        response.ok && audio ? 4 * 1024 * 1024 : 128 * 1024,
        bounded,
      );
      bounded.throwIfAborted();
      if (this.dependencies.auth.snapshot().epoch !== identity.epoch)
        throw cancelled();
      if (!response.ok) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(new TextDecoder().decode(bytes));
        } catch {
          /* Hosting error, not a verified auth rejection. */
        }
        const failure = voiceErrorResponseSchema.safeParse(parsed);
        if (failure.success)
          throw new DesktopRequestError(
            failure.data.error.code,
            failure.data.error.message,
            failure.data.request_id,
            failure.data.error.usage,
          );
        throw new DesktopRequestError(
          'PROVIDER_FAILURE',
          'The backend returned an unexpected response. Check its availability or deployment protection.',
          id,
        );
      }
      if (audio) {
        if (
          response.headers.get('content-type')?.split(';')[0] !==
            'audio/mpeg' ||
          !bytes.byteLength
        )
          throw new DesktopRequestError(
            'PROVIDER_FAILURE',
            'Speech audio is unavailable.',
            id,
          );
        return bytes;
      }
      return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    } catch (error) {
      if (signal.aborted) throw cancelled();
      if (timeout.aborted)
        throw new DesktopRequestError(
          'TIMEOUT',
          'The request took too long. Your text is preserved.',
          id,
        );
      if (error instanceof DesktopRequestError) throw error;
      throw new DesktopRequestError(
        'PROVIDER_FAILURE',
        'Cannot reach the backend or validate its response. Your text is preserved.',
        id,
      );
    }
  }
}

async function readBounded(
  response: Response,
  limit: number,
  signal: AbortSignal,
): Promise<ArrayBuffer> {
  if (!response.body) throw invalid();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  const abort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > limit) throw invalid();
      chunks.push(part.value);
    }
    signal.throwIfAborted();
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes.buffer;
  } finally {
    signal.removeEventListener('abort', abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
