import 'server-only';

import {
  speechSynthesisInputSchema,
  type RecognitionLanguage,
} from '@adc/contracts';
import { ElevenLabsClient, ElevenLabsError } from '@elevenlabs/elevenlabs-js';
import { VoiceError } from '../voice/errors.ts';

const MAX_GENERATED_BYTES = 4 * 1024 * 1024;
const PROVIDER_TIMEOUT_MS = 30_000;

// Lazy configuration: builds and unrelated pages never initialise a provider.
export function requireVoiceConfiguration(feature: 'transcribe' | 'speak') {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  const model =
    feature === 'transcribe'
      ? process.env.ELEVENLABS_STT_MODEL?.trim()
      : process.env.ELEVENLABS_TTS_MODEL?.trim();
  const expected = feature === 'transcribe' ? 'scribe_v2' : 'eleven_flash_v2_5';
  const voiceId = process.env.ELEVENLABS_VOICE_ID?.trim();
  if (!apiKey || model !== expected || (feature === 'speak' && !voiceId)) {
    throw new VoiceError(
      'SETUP_REQUIRED',
      'Voice service setup is incomplete. Ask the project maintainer to configure ElevenLabs.',
      503,
    );
  }
  return { apiKey, model, voiceId };
}

function providerStatus(error: unknown) {
  if (!(error instanceof ElevenLabsError)) return {};
  const body: unknown = error.body;
  const detail =
    body && typeof body === 'object' && 'detail' in body ? body.detail : null;
  const code =
    detail &&
    typeof detail === 'object' &&
    'status' in detail &&
    typeof detail.status === 'string'
      ? detail.status
      : '';
  return { status: error.statusCode, code };
}

async function callProvider<T>(
  feature: 'transcribe' | 'speak',
  signal: AbortSignal | undefined,
  call: (
    client: ElevenLabsClient,
    config: ReturnType<typeof requireVoiceConfiguration>,
    abort: AbortSignal,
  ) => Promise<T>,
): Promise<T> {
  const config = requireVoiceConfiguration(feature);
  const deadline = AbortSignal.timeout(PROVIDER_TIMEOUT_MS);
  const abort = signal ? AbortSignal.any([signal, deadline]) : deadline;
  try {
    abort.throwIfAborted();
    const client = new ElevenLabsClient({
      apiKey: config.apiKey,
      fetch: globalThis.fetch,
      maxRetries: 0,
      timeoutInSeconds: 30,
      logging: { silent: true },
    });
    const result = await call(client, config, abort);
    abort.throwIfAborted();
    return result;
  } catch (error) {
    if (signal?.aborted)
      throw new VoiceError('CANCELLED', 'Voice request cancelled.', 499);
    if (
      deadline.aborted ||
      (error instanceof Error && /timeout/i.test(error.name))
    ) {
      throw new VoiceError(
        'TIMEOUT',
        'The voice service took too long. Your text is still available; try again.',
        504,
        true,
      );
    }
    if (error instanceof VoiceError) throw error;
    const { status, code } = providerStatus(error);
    if (
      feature === 'speak' &&
      (code === 'language_not_supported' ||
        code === 'unsupported_language' ||
        code === 'unsupported_language_code')
    ) {
      throw new VoiceError(
        'VOICE_LANGUAGE_UNSUPPORTED',
        'Speech is unavailable for this language with the configured voice and model. Your text is still available.',
        422,
      );
    }
    if (code === 'quota_exceeded' || code === 'insufficient_credits') {
      throw new VoiceError(
        'QUOTA_EXHAUSTED',
        'ElevenLabs reported insufficient credits or allowance for this request. Your text is preserved.',
        429,
      );
    }
    if (status === 402) {
      throw new VoiceError(
        'PROVIDER_ACCESS_REQUIRED',
        'ElevenLabs requires account or plan changes for this request. Ask the maintainer to check access to the configured voice and model.',
        503,
      );
    }
    if (status === 429)
      throw new VoiceError(
        'PROVIDER_RATE_LIMITED',
        'ElevenLabs is temporarily limiting requests. No reset time is confirmed; retry manually later.',
        429,
        true,
      );
    if (status === 401 || status === 403 || status === 404) {
      throw new VoiceError(
        'SETUP_REQUIRED',
        'The voice service configuration or voice access needs attention.',
        503,
      );
    }
    throw new VoiceError(
      'PROVIDER_FAILURE',
      'The voice service could not complete this request. Please try again.',
      502,
      true,
    );
  }
}

export async function transcribeAudio(
  file: File,
  language: RecognitionLanguage,
  signal?: AbortSignal,
) {
  return callProvider(
    'transcribe',
    signal,
    async (client, config, abortSignal) => {
      const result = await client.speechToText.convert(
        {
          file,
          modelId: config.model,
          ...(language === 'auto' ? {} : { languageCode: language }),
          tagAudioEvents: false,
          diarize: false,
          timestampsGranularity: 'none',
          webhook: false,
          noVerbatim: false,
          useMultiChannel: false,
        },
        { abortSignal },
      );
      if (!('text' in result) || typeof result.text !== 'string') {
        throw new VoiceError(
          'PROVIDER_FAILURE',
          'The voice service returned an invalid transcript.',
          502,
          true,
        );
      }
      return {
        transcript: result.text,
        ...(typeof result.languageCode === 'string' && result.languageCode
          ? { detected_language: result.languageCode }
          : {}),
      };
    },
  );
}

export async function synthesiseSpeech(input: unknown, signal?: AbortSignal) {
  const parsed = speechSynthesisInputSchema.safeParse(input);
  if (!parsed.success)
    throw new VoiceError(
      'INVALID_INPUT',
      'Enter between 1 and 1,000 characters for read-back.',
      400,
    );
  return callProvider('speak', signal, async (client, config, abortSignal) => {
    const { data: audio, rawResponse } = await client.textToSpeech
      .convert(
        config.voiceId!,
        {
          text: parsed.data.text,
          modelId: config.model,
          outputFormat: 'mp3_44100_128',
          // Override only this request. The player applies the companion's
          // slower rate; account-level voice settings must not slow it twice.
          voiceSettings: { speed: 1 },
          ...(parsed.data.language
            ? { languageCode: parsed.data.language }
            : {}),
        },
        { abortSignal },
      )
      .withRawResponse();
    if (
      rawResponse.headers.get('content-type')?.split(';')[0]?.trim() !==
      'audio/mpeg'
    ) {
      await audio.cancel();
      throw new VoiceError(
        'PROVIDER_FAILURE',
        'The voice service returned an unexpected audio format.',
        502,
        true,
      );
    }
    const reader = audio.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    const cancel = () => {
      void reader.cancel().catch(() => undefined);
    };
    abortSignal.addEventListener('abort', cancel, { once: true });
    try {
      while (true) {
        abortSignal.throwIfAborted();
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_GENERATED_BYTES)
          throw new VoiceError(
            'PROVIDER_FAILURE',
            'Generated audio exceeded the playback limit.',
            502,
          );
        chunks.push(value);
      }
      abortSignal.throwIfAborted();
    } finally {
      abortSignal.removeEventListener('abort', cancel);
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    if (size === 0)
      throw new VoiceError(
        'PROVIDER_FAILURE',
        'The voice service returned empty audio.',
        502,
        true,
      );
    const result = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result;
  });
}
