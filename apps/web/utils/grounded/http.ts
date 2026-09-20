import 'server-only';
import { z } from 'zod';
import {
  fingerprintSnapshot,
  groundedOriginSchema,
  groundedRequestSchema,
  groundedResponseSchema,
  GROUNDED_MAX_BODY_BYTES,
  type ComparisonInterpretation,
  type GroundedRequest,
} from '@adc/contracts';
import type { VoiceIdentity } from '../voice/access.ts';
import { corsHeaders } from '../voice/http.ts';
import { VoiceError } from '../voice/errors.ts';
import { calculateComparison } from './comparison.ts';

type Dependencies = {
  verifyVoiceUser: (request: Request) => Promise<VoiceIdentity>;
  reserveVoiceRequest: (
    identity: VoiceIdentity,
    requestId: string,
  ) => Promise<void>;
  requireGroundedConfiguration: () => unknown;
  interpretComparison: (
    input: GroundedRequest,
    signal: AbortSignal,
  ) => Promise<ComparisonInterpretation>;
};

const invalid = (
  message = 'The question or captured table is invalid. Capture the supported page again.',
) => new VoiceError('INVALID_INPUT', message, 400);
const tooLarge = () =>
  new VoiceError(
    'INPUT_TOO_LARGE',
    'The captured request is too large. Use the supported orders table and a shorter question.',
    413,
  );

async function readInput(request: Request): Promise<GroundedRequest> {
  if (
    request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !==
    'application/json'
  ) {
    throw invalid('Send the question and captured table as JSON.');
  }
  const declared = request.headers.get('content-length');
  if (
    declared &&
    (!/^\d+$/.test(declared) || Number(declared) > GROUNDED_MAX_BODY_BYTES)
  )
    throw tooLarge();
  if (!request.body) throw invalid();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  request.signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      request.signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > GROUNDED_MAX_BODY_BYTES) throw tooLarge();
      chunks.push(value);
    }
    request.signal.throwIfAborted();
  } finally {
    request.signal.removeEventListener('abort', cancel);
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
  const parsed = groundedRequestSchema.safeParse(value);
  if (!parsed.success) throw invalid();
  return parsed.data;
}

function allowedOrigins() {
  const configured = process.env.GROUNDED_ALLOWED_ORIGINS;
  const values = (
    configured ??
    (process.env.NODE_ENV === 'production'
      ? ''
      : 'http://127.0.0.1:3000,http://localhost:3000')
  )
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (
    values.length === 0 ||
    values.length > 20 ||
    values.some((value) => !groundedOriginSchema.safeParse(value).success)
  ) {
    throw new VoiceError(
      'SETUP_REQUIRED',
      'Supported dashboard origins are not configured. Ask the project administrator to finish setup.',
      503,
    );
  }
  return values;
}

async function validateSource(input: GroundedRequest) {
  if (!allowedOrigins().includes(input.snapshot.origin)) {
    throw new VoiceError(
      'FORBIDDEN',
      'This source page is not supported. Open the configured orders dashboard.',
      403,
    );
  }
  const age = Date.now() - Date.parse(input.snapshot.captured_at);
  if (age > 30_000 || age < -5_000) {
    throw invalid(
      'The captured table is out of date. Capture the page again before asking.',
    );
  }
  if (
    (await fingerprintSnapshot(input.snapshot)) !== input.snapshot.fingerprint
  ) {
    throw invalid('The captured table has changed. Capture the page again.');
  }
}

function failure(
  error: unknown,
  request: Request,
  id: string,
  headers: Headers,
) {
  const safe = request.signal.aborted
    ? new VoiceError('CANCELLED', 'The answer request was cancelled.', 499)
    : error instanceof VoiceError
      ? error
      : new VoiceError(
          'PROVIDER_FAILURE',
          'The answer could not be completed. Your question is still available; try again.',
          502,
          true,
        );
  const messages: Partial<Record<typeof safe.code, string>> = {
    UNAUTHENTICATED:
      'Your session has expired or you are signed out. Sign in to ask VSual.',
    RATE_LIMITED:
      'Request limit reached. Try again later; your question is still available.',
    DUPLICATE_REQUEST:
      'This request was already submitted. Ask again only if you need a new answer.',
  };
  headers.set('X-Request-ID', id);
  return Response.json(
    {
      request_id: id,
      error: {
        code: safe.code,
        message: messages[safe.code] ?? safe.message,
        retryable: safe.retryable,
      },
    },
    { status: safe.status, headers },
  );
}

export function createGroundedHandler(dependencies: Dependencies) {
  return async (request: Request): Promise<Response> => {
    let id: string = crypto.randomUUID();
    let headers = new Headers({ 'Cache-Control': 'no-store', Vary: 'Origin' });
    try {
      headers = corsHeaders(request);
      const requestedId = request.headers.get('x-request-id');
      if (requestedId) {
        if (!z.uuid().safeParse(requestedId).success)
          throw invalid('Invalid request identifier.');
        id = requestedId;
      }
      request.signal.throwIfAborted();
      const identity = await dependencies.verifyVoiceUser(request);
      request.signal.throwIfAborted();
      const input = await readInput(request);
      if (requestedId && input.request_id !== requestedId)
        throw invalid('Request identifiers do not match.');
      id = input.request_id;
      headers.set('X-Request-ID', id);
      await validateSource(input);
      dependencies.requireGroundedConfiguration();
      request.signal.throwIfAborted();
      // Share the existing durable per-user limit; no new tables or evidence persistence.
      await dependencies.reserveVoiceRequest(identity, id);
      request.signal.throwIfAborted();
      const interpretation = await dependencies.interpretComparison(
        input,
        request.signal,
      );
      request.signal.throwIfAborted();
      const response = groundedResponseSchema.parse(
        calculateComparison(input, interpretation),
      );
      return Response.json(response, { headers });
    } catch (error) {
      return failure(error, request, id, headers);
    }
  };
}
