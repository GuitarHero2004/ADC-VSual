import {
  transcriptResponseSchema,
  voiceErrorResponseSchema,
} from '@adc/contracts';
import type { VoiceTransport } from './controller.ts';

export class VoiceTransportError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'VoiceTransportError';
    this.code = code;
  }
}

export function createVoiceTransport(options: {
  baseUrl: string;
  getHeaders: () => Record<string, string> | Promise<Record<string, string>>;
  onUnauthenticated?: () => void;
}): VoiceTransport {
  async function send(
    path: string,
    body: BodyInit,
    signal: AbortSignal,
    json = false,
  ) {
    const headers = await options.getHeaders();
    signal.throwIfAborted();
    let response: Response;
    try {
      response = await fetch(new URL(path, options.baseUrl), {
        method: 'POST',
        headers: {
          ...headers,
          'X-Request-ID': crypto.randomUUID(),
          ...(json ? { 'Content-Type': 'application/json' } : {}),
        },
        body,
        signal,
        credentials: 'same-origin',
        cache: 'no-store',
      });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new VoiceTransportError(
        'PROVIDER_FAILURE',
        'Cannot reach the voice backend. Check your connection and extension setup.',
      );
    }
    signal.throwIfAborted();
    if (!response.ok) {
      let value: unknown;
      try {
        value = await response.json();
      } catch {
        value = null;
      }
      const parsed = voiceErrorResponseSchema.safeParse(value);
      if (parsed.success) {
        if (parsed.data.error.code === 'UNAUTHENTICATED')
          options.onUnauthenticated?.();
        throw new VoiceTransportError(
          parsed.data.error.code,
          parsed.data.error.message,
        );
      }
      // Deployment protection is outside application auth; don't discard a valid session for HTML.
      throw new VoiceTransportError(
        'PROVIDER_FAILURE',
        'The backend returned an unexpected response. Check the backend URL, CORS and Vercel deployment protection.',
      );
    }
    return response;
  }
  return {
    async transcribe(audio, filename, language, signal) {
      const form = new FormData();
      form.set('audio', audio, filename);
      form.set('language', language);
      const response = await send('/api/voice/transcribe', form, signal);
      const value: unknown = await response.json();
      signal.throwIfAborted();
      const parsed = transcriptResponseSchema.safeParse(value);
      if (!parsed.success)
        throw new VoiceTransportError(
          'PROVIDER_FAILURE',
          'The backend returned an invalid transcript response.',
        );
      return parsed.data;
    },
    async speak(text, language, signal) {
      const response = await send(
        '/api/voice/speak',
        JSON.stringify({ text, ...(language === 'auto' ? {} : { language }) }),
        signal,
        true,
      );
      if (
        response.headers.get('content-type')?.split(';')[0]?.trim() !==
        'audio/mpeg'
      )
        throw new VoiceTransportError(
          'PROVIDER_FAILURE',
          'The backend returned an invalid audio response.',
        );
      const blob = await response.blob();
      signal.throwIfAborted();
      if (!blob.size || blob.size > 4 * 1024 * 1024)
        throw new VoiceTransportError(
          'PROVIDER_FAILURE',
          'The backend returned empty or oversized audio.',
        );
      return blob;
    },
  };
}
