import { z } from 'zod';

export * from './grounded.ts';
export * from './auth.ts';
export * from './structured.ts';
export * from './visual.ts';

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
  'VOICE_LANGUAGE_UNSUPPORTED',
  'RATE_LIMITED',
  'APP_RATE_LIMITED',
  'PROVIDER_RATE_LIMITED',
  'QUOTA_EXHAUSTED',
  'PROVIDER_FAILURE',
  'TIMEOUT',
  'CANCELLED',
  'DUPLICATE_REQUEST',
]);
export type VoiceErrorCode = z.infer<typeof voiceErrorCodeSchema>;
export const usageLimitSchema = z
  .strictObject({
    minute_count: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    minute_limit: z.number().int().min(1).max(600),
    day_count: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    day_limit: z.number().int().min(1).max(10_000),
    limited_by: z.enum(['minute', 'day', 'both']),
    retry_after_seconds: z.number().int().min(1).max(86_400),
    retry_at: z.iso.datetime(),
  })
  .superRefine((usage, context) => {
    const minute = usage.minute_count >= usage.minute_limit;
    const day = usage.day_count >= usage.day_limit;
    const expected =
      minute && day ? 'both' : minute ? 'minute' : day ? 'day' : null;
    if (usage.limited_by !== expected || usage.day_count < usage.minute_count) {
      context.addIssue({
        code: 'custom',
        message: 'Usage counts do not match the limited window.',
      });
    }
  });
export type UsageLimit = z.infer<typeof usageLimitSchema>;
export const voiceErrorResponseSchema = z
  .strictObject({
    request_id: z.uuid(),
    error: z.strictObject({
      code: voiceErrorCodeSchema,
      message: z.string(),
      retryable: z.boolean(),
      usage: usageLimitSchema.optional(),
    }),
  })
  .superRefine((response, context) => {
    if (
      (response.error.code === 'APP_RATE_LIMITED') !==
      (response.error.usage !== undefined)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['error', 'usage'],
        message:
          'Only application limits include required application usage evidence.',
      });
    }
  });

// API-25: liveness only, with the request ID required by the API conventions.
export const healthResponseSchema = z.strictObject({
  status: z.literal('ok'),
  build_version: z.string().min(1),
  request_id: z.uuid(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
