import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { usageLimitSchema, voiceErrorResponseSchema } from '@adc/contracts';
import { VoiceError } from './errors.ts';
import { limitedUsage, voiceRequestLimits } from './limits.ts';

const names = [
  'NODE_ENV',
  'VOICE_REQUESTS_PER_MINUTE',
  'VOICE_REQUESTS_PER_DAY',
] as const;
const env: Record<string, string | undefined> = process.env;
const original = Object.fromEntries(names.map((name) => [name, env[name]]));
afterEach(() => {
  for (const name of names) {
    if (original[name] === undefined) delete env[name];
    else env[name] = original[name];
  }
});
function clear() {
  delete env.VOICE_REQUESTS_PER_MINUTE;
  delete env.VOICE_REQUESTS_PER_DAY;
}

test('development gets a testing budget while production, test and unspecified environments retain conservative defaults', () => {
  clear();
  for (const name of ['production', 'test', undefined]) {
    if (name === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = name;
    assert.deepEqual(voiceRequestLimits(), { minute: 6, day: 30 });
  }
  env.NODE_ENV = 'development';
  assert.deepEqual(voiceRequestLimits(), { minute: 30, day: 1000 });
});

test('explicit bounded overrides work in every environment and one override preserves the other default', () => {
  for (const name of ['development', 'production', 'test']) {
    clear();
    env.NODE_ENV = name;
    env.VOICE_REQUESTS_PER_MINUTE = '12';
    assert.deepEqual(voiceRequestLimits(), {
      minute: 12,
      day: name === 'development' ? 1000 : 30,
    });
    env.VOICE_REQUESTS_PER_MINUTE = '600';
    env.VOICE_REQUESTS_PER_DAY = '10000';
    assert.deepEqual(voiceRequestLimits(), { minute: 600, day: 10000 });
  }
});

test('blank, zero, negative, fractional, unbounded and malformed limits fail lazily without disabling the limit', () => {
  for (const name of [
    'VOICE_REQUESTS_PER_MINUTE',
    'VOICE_REQUESTS_PER_DAY',
  ] as const) {
    for (const value of [
      '',
      '0',
      '-1',
      '1.5',
      ' 30',
      '30 ',
      'Infinity',
      '1e2',
      '01',
      '9007199254740992',
      name === 'VOICE_REQUESTS_PER_MINUTE' ? '601' : '10001',
    ]) {
      clear();
      env[name] = value;
      assert.throws(
        voiceRequestLimits,
        (error: unknown) =>
          error instanceof VoiceError &&
          error.code === 'SETUP_REQUIRED' &&
          error.status === 503,
      );
    }
  }
});

const now = new Date('2026-09-21T12:00:00.000Z');
const later = (milliseconds: number) => new Date(now.getTime() + milliseconds);
test('minute and daily exhaustion report the correct window, counts and conservative retry time', () => {
  const minute = limitedUsage(
    {
      minute_count: 6,
      day_count: 12,
      minute_retry_at: later(42_001),
      day_retry_at: null,
    },
    { minute: 6, day: 30 },
    now,
  );
  assert.deepEqual(minute, {
    minute_count: 6,
    minute_limit: 6,
    day_count: 12,
    day_limit: 30,
    limited_by: 'minute',
    retry_after_seconds: 43,
    retry_at: later(43_000).toISOString(),
  });
  const day = limitedUsage(
    {
      minute_count: 0,
      day_count: 30,
      minute_retry_at: null,
      day_retry_at: later(3_600_000),
    },
    { minute: 6, day: 30 },
    now,
  );
  assert.equal(day?.limited_by, 'day');
  assert.equal(day?.retry_after_seconds, 3600);
});

test('both exhausted windows wait for the later relevant expiry, including when configured limits were lowered', () => {
  const result = limitedUsage(
    {
      minute_count: 9,
      day_count: 80,
      minute_retry_at: later(55_000),
      day_retry_at: later(80_000_000),
    },
    { minute: 3, day: 30 },
    now,
  );
  assert.equal(result?.limited_by, 'both');
  assert.equal(result?.retry_after_seconds, 80000);
  assert.equal(result?.retry_at, later(80_000_000).toISOString());
  assert.equal(result?.minute_count, 9);
  assert.equal(result?.minute_limit, 3);
});

test('under-budget calls do not fabricate usage errors and missing blocked-window timestamps fail closed', () => {
  assert.equal(
    limitedUsage(
      {
        minute_count: 5,
        day_count: 29,
        minute_retry_at: null,
        day_retry_at: null,
      },
      { minute: 6, day: 30 },
      now,
    ),
    null,
  );
  assert.throws(
    () =>
      limitedUsage(
        {
          minute_count: 6,
          day_count: 10,
          minute_retry_at: null,
          day_retry_at: null,
        },
        { minute: 6, day: 30 },
        now,
      ),
    (error: unknown) =>
      error instanceof VoiceError && error.code === 'SETUP_REQUIRED',
  );
});

test('wire usage rejects negative counts, invalid retry values and unbounded configuration', () => {
  const valid = {
    minute_count: 6,
    minute_limit: 6,
    day_count: 30,
    day_limit: 30,
    limited_by: 'both',
    retry_after_seconds: 60,
    retry_at: later(60_000).toISOString(),
  };
  assert.ok(usageLimitSchema.safeParse(valid).success);
  for (const fields of [
    { minute_count: -1 },
    { minute_limit: 0 },
    { day_limit: 10001 },
    { retry_after_seconds: 0 },
    { retry_after_seconds: 86401 },
    { retry_at: 'tomorrow' },
    { limited_by: 'minute' },
    { minute_count: 31 },
    { minute_count: 5, day_count: 29 },
  ]) {
    assert.equal(
      usageLimitSchema.safeParse({ ...valid, ...fields }).success,
      false,
    );
  }
});

test('application errors require usage evidence and provider errors cannot claim application counts', () => {
  const usage = {
    minute_count: 6,
    minute_limit: 6,
    day_count: 6,
    day_limit: 30,
    limited_by: 'minute',
    retry_after_seconds: 1,
    retry_at: later(1000).toISOString(),
  };
  const error = {
    code: 'APP_RATE_LIMITED',
    message: 'Application limit.',
    retryable: true,
  };
  const request_id = crypto.randomUUID();
  assert.equal(
    voiceErrorResponseSchema.safeParse({ request_id, error }).success,
    false,
  );
  assert.ok(
    voiceErrorResponseSchema.safeParse({
      request_id,
      error: { ...error, usage },
    }).success,
  );
  for (const code of [
    'PROVIDER_RATE_LIMITED',
    'RATE_LIMITED',
    'QUOTA_EXHAUSTED',
  ]) {
    assert.ok(
      voiceErrorResponseSchema.safeParse({
        request_id,
        error: { ...error, code },
      }).success,
    );
    assert.equal(
      voiceErrorResponseSchema.safeParse({
        request_id,
        error: { ...error, code, usage },
      }).success,
      false,
    );
  }
});
