import 'server-only';
import { usageLimitSchema, type UsageLimit } from '@adc/contracts';
import { VoiceError } from './errors.ts';

export function voiceRequestLimits() {
  const development = process.env.NODE_ENV === 'development';
  function configured(name: string, fallback: number, maximum: number) {
    const value = process.env[name];
    if (value === undefined) return fallback;
    if (
      !/^[1-9]\d*$/.test(value) ||
      !Number.isSafeInteger(Number(value)) ||
      Number(value) > maximum
    ) {
      throw new VoiceError(
        'SETUP_REQUIRED',
        'The application request limits need valid server configuration.',
        503,
      );
    }
    return Number(value);
  }
  return {
    minute: configured(
      'VOICE_REQUESTS_PER_MINUTE',
      development ? 30 : 6,
      usageLimitSchema.shape.minute_limit.maxValue!,
    ),
    day: configured(
      'VOICE_REQUESTS_PER_DAY',
      development ? 1000 : 30,
      usageLimitSchema.shape.day_limit.maxValue!,
    ),
  };
}

export interface UsageWindow {
  minute_count: number;
  day_count: number;
  minute_retry_at: Date | null;
  day_retry_at: Date | null;
}

/** SQL supplies the limit-th newest reservation, not always the oldest one. */
export function limitedUsage(
  row: UsageWindow,
  limits: ReturnType<typeof voiceRequestLimits>,
  checkedAt: Date,
): UsageLimit | null {
  const minute = row.minute_count >= limits.minute;
  const day = row.day_count >= limits.day;
  if (!minute && !day) return null;
  const deadlines = [
    minute ? row.minute_retry_at?.getTime() : 0,
    day ? row.day_retry_at?.getTime() : 0,
  ];
  if (
    deadlines.some((value) => value === undefined || !Number.isFinite(value))
  ) {
    throw new VoiceError(
      'SETUP_REQUIRED',
      'The application request limit could not be checked.',
      503,
    );
  }
  const retrySeconds = Math.max(
    1,
    Math.ceil(
      (Math.max(...(deadlines as number[])) - checkedAt.getTime()) / 1000,
    ),
  );
  return usageLimitSchema.parse({
    minute_count: row.minute_count,
    minute_limit: limits.minute,
    day_count: row.day_count,
    day_limit: limits.day,
    limited_by: minute && day ? 'both' : minute ? 'minute' : 'day',
    retry_after_seconds: retrySeconds,
    retry_at: new Date(checkedAt.getTime() + retrySeconds * 1000).toISOString(),
  });
}
