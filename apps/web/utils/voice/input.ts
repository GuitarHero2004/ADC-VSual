import 'server-only';
import {
  AUDIO_MAX_BYTES,
  recognitionLanguageSchema,
  speechSynthesisInputSchema,
} from '@adc/contracts';
import { VoiceError } from './errors.ts';

// 3 MiB audio + 64 KiB multipart overhead stays below Vercel's 4.5 MB body limit.
const MULTIPART_MAX = AUDIO_MAX_BYTES + 64 * 1024;
const invalid = () =>
  new VoiceError(
    'INVALID_INPUT',
    'The voice request is invalid. Please record again or edit the text.',
    400,
  );

async function boundedBody(request: Request, limit: number) {
  const tooLarge = () =>
    new VoiceError(
      'INPUT_TOO_LARGE',
      'This voice request is too large. Use a shorter recording or text.',
      413,
    );
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit))
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
      if (size > limit) throw tooLarge();
      chunks.push(value);
    }
    request.signal.throwIfAborted();
  } finally {
    request.signal.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

export async function readSpeechInput(request: Request) {
  if (
    request.headers.get('content-type')?.split(';')[0]?.trim() !==
    'application/json'
  )
    throw invalid();
  let value: unknown;
  try {
    value = JSON.parse(
      (await boundedBody(request, 32 * 1024)).toString('utf8'),
    );
  } catch (error) {
    if (error instanceof VoiceError || request.signal.aborted) throw error;
    throw invalid();
  }
  const parsed = speechSynthesisInputSchema.safeParse(value);
  if (!parsed.success) throw invalid();
  return parsed.data;
}

export async function readAudioInput(request: Request) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data;'))
    throw invalid();
  const body = await boundedBody(request, MULTIPART_MAX);
  let form: FormData;
  try {
    form = await new Response(body, {
      headers: { 'content-type': contentType },
    }).formData();
  } catch {
    throw invalid();
  }
  if (
    [...form.keys()].some((key) => !['audio', 'language'].includes(key)) ||
    form.getAll('audio').length !== 1 ||
    form.getAll('language').length > 1
  )
    throw invalid();
  const file = form.get('audio');
  const parsedLanguage = recognitionLanguageSchema.safeParse(
    form.get('language') ?? 'auto',
  );
  if (!(file instanceof File) || !file.size || !parsedLanguage.success)
    throw invalid();
  if (file.size > AUDIO_MAX_BYTES)
    throw new VoiceError(
      'INPUT_TOO_LARGE',
      'Recordings must be no larger than 3 MiB.',
      413,
    );
  const bytes = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  const starts = (...signature: number[]) =>
    signature.every((byte, i) => bytes[i] === byte);
  const ascii = (offset: number, text: string) =>
    [...text].every((char, i) => bytes[offset + i] === char.charCodeAt(0));
  const type = file.type.toLowerCase().split(';')[0]?.trim();
  const formats = [
    {
      type: 'audio/webm',
      ext: 'webm',
      matches: starts(0x1a, 0x45, 0xdf, 0xa3),
    },
    { type: 'audio/ogg', ext: 'ogg', matches: ascii(0, 'OggS') },
    { type: 'audio/mp4', ext: 'm4a', matches: ascii(4, 'ftyp') },
    {
      type: 'audio/mpeg',
      ext: 'mp3',
      matches:
        ascii(0, 'ID3') ||
        (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0),
    },
    {
      type: 'audio/wav',
      ext: 'wav',
      matches: ascii(0, 'RIFF') && ascii(8, 'WAVE'),
    },
  ];
  const format = formats.find(
    (format) => format.type === type && format.matches,
  );
  if (!format)
    throw new VoiceError(
      'INVALID_INPUT',
      'Unsupported recording format. Please record again in Chrome or Edge.',
      415,
    );
  // Signature screening is not a decoder or a duration assertion. Discard untrusted filenames.
  return {
    file: new File([file], `recording.${format.ext}`, { type: file.type }),
    language: parsedLanguage.data,
  };
}
