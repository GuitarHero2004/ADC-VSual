import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join } from 'node:path';
import { parseDesktopPreferences } from './bridge.ts';
import {
  DESKTOP_URL,
  rendererAsset,
  trustedDesktopSender,
} from './security.ts';

test('only exact owned top-level renderer may invoke native capabilities', () => {
  assert.equal(trustedDesktopSender(true, true, DESKTOP_URL), true);
  for (const [owner, main, url] of [
    [false, true, DESKTOP_URL],
    [true, false, DESKTOP_URL],
    [true, true, `${DESKTOP_URL}?redirect=other`],
    [true, true, 'https://desktop/index.html'],
    [true, true, undefined],
  ] as const)
    assert.equal(trustedDesktopSender(owner, main, url), false);
});

test('protocol cannot read arbitrary local files or fetch remote content', () => {
  assert.equal(
    rendererAsset(DESKTOP_URL, 'build'),
    join('build', 'index.html'),
  );
  assert.equal(
    rendererAsset('vsual://desktop/assets/app-H4k.js', 'build'),
    join('build', 'assets', 'app-H4k.js'),
  );
  for (const url of [
    'file:///C:/secrets.txt',
    'https://example.test/index.html',
    'vsual://other/index.html',
    'vsual://user@desktop/index.html',
    'vsual://desktop/index.html?file=private',
    'vsual://desktop/assets/%2e%2e%2fprivate.txt',
    'vsual://desktop/assets/../../private.txt',
    'vsual://desktop/C:/private.txt',
    'vsual://desktop/assets/private.json',
    'vsual://desktop/assets/subfolder/script.js',
    'not a URL',
  ])
    assert.equal(rendererAsset(url, 'build'), null);
});

test('preferences accept only bounded language and shortcut choices', () => {
  assert.deepEqual(
    parseDesktopPreferences({ language: 'vi', shortcut: 'Control+Alt+V' }),
    { language: 'vi', shortcut: 'Control+Alt+V' },
  );
  for (const value of [
    null,
    [],
    {},
    { language: 'fr', shortcut: 'Control+Alt+V' },
    { language: 'en', shortcut: 'Super+R' },
    { language: 'en', shortcut: 'Control+Alt+V', token: 'not accepted' },
  ])
    assert.throws(() => parseDesktopPreferences(value));
});
