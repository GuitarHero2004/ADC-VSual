import { z } from 'zod';

export * from './grounded.ts';
export * from './auth.ts';

// API-07 bounds request_text. Task submission is not implemented yet.
export const REQUEST_TEXT_MAX_LENGTH = 4000;

export const AUDIO_MAX_BYTES = 3 * 1024 * 1024;
export const RECORDING_MAX_MS = 30_000;
export const SPEECH_TEXT_MAX_LENGTH = 1000;
export const unicodeLength = (text: string) => Array.from(text).length;
export const recognitionLanguageSchema = z.enum(['auto', 'vi', 'en']);
export type RecognitionLanguage = z.infer<typeof recognitionLanguageSchema>;
export type UiLanguage = 'en' | 'vi';
export type SpeechLanguage = 'vi' | 'en';
export const speechSynthesisInputSchema = z.strictObject({
  text: z
    .string()
    .refine(
      (text) =>
        text.trim().length > 0 && unicodeLength(text) <= SPEECH_TEXT_MAX_LENGTH,
    ),
  language: z.enum(['vi', 'en']).optional(),
});
export type SpeechSynthesisInput = z.infer<typeof speechSynthesisInputSchema>;
export const transcriptResponseSchema = z.strictObject({
  transcript: z.string(),
  request_id: z.uuid(),
  detected_language: z.string().min(1).max(64).optional(),
});
export type TranscriptResponse = z.infer<typeof transcriptResponseSchema>;
export const voiceErrorCodeSchema = z.enum([
  'UNAUTHENTICATED',
  'AUTH_UNAVAILABLE',
  'FORBIDDEN',
  'INVALID_INPUT',
  'INPUT_TOO_LARGE',
  'SETUP_REQUIRED',
  'PROVIDER_ACCESS_REQUIRED',
  'RATE_LIMITED',
  'QUOTA_EXHAUSTED',
  'PROVIDER_FAILURE',
  'TIMEOUT',
  'CANCELLED',
  'DUPLICATE_REQUEST',
]);
export type VoiceErrorCode = z.infer<typeof voiceErrorCodeSchema>;
export const voiceErrorResponseSchema = z.strictObject({
  request_id: z.uuid(),
  error: z.strictObject({
    code: voiceErrorCodeSchema,
    message: z.string(),
    retryable: z.boolean(),
  }),
});

// API-25: liveness only, with the request ID required by the API conventions.
export const healthResponseSchema = z.strictObject({
  status: z.literal('ok'),
  build_version: z.string().min(1),
  request_id: z.uuid(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
