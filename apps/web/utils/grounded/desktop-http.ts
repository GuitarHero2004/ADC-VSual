import 'server-only';
import { z } from 'zod';
import {
  VISUAL_LIMITS,
  desktopRequestSchema,
  desktopResponseSchema,
  fingerprintDesktopSnapshot,
  type DesktopRequest,
  type DesktopResponse,
} from '@adc/contracts';
import type { VoiceIdentity } from '../voice/access.ts';
import { VoiceError } from '../voice/errors.ts';
import { applicationLimitDetails, corsHeaders } from '../voice/http.ts';
import {
  VisualFailure,
  type VisualProviderDiagnostics,
} from './visual-server.ts';

type Dependencies = {
  verifyVoiceUser(request: Request): Promise<VoiceIdentity>;
  reserveVoiceRequest(
    identity: VoiceIdentity,
    requestId: string,
  ): Promise<void>;
  prepareDesktopInput(input: DesktopRequest): unknown;
  validateDesktopImages(
    input: DesktopRequest,
    signal: AbortSignal,
  ): Promise<void>;
  answerDesktopWindow(
    input: DesktopRequest,
    signal: AbortSignal,
    diagnostics?: VisualProviderDiagnostics,
  ): Promise<DesktopResponse>;
};
const invalid = (
  message = 'The question or captured window is invalid. Capture it again.',
) => new VoiceError('INVALID_INPUT', message, 400);
const tooLarge = () =>
  new VoiceError(
    'INPUT_TOO_LARGE',
    'The captured request is too large. Choose a smaller window.',
    413,
  );

async function readInput(
  request: Request,
  signal: AbortSignal,
): Promise<DesktopRequest> {
  if (
    request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !==
    'application/json'
  )
    throw invalid('Send the question and captured window as JSON.');
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
  const parsed = desktopRequestSchema.safeParse(value);
  if (!parsed.success) throw invalid();
  return parsed.data;
}

async function validateSource(input: DesktopRequest) {
  const age = Date.now() - Date.parse(input.snapshot.captured_at);
  if (age > 30_000 || age < -5_000)
    throw invalid(
      'The captured window is out of date. Capture it again before asking.',
    );
  if (
    (await fingerprintDesktopSnapshot(input.snapshot)) !==
    input.snapshot.fingerprint
  )
    throw invalid(
      'The captured window metadata has changed. Capture it again.',
    );
}

/** A late auth/database result must never start provider work after cancellation. */
function withinDeadline<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
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

export function createDesktopHandler(dependencies: Dependencies) {
  return async (request: Request): Promise<Response> => {
    const started = performance.now();
    const provider: VisualProviderDiagnostics = { provider_attempted: false };
    let image:
      { image_dimensions: [number, number]; image_bytes: number } | undefined;
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
      stage = 'input_budget';
      dependencies.prepareDesktopInput(input);
      stage = 'image_validation';
      await withinDeadline(
        dependencies.validateDesktopImages(input, signal),
        signal,
      );
      signal.throwIfAborted();
      image = {
        image_dimensions: [
          input.snapshot.images[0].width,
          input.snapshot.images[0].height,
        ],
        image_bytes: Buffer.byteLength(input.images[0].base64, 'base64'),
      };
      stage = 'usage_reservation';
      await withinDeadline(
        dependencies.reserveVoiceRequest(identity, id),
        signal,
      );
      signal.throwIfAborted();
      stage = 'provider';
      const result = await withinDeadline(
        dependencies.answerDesktopWindow(input, signal, provider),
        signal,
      );
      signal.throwIfAborted();
      stage = 'response_validation';
      const response = desktopResponseSchema.parse(result);
      if (
        response.request_id !== id ||
        response.snapshot_id !== input.snapshot.snapshot_id ||
        response.source_id !== input.snapshot.source_id ||
        response.fingerprint !== input.snapshot.fingerprint ||
        response.captured_at !== input.snapshot.captured_at
      )
        throw new VisualFailure('schema');
      headers.set('X-Request-ID', id);
      return Response.json(response, { headers });
    } catch (error) {
      const safe = request.signal.aborted
        ? new VoiceError('CANCELLED', 'The window request was cancelled.', 499)
        : deadline.signal.aborted
          ? new VoiceError(
              'TIMEOUT',
              'The window request took too long. Your question is preserved; try again.',
              504,
              true,
            )
          : error instanceof VoiceError
            ? error
            : new VoiceError(
                'PROVIDER_FAILURE',
                'The window answer could not be completed. Your question is preserved; try again.',
                502,
                true,
              );
      headers.set('X-Request-ID', id);
      if (safe.status >= 500)
        console.warn(
          JSON.stringify({
            event: 'desktop_request_failed',
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
            ...image,
          }),
        );
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
