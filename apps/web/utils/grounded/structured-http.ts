import 'server-only';
import { z } from 'zod';
import {
  STRUCTURED_LIMITS,
  fingerprintStructuredSnapshot,
  structuredRequestSchema,
  structuredResponseSchema,
  type StructuredRequest,
  type StructuredResponse,
} from '@adc/contracts';
import type { VoiceIdentity } from '../voice/access.ts';
import { VoiceError } from '../voice/errors.ts';
import { applicationLimitDetails, corsHeaders } from '../voice/http.ts';

type Dependencies = {
  verifyVoiceUser: (request: Request) => Promise<VoiceIdentity>;
  reserveVoiceRequest: (
    identity: VoiceIdentity,
    requestId: string,
  ) => Promise<void>;
  prepareStructuredInput: (input: StructuredRequest) => unknown;
  answerStructuredPage: (
    input: StructuredRequest,
    signal: AbortSignal,
  ) => Promise<StructuredResponse>;
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
): Promise<StructuredRequest> {
  if (
    request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !==
    'application/json'
  )
    throw invalid('Send the question and captured page as JSON.');
  const declared = request.headers.get('content-length');
  if (
    declared &&
    (!/^\d+$/.test(declared) || Number(declared) > STRUCTURED_LIMITS.bodyBytes)
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
      if (size > STRUCTURED_LIMITS.bodyBytes) throw tooLarge();
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
  const parsed = structuredRequestSchema.safeParse(value);
  if (!parsed.success) throw invalid();
  return parsed.data;
}

async function validateSource(input: StructuredRequest) {
  const age = Date.now() - Date.parse(input.snapshot.captured_at);
  if (age > 30_000 || age < -5_000)
    throw invalid(
      'The captured page is out of date. Capture it again before asking.',
    );
  if (
    (await fingerprintStructuredSnapshot(input.snapshot)) !==
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

export function createStructuredHandler(dependencies: Dependencies) {
  return async (request: Request): Promise<Response> => {
    let id: string = crypto.randomUUID();
    let headers = new Headers({ 'Cache-Control': 'no-store', Vary: 'Origin' });
    const deadline = new AbortController();
    const timer = setTimeout(
      () =>
        deadline.abort(
          new DOMException('Task deadline exceeded', 'TimeoutError'),
        ),
      STRUCTURED_LIMITS.taskTimeoutMs,
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
      const identity = await withinDeadline(
        dependencies.verifyVoiceUser(request),
        signal,
      );
      signal.throwIfAborted();
      const input = await withinDeadline(readInput(request, signal), signal);
      if (requestedId && requestedId !== input.request_id)
        throw invalid('Request identifiers do not match.');
      id = input.request_id;
      await withinDeadline(validateSource(input), signal);
      // Configuration and the complete token-bound check happen before reserving usage.
      dependencies.prepareStructuredInput(input);
      signal.throwIfAborted();
      await withinDeadline(
        dependencies.reserveVoiceRequest(identity, id),
        signal,
      );
      signal.throwIfAborted();
      const response = structuredResponseSchema.parse(
        await withinDeadline(
          dependencies.answerStructuredPage(input, signal),
          signal,
        ),
      );
      signal.throwIfAborted();
      if (
        response.request_id !== id ||
        response.snapshot_id !== input.snapshot.snapshot_id ||
        response.fingerprint !== input.snapshot.fingerprint
      )
        throw invalid('The answer source does not match this request.');
      // Defence in depth: provider adapters may not attach unrelated excerpt IDs.
      const expectedSections = input.snapshot.sections
        .filter(
          (section) => !input.section_id || section.id === input.section_id,
        )
        .map((section) => section.id);
      if (
        JSON.stringify(response.included_section_ids) !==
          JSON.stringify(expectedSections) ||
        response.partial !==
          (input.snapshot.coverage.partial ||
            expectedSections.length < input.snapshot.sections.length) ||
        response.evidence_ids.some(
          (id) =>
            !input.snapshot.blocks.some(
              (block) =>
                block.id === id && expectedSections.includes(block.section_id),
            ),
        )
      ) {
        throw new VoiceError(
          'PROVIDER_FAILURE',
          'The answer did not match the captured evidence. Your question is preserved.',
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
