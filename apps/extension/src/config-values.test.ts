import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extensionHosts, publicOrigin } from './config-values.ts';
import { createManifest } from '../manifest.ts';

test('backend origins reject credentials, paths, unsafe schemes and remote HTTP', () => {
  for (const value of [
    'javascript:alert(1)',
    'https://user:password@example.test',
    'https://example.test/api',
    'https://example.test?key=value',
    'http://example.test',
    'https://example.test#fragment',
  ]) {
    assert.equal(publicOrigin(value), null);
  }
  assert.equal(publicOrigin('https://example.test/'), 'https://example.test');
  assert.equal(publicOrigin('http://localhost:3000'), 'http://localhost:3000');
});

test('manifest limits permissions to configured hosts without secret settings', () => {
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
  assert.deepEqual(manifest.permissions, ['sidePanel', 'storage']);
  assert.ok(!JSON.stringify(manifest).includes('private-sentinel'));
  assert.ok(!JSON.stringify(manifest).includes('<all_urls>'));
  assert.equal(
    manifest.commands['toggle-voice'].suggested_key.default,
    'Alt+Shift+A',
  );
});

test('credential-free builds use only the development backend host', () => {
  assert.deepEqual(extensionHosts({}), ['http://127.0.0.1/*']);
});
