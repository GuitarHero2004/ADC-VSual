import assert from 'node:assert/strict';
import { test } from 'node:test';
import { signInErrorMessage } from './signin-error.ts';

test('invalid credentials remain ambiguous about whether an app account exists', () => {
  const message = signInErrorMessage({ code: 'invalid_credentials' }, 'en');
  assert.match(
    message,
    /email or password was not accepted, or this app account does not exist/,
  );
  assert.match(message, /existing app account/);
  assert.match(message, /\(invalid_credentials\)$/);
});

test('unconfirmed email gives the confirmation action instead of rejecting the password', () => {
  const message = signInErrorMessage({ code: 'email_not_confirmed' }, 'en');
  assert.match(message, /Confirm your email before signing in/);
  assert.doesNotMatch(message, /password/);
});

test('disabled providers direct users to project configuration without suggesting registration', () => {
  for (const code of ['email_provider_disabled', 'provider_disabled']) {
    const message = signInErrorMessage({ code }, 'en');
    assert.match(message, /project owner/);
    assert.doesNotMatch(message, /create|register|new account/i);
    assert.ok(message.endsWith(`(${code})`));
  }
});

test('disabled signup is identified as account creation, not disabled sign-in', () => {
  const message = signInErrorMessage({ code: 'signup_disabled' }, 'en');
  assert.match(message, /New account creation is disabled/);
  assert.match(message, /existing app account/);
});

test('account suspension does not invite immediate retries', () => {
  const message = signInErrorMessage({ code: 'user_banned' }, 'en');
  assert.match(message, /suspended/);
  assert.match(message, /Contact the project owner before trying again/);
});

test('rate limits ask users to wait, while timeout offers a connection check', () => {
  assert.match(
    signInErrorMessage({ code: 'over_request_rate_limit' }, 'en'),
    /Wait a few minutes/,
  );
  assert.match(
    signInErrorMessage({ code: 'request_timeout' }, 'en'),
    /timed out.*Check your connection/,
  );
});

test('Supabase fetch failures and native network errors use safe connection guidance', () => {
  for (const error of [
    { name: 'AuthRetryableFetchError', message: 'private provider payload' },
    new TypeError('private network URL'),
  ]) {
    const message = signInErrorMessage(error, 'en');
    assert.match(message, /Could not reach the sign-in service/);
    assert.doesNotMatch(message, /private/);
  }
});

test('known API codes take precedence over a transport error name', () => {
  const message = signInErrorMessage(
    { code: 'request_timeout', name: 'AuthRetryableFetchError' },
    'en',
  );
  assert.match(message, /\(request_timeout\)$/);
});

test('Vietnamese messages cover configuration, account and recoverable failures', () => {
  const expectations = [
    ['invalid_credentials', /Email hoặc mật khẩu/],
    ['email_not_confirmed', /xác nhận email/],
    ['email_provider_disabled', /cài đặt xác thực email/],
    ['provider_disabled', /Phương thức đăng nhập/],
    ['signup_disabled', /tạo tài khoản mới/],
    ['user_banned', /tạm khóa/],
    ['over_request_rate_limit', /đợi vài phút/],
    ['request_timeout', /hết thời gian chờ/],
    ['unexpected_failure', /Dịch vụ đăng nhập/],
  ] as const;
  for (const [code, expected] of expectations) {
    assert.match(signInErrorMessage({ code }, 'vi'), expected);
  }
  assert.match(signInErrorMessage(new TypeError(), 'vi'), /kiểm tra kết nối/);
  assert.match(
    signInErrorMessage(undefined, 'vi'),
    /Đăng nhập không thành công/,
  );
});

test('unknown codes, raw messages, arbitrary values and prototype names never leak', () => {
  for (const error of [
    undefined,
    null,
    'private raw response',
    401,
    { code: 'private-unknown-code', message: 'private provider payload' },
    { code: 'toString', name: 'private name' },
    { code: '__proto__' },
    new Error('private token'),
    { code: 'invalid_credentials', message: 'private password' },
  ]) {
    const message = signInErrorMessage(error, 'en');
    assert.doesNotMatch(message, /private|toString|__proto__/);
  }
  assert.equal(
    signInErrorMessage({ code: 'private-unknown-code' }, 'en'),
    signInErrorMessage(undefined, 'en'),
  );
});

test('unexpected server failure exposes only an allowed diagnostic code', () => {
  const message = signInErrorMessage(
    { code: 'unexpected_failure', message: 'private database details' },
    'en',
  );
  assert.match(message, /Try again later or contact the project owner/);
  assert.match(message, /\(unexpected_failure\)$/);
  assert.doesNotMatch(message, /private database details/);
});
