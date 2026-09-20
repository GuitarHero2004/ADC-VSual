import 'server-only';
import { z } from 'zod';
import { VoiceError } from './errors.ts';
import { readAudioInput, readSpeechInput } from './input.ts';
import type { VoiceIdentity } from './access.ts';
import type { SpeechSynthesisInput, RecognitionLanguage } from '@adc/contracts';

type Dependencies = {
  verifyVoiceUser: (request: Request) => Promise<VoiceIdentity>;
  reserveVoiceRequest: (
    identity: VoiceIdentity,
    requestId: string,
  ) => Promise<void>;
  requireVoiceConfiguration: (feature: 'speak' | 'transcribe') => unknown;
  transcribeAudio: (
    file: File,
    language: RecognitionLanguage,
    signal: AbortSignal,
  ) => Promise<{ transcript: string; detected_language?: string }>;
  synthesiseSpeech: (
    input: SpeechSynthesisInput,
    signal: AbortSignal,
  ) => Promise<Uint8Array<ArrayBuffer>>;
};

export function corsHeaders(request: Request) {
  const origin = request.headers.get('origin');
  const headers = new Headers({ 'Cache-Control': 'no-store', Vary: 'Origin' });
  if (!origin) {
    // Native/extension bearer clients may omit Origin; cookie calls must supply it.
    if (
      !request.headers.get('authorization')?.startsWith('Bearer ') &&
      request.method !== 'OPTIONS'
    ) {
      throw new VoiceError('FORBIDDEN', 'The request origin is missing.', 403);
    }
    return headers;
  }
  const configured = (process.env.VOICE_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  // Next may reconstruct request.url using its internal listen hostname.
  // Host is the browser's destination; browser scripts cannot override it.
  const requestUrl = new URL(request.url);
  const host = request.headers.get('host') ?? requestUrl.host;
  const publicUrl = URL.parse(`${requestUrl.protocol}//${host}`);
  if (
    !publicUrl ||
    publicUrl.username ||
    publicUrl.password ||
    publicUrl.pathname !== '/' ||
    publicUrl.search ||
    publicUrl.hash
  ) {
    throw new VoiceError('FORBIDDEN', 'The request origin is invalid.', 403);
  }
  const sameOrigin = publicUrl.origin;
  if (origin !== sameOrigin && !configured.includes(origin))
    throw new VoiceError(
      'FORBIDDEN',
      'This voice client is not allowed. Check extension setup.',
      403,
    );
  headers.set('Access-Control-Allow-Origin', origin);
  if (origin === sameOrigin)
    headers.set('Access-Control-Allow-Credentials', 'true');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  headers.set(
    'Access-Control-Allow-Headers',
    'Authorization, Content-Type, X-Request-ID, X-Workspace-ID',
  );
  headers.set('Access-Control-Expose-Headers', 'X-Request-ID');
  return headers;
}

function failure(
  error: unknown,
  request: Request,
  id: string,
  headers: Headers,
) {
  const safe = request.signal.aborted
    ? new VoiceError('CANCELLED', 'Voice request cancelled.', 499)
    : error instanceof VoiceError
      ? error
      : new VoiceError(
          'PROVIDER_FAILURE',
          'The voice request could not be completed. Please try again.',
          502,
          true,
        );
  return Response.json(
    {
      request_id: id,
      error: {
        code: safe.code,
        message: safe.message,
        retryable: safe.retryable,
      },
    },
    { status: safe.status, headers },
  );
}

export function voicePreflight(request: Request) {
  try {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  } catch (error) {
    return failure(
      error,
      request,
      crypto.randomUUID(),
      new Headers({ 'Cache-Control': 'no-store', Vary: 'Origin' }),
    );
  }
}

export function createVoiceHandler(
  feature: 'transcribe' | 'speak',
  dependencies: Dependencies,
) {
  return async (request: Request) => {
    let id: string = crypto.randomUUID();
    let headers = new Headers({ 'Cache-Control': 'no-store', Vary: 'Origin' });
    try {
      headers = corsHeaders(request);
      const requestedId = request.headers.get('x-request-id');
      if (requestedId) {
        if (!z.uuid().safeParse(requestedId).success)
          throw new VoiceError(
            'INVALID_INPUT',
            'Invalid request identifier.',
            400,
          );
        id = requestedId;
      }
      headers.set('X-Request-ID', id);
      request.signal.throwIfAborted();
      const identity = await dependencies.verifyVoiceUser(request);
      request.signal.throwIfAborted();
      const input =
        feature === 'transcribe'
          ? await readAudioInput(request)
          : await readSpeechInput(request);
      dependencies.requireVoiceConfiguration(feature);
      request.signal.throwIfAborted();
      await dependencies.reserveVoiceRequest(identity, id);
      request.signal.throwIfAborted();
      if ('file' in input) {
        const result = await dependencies.transcribeAudio(
          input.file,
          input.language,
          request.signal,
        );
        request.signal.throwIfAborted();
        return Response.json({ ...result, request_id: id }, { headers });
      }
      const bytes = await dependencies.synthesiseSpeech(input, request.signal);
      request.signal.throwIfAborted();
      headers.set('Content-Type', 'audio/mpeg');
      return new Response(bytes, { headers });
    } catch (error) {
      return failure(error, request, id, headers);
    }
  };
}
