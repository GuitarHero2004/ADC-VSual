import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readDesktopConfiguration } from './config.ts';

const environment = {
  VSUAL_API_BASE_URL: 'https://api.example.test/',
  VSUAL_SUPABASE_URL: 'https://auth.example.test',
  VSUAL_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_only',
};

test('desktop configuration is lazy, normalizes origins and accepts optional workspace', () => {
  assert.deepEqual(readDesktopConfiguration({}), {
    ok: false,
    errorCode: 'SETUP_REQUIRED',
  });
  const workspace = crypto.randomUUID();
  assert.deepEqual(
    readDesktopConfiguration({ ...environment, VSUAL_WORKSPACE_ID: workspace }),
    {
      ok: true,
      value: {
        apiBaseUrl: 'https://api.example.test',
        supabaseUrl: 'https://auth.example.test',
        publishableKey: environment.VSUAL_SUPABASE_PUBLISHABLE_KEY,
        workspaceId: workspace,
      },
    },
  );
  for (const apiBaseUrl of ['http://127.0.0.1:3000', 'http://localhost:3000'])
    assert.equal(
      readDesktopConfiguration({
        ...environment,
        VSUAL_API_BASE_URL: apiBaseUrl,
      }).ok,
      true,
    );
});

test('desktop origins reject insecure remote URLs, URL credentials and unexpected components', () => {
  for (const name of ['VSUAL_API_BASE_URL', 'VSUAL_SUPABASE_URL']) {
    for (const value of [
      '',
      'http://example.test',
      'https://user:password@example.test',
      'https://example.test/path',
      'https://example.test?token=private',
      'https://example.test#private',
      'file:///private',
      'http://localhost.example.test',
      'https://*.example.test',
    ]) {
      assert.deepEqual(
        readDesktopConfiguration({ ...environment, [name]: value }),
        { ok: false, errorCode: 'SETUP_REQUIRED' },
      );
    }
  }
});

test('configuration supports legacy anon keys and refuses privileged or malformed keys', () => {
  const jwt = (role: string) =>
    `e30.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`;
  assert.equal(
    readDesktopConfiguration({
      ...environment,
      VSUAL_SUPABASE_PUBLISHABLE_KEY: jwt('anon'),
    }).ok,
    true,
  );
  for (const key of [
    '',
    'private key',
    'sb_secret_private',
    jwt('service_role'),
    'invalid.jwt.signature',
  ])
    assert.deepEqual(
      readDesktopConfiguration({
        ...environment,
        VSUAL_SUPABASE_PUBLISHABLE_KEY: key,
      }),
      { ok: false, errorCode: 'SETUP_REQUIRED' },
    );
});

test('configuration rejects invalid workspace identifiers without exposing configuration', () => {
  for (const workspace of [
    'not-a-uuid',
    'private\nheader',
    '00000000-0000-0000-0000-000000000000',
  ])
    assert.deepEqual(
      readDesktopConfiguration({
        ...environment,
        VSUAL_WORKSPACE_ID: workspace,
      }),
      { ok: false, errorCode: 'SETUP_REQUIRED' },
    );
});
