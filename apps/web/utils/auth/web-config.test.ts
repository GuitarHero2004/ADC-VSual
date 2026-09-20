import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  webAuthConfig,
  webCallbackDestination,
  webVerificationFailure,
} from './web-config.ts';
import { parseWebOAuthCookie, webOAuthCookie } from './web-oauth.ts';

const config = { google: true, siteUrl: 'https://app.example.test' };
const attempt = {
  flowId: 'test-flow-id',
  expiresAt: Date.now() + 300_000,
  language: 'vi' as const,
};

test('website validation distinguishes absent, revoked and temporarily unavailable sessions', () => {
  assert.equal(
    webVerificationFailure({ name: 'AuthSessionMissingError' }),
    'missing',
  );
  assert.equal(webVerificationFailure({ status: 401 }), 'expired');
  assert.equal(
    webVerificationFailure({ code: 'refresh_token_already_used' }),
    'expired',
  );
  assert.equal(
    webVerificationFailure({ name: 'AuthRetryableFetchError', status: 503 }),
    'unavailable',
  );
  assert.equal(webVerificationFailure(new TypeError('offline')), 'unavailable');
});

test('Google requires an exact configured safe origin and explicit capability; password builds need neither', () => {
  assert.deepEqual(webAuthConfig({ NODE_ENV: 'production' }), {
    google: false,
    siteUrl: null,
  });
  assert.deepEqual(
    webAuthConfig({ NODE_ENV: 'development', GOOGLE_AUTH_ENABLED: 'true' }),
    { google: true, siteUrl: 'http://127.0.0.1:3000' },
  );
  for (const value of [
    'https://app.example.test/',
    'http://app.example.test',
    '//app.example.test',
    'https://name@app.example.test',
    'https://app.example.test?return=outside',
    'https://app.example.test/#fragment',
  ]) {
    assert.equal(
      webAuthConfig({ AUTH_SITE_URL: value, GOOGLE_AUTH_ENABLED: 'true' })
        .google,
      false,
    );
  }
  assert.equal(
    webAuthConfig({
      AUTH_SITE_URL: config.siteUrl,
      GOOGLE_AUTH_ENABLED: 'false',
    }).google,
    false,
  );
});

test('web Google callback exchanges once and returns only to the fixed voice page', async () => {
  const seen: string[] = [];
  const url = new URL(
    'https://app.example.test/auth/callback?code=one-time-code',
  );
  assert.equal(
    await webCallbackDestination(
      url,
      config,
      async (code, flowId) => {
        seen.push(code, flowId);
        return { error: null };
      },
      attempt,
    ),
    '/voice',
  );
  assert.deepEqual(seen, ['one-time-code', attempt.flowId]);
});

test('bad origin, missing/duplicate codes and open redirects cannot exchange an OAuth code', async () => {
  let calls = 0;
  for (const value of [
    'https://attacker.example/auth/callback?code=x',
    'https://app.example.test/auth/callback',
    'https://app.example.test/auth/callback?code=x&code=y',
    'https://app.example.test/auth/callback?code=x&next=//attacker.example',
    'https://app.example.test/auth/callback?code=x&lang=en&lang=vi',
    'https://app.example.test/auth/callback?code=x%0A',
    'https://app.example.test/auth/callback?code=x&sb_flow_id=test-flow-id',
  ]) {
    const destination = await webCallbackDestination(
      new URL(value),
      config,
      async () => {
        calls += 1;
        return { error: null };
      },
      attempt,
    );
    assert.match(
      destination,
      /^\/auth\/sign-in\?status=CALLBACK_MISMATCH&lang=(en|vi)$/,
    );
  }
  assert.equal(calls, 0);
});

test('Google cancellation, missing config, exchange failure and reused/expired PKCE codes stay recoverable and never reflect provider text', async () => {
  let calls = 0;
  const exchange = async () => {
    calls += 1;
    return { error: null };
  };
  assert.equal(
    await webCallbackDestination(
      new URL(
        'https://app.example.test/auth/callback?error=access_denied&error_description=private',
      ),
      config,
      exchange,
      attempt,
    ),
    '/auth/sign-in?status=CANCELLED&lang=vi',
  );
  assert.equal(
    await webCallbackDestination(
      new URL('https://app.example.test/auth/callback?code=x'),
      { ...config, google: false },
      exchange,
      null,
    ),
    '/auth/sign-in?status=GOOGLE_UNAVAILABLE&lang=en',
  );
  assert.equal(
    await webCallbackDestination(
      new URL('https://app.example.test/auth/callback?code=x'),
      config,
      exchange,
      null,
    ),
    '/auth/sign-in?status=CALLBACK_MISMATCH&lang=en',
  );
  assert.equal(
    await webCallbackDestination(
      new URL('https://app.example.test/auth/callback?code=x'),
      config,
      exchange,
      { ...attempt, expiresAt: 1 },
    ),
    '/auth/sign-in?status=CALLBACK_MISMATCH&lang=vi',
  );
  assert.equal(calls, 0);
  for (const error of [
    { code: 'bad_code_verifier' },
    { code: 'flow_state_expired' },
    { code: 'flow_state_not_found' },
  ]) {
    assert.equal(
      await webCallbackDestination(
        new URL('https://app.example.test/auth/callback?code=x'),
        config,
        async () => ({ error }),
        attempt,
      ),
      '/auth/sign-in?status=PROVIDER_ERROR&lang=vi',
    );
  }
  assert.equal(
    await webCallbackDestination(
      new URL('https://app.example.test/auth/callback?code=x'),
      config,
      async () => {
        throw new Error('not rendered');
      },
      attempt,
    ),
    '/auth/sign-in?status=UNAVAILABLE&lang=vi',
  );
});

test('OAuth routing cookie contains only public flow ID and language, expires in five minutes, and rejects forged shapes', () => {
  const now = 1_800_000_000_000;
  const cookie = webOAuthCookie('test-flow-id', 'vi', true, now);
  assert.match(
    cookie,
    /Path=\/auth\/callback; Max-Age=300; SameSite=Lax; Secure$/,
  );
  const value = cookie.split(';')[0]!.split('=')[1];
  assert.deepEqual(parseWebOAuthCookie(value, now), {
    flowId: 'test-flow-id',
    expiresAt: now + 300_000,
    language: 'vi',
  });
  assert.equal(parseWebOAuthCookie(value, now + 300_000), null);
  for (const invalid of [
    undefined,
    '',
    'test-flow-id.9999999999999.en',
    'bad/value.1800000300000.en',
    'test-flow-id.1800000300000.fr',
  ])
    assert.equal(parseWebOAuthCookie(invalid, now), null);
  assert.throws(() => webOAuthCookie('../outside', 'en', true, now));
});
