import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  extensionHosts,
  floatingPageUrl,
  ordersMatches,
  ordersOrigins,
  publicOrigin,
} from './config-values.ts';
import { createManifest } from '../manifest.ts';

test('backend origins reject credentials, paths, unsafe schemes and remote HTTP', () => {
  for (const value of [
    'javascript:alert(1)',
    'https://user:password@example.test',
    'https://example.test/api',
    'https://example.test?key=value',
    'http://example.test',
    'https://example.test#fragment',
    'https://*.vercel.app',
  ]) {
    assert.equal(publicOrigin(value), null);
  }
  assert.equal(publicOrigin('https://example.test/'), 'https://example.test');
  assert.equal(publicOrigin('http://localhost:3000'), 'http://localhost:3000');
});

test('manifest separates broad UI injection from configured extraction and backend hosts', () => {
  const environment = {
    VITE_API_BASE_URL: 'https://backend.example.test',
    VITE_SUPABASE_URL: 'https://project.supabase.co',
    ELEVENLABS_API_KEY: 'private-sentinel',
  };
  const manifest = createManifest(environment);
  assert.deepEqual(manifest.host_permissions, [
    'https://backend.example.test/*',
    'https://project.supabase.co/*',
  ]);
  assert.deepEqual(manifest.permissions, ['sidePanel', 'storage', 'identity']);
  assert.deepEqual(manifest.externally_connectable, {
    matches: ['https://backend.example.test/auth/sign-in*'],
  });
  assert.deepEqual(manifest.content_scripts[0]?.matches, [
    'http://*/*',
    'https://*/*',
  ]);
  assert.deepEqual(manifest.content_scripts[0]?.js, ['floating-content.js']);
  assert.deepEqual(manifest.content_scripts[1]?.matches, [
    'https://backend.example.test/orders*',
  ]);
  assert.ok(!JSON.stringify(manifest).includes('private-sentinel'));
  assert.ok(!JSON.stringify(manifest).includes('<all_urls>'));
  assert.equal(
    manifest.commands['toggle-voice'].suggested_key.default,
    'Alt+Shift+A',
  );
});

test('orders allowlist accepts exact origins, fails closed on malformed entries and never wildcards subdomains', () => {
  const environment = {
    VITE_ORDERS_ORIGINS: 'http://localhost:3000, https://demo.example.test',
  };
  assert.deepEqual(ordersOrigins(environment), [
    'http://localhost:3000',
    'https://demo.example.test',
  ]);
  assert.deepEqual(ordersMatches(environment), [
    'http://localhost/orders*',
    'https://demo.example.test/orders*',
  ]);
  assert.deepEqual(
    ordersOrigins({ VITE_ORDERS_ORIGINS: 'https://*.vercel.app' }),
    [],
  );
  assert.deepEqual(
    ordersOrigins({ VITE_ORDERS_ORIGINS: 'https://demo.example.test,/orders' }),
    [],
  );
  assert.deepEqual(
    ordersOrigins({ VITE_ORDERS_ORIGINS: 'https://demo.example.test/orders' }),
    [],
  );
  const manifest = createManifest(environment);
  assert.deepEqual(manifest.web_accessible_resources, [
    {
      resources: ['floating.html', 'assets/*'],
      matches: ['http://*/*', 'https://*/*'],
    },
  ]);
  assert.ok(
    !manifest.web_accessible_resources.some((entry) =>
      entry.resources.includes('index.html'),
    ),
  );
  assert.equal(
    createManifest({ VITE_ORDERS_ORIGINS: 'https://*.vercel.app' })
      .content_scripts.length,
    1,
  );
  assert.equal(manifest.content_scripts[0]?.all_frames, false);
  assert.deepEqual(manifest.content_scripts[1]?.js, ['orders-content.js']);
});

test('floating UI permits ordinary web pages but excludes privileged schemes and own auth routes', () => {
  const auth = 'https://vsual.example.test';
  for (const url of [
    'chrome://settings/',
    'edge://settings/',
    'file:///private.html',
    'data:text/html,hello',
    'https://user:example@example.test/',
    `${auth}/auth/sign-in`,
    `${auth}/auth/callback?code=opaque`,
  ])
    assert.equal(floatingPageUrl(url, auth), null);
  assert.ok(floatingPageUrl('https://example.test/anything', auth));
  assert.ok(floatingPageUrl('http://example.test/anything', auth));
  assert.ok(floatingPageUrl(`${auth}/orders`, auth));
});

test('credential-free builds use only the development backend host', () => {
  assert.deepEqual(extensionHosts({}), ['http://127.0.0.1/*']);
});
