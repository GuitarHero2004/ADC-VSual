import 'server-only';
import { z } from 'zod';
import {
  VISUAL_LIMITS,
  fingerprintVisualSnapshot,
  visualRequestSchema,
  visualResponseSchema,
  type VisualRequest,
  type VisualResponse,
} from '@adc/contracts';
import type { VoiceIdentity } from '../voice/access.ts';
import { VoiceError } from '../voice/errors.ts';
import { applicationLimitDetails, corsHeaders } from '../voice/http.ts';
import {
  VisualFailure,
  type VisualProviderDiagnostics,
} from './visual-server.ts';

type Dependencies = {
  verifyVoiceUser: (request: Request) => Promise<VoiceIdentity>;
  reserveVoiceRequest: (
    identity: VoiceIdentity,
    requestId: string,
  ) => Promise<void>;
  prepareVisualInput: (input: VisualRequest) => unknown;
  validateVisualImages: (
    input: VisualRequest,
    signal: AbortSignal,
  ) => Promise<void>;
  answerVisualPage: (
    input: VisualRequest,
    signal: AbortSignal,
    diagnostics?: VisualProviderDiagnostics,
  ) => Promise<VisualResponse>;
};
const invalid = (
  message = 'The question or captured page is invalid. Capture the page again.',
) => new VoiceError('INVALID_INPUT', message, 400);
const tooLarge = () =>
  new VoiceError(
    'INPUT_TOO_LARGE',
    'The captured request is too large. Choose a shorter section or page.',
    413,
  );

async function readInput(
  request: Request,
  signal: AbortSignal,
): Promise<VisualRequest> {
  if (
    request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !==
    'application/json'
  )
    throw invalid('Send the question and captured page as JSON.');
  const declared = request.headers.get('content-length');
  if (
    declared &&
    (!/^\d+$/.test(declared) || Number(declared) > VISUAL_LIMITS.bodyBytes)
  )
    throw tooLarge();
  if (!request.body) throw invalid();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > VISUAL_LIMITS.bodyBytes) throw tooLarge();
      chunks.push(value);
    }
    signal.throwIfAborted();
  } finally {
    signal.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  let value: unknown;
  try {
    value = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)),
    );
  } catch {
    throw invalid();
  }
  const parsed = visualRequestSchema.safeParse(value);
  if (!parsed.success) throw invalid();
  return parsed.data;
}

async function validateSource(input: VisualRequest) {
  const age = Date.now() - Date.parse(input.snapshot.captured_at);
  if (age > 30_000 || age < -5_000)
    throw invalid(
      'The captured page is out of date. Capture it again before asking.',
    );
  if (
    (await fingerprintVisualSnapshot(input.snapshot)) !==
    input.snapshot.fingerprint
  )
    throw invalid('The captured page has changed. Capture it again.');
}

/** Bounds even a slow auth/database stage without letting its late result dispatch AI. */
function withinDeadline<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const cancelled = () => reject(signal.reason);
    signal.addEventListener('abort', cancelled, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', cancelled);
        if (signal.aborted) reject(signal.reason);
        else resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', cancelled);
        reject(error);
      },
    );
    if (signal.aborted) cancelled();
  });
}

export function createVisualHandler(dependencies: Dependencies) {
  return async (request: Request): Promise<Response> => {
    const started = performance.now();
    const provider: VisualProviderDiagnostics = { provider_attempted: false };
    let images:
      | {
          image_count: number;
          image_dimensions: [number, number][];
          image_bytes: number;
        }
      | undefined;
    let stage:
      | 'origin'
      | 'authentication'
      | 'input'
      | 'source_validation'
      | 'input_budget'
      | 'image_validation'
      | 'usage_reservation'
      | 'provider'
      | 'response_validation' = 'origin';
    let id: string = crypto.randomUUID();
    let headers = new Headers({ 'Cache-Control': 'no-store', Vary: 'Origin' });
    const deadline = new AbortController();
    const timer = setTimeout(
      () =>
        deadline.abort(
          new DOMException('Task deadline exceeded', 'TimeoutError'),
        ),
      VISUAL_LIMITS.backendTimeoutMs,
    );
    const signal = AbortSignal.any([request.signal, deadline.signal]);
    try {
      headers = corsHeaders(request);
      const requestedId = request.headers.get('x-request-id');
      if (requestedId) {
        if (!z.uuid().safeParse(requestedId).success)
          throw invalid('Invalid request identifier.');
        id = requestedId;
      }
      signal.throwIfAborted();
      stage = 'authentication';
      const identity = await withinDeadline(
        dependencies.verifyVoiceUser(request),
        signal,
      );
      signal.throwIfAborted();
      stage = 'input';
      const input = await withinDeadline(readInput(request, signal), signal);
      if (requestedId && requestedId !== input.request_id)
        throw invalid('Request identifiers do not match.');
      id = input.request_id;
      stage = 'source_validation';
      await withinDeadline(validateSource(input), signal);
      // Configuration and the complete token-bound check happen before reserving usage.
      stage = 'input_budget';
      dependencies.prepareVisualInput(input);
      stage = 'image_validation';
      await withinDeadline(
        dependencies.validateVisualImages(input, signal),
        signal,
      );
      signal.throwIfAborted();
      images = {
        image_count: input.images.length,
        image_dimensions: input.snapshot.images.map((image) => [
          image.width,
          image.height,
        ]),
        image_bytes: input.images.reduce(
          (bytes, image) => bytes + Buffer.byteLength(image.base64, 'base64'),
          0,
        ),
      };
      stage = 'usage_reservation';
      await withinDeadline(
        dependencies.reserveVoiceRequest(identity, id),
        signal,
      );
      signal.throwIfAborted();
      stage = 'provider';
      const result = await withinDeadline(
        dependencies.answerVisualPage(input, signal, provider),
        signal,
      );
      signal.throwIfAborted();
      stage = 'response_validation';
      const response = visualResponseSchema.parse(result);
      if (
        response.request_id !== id ||
        response.snapshot_id !== input.snapshot.snapshot_id ||
        response.fingerprint !== input.snapshot.fingerprint
      )
        throw invalid('The answer source does not match this request.');
      // Adapters cannot change scope/coverage or cite unrelated images.
      if (
        response.scope !== input.snapshot.scope ||
        JSON.stringify(response.coverage) !==
          JSON.stringify(input.snapshot.coverage) ||
        response.evidence.some(
          (item) =>
            !input.snapshot.images.some((image) => image.id === item.image_id),
        )
      ) {
        throw new VoiceError(
          'PROVIDER_FAILURE',
          'The answer did not match the captured images. Your question is preserved.',
          502,
          true,
        );
      }
      headers.set('X-Request-ID', id);
      return Response.json(response, { headers });
    } catch (error) {
      const safe = request.signal.aborted
        ? new VoiceError('CANCELLED', 'The page request was cancelled.', 499)
        : deadline.signal.aborted
          ? new VoiceError(
              'TIMEOUT',
              'The page request took too long. Your question is preserved; try again.',
              504,
              true,
            )
          : error instanceof VoiceError
            ? error
            : new VoiceError(
                'PROVIDER_FAILURE',
                'The page answer could not be completed. Your question is preserved; try again.',
                502,
                true,
              );
      headers.set('X-Request-ID', id);
      if (safe.status >= 500) {
        // Operational metadata only: never serialize errors, provider bodies,
        // images, source URLs, questions, answers, tokens, or credentials.
        console.warn(
          JSON.stringify({
            event: 'visual_request_failed',
            request_id: id,
            stage:
              stage === 'provider' ? (provider.provider_stage ?? stage) : stage,
            reason:
              error instanceof VisualFailure
                ? error.reason
                : 'operation_failed',
            code: safe.code,
            status: safe.status,
            duration_ms: Math.round(performance.now() - started),
            ...provider,
            ...images,
          }),
        );
      }
      return Response.json(
        {
          request_id: id,
          error: {
            code: safe.code,
            message: safe.message,
            retryable: safe.retryable,
            ...applicationLimitDetails(safe, request, id, headers),
          },
        },
        { status: safe.status, headers },
      );
    } finally {
      clearTimeout(timer);
    }
  };
}
