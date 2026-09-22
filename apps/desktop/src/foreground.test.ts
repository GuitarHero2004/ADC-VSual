import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  readForegroundWindow,
  type ForegroundCommandExecutor,
} from './foreground.ts';

test('foreground lookup executes a fixed hidden and bounded Windows command', async () => {
  let calls = 0;
  const execute: ForegroundCommandExecutor = (file, args, options, done) => {
    calls++;
    assert.match(
      file,
      /\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe$/i,
    );
    assert.deepEqual(args.slice(0, 3), [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
    ]);
    assert.equal(args.length, 4);
    assert.match(args[3]!, /GetForegroundWindow/);
    assert.deepEqual(options, {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 3000,
      maxBuffer: 64,
    });
    done(null, ' 123456\r\n');
  };
  assert.equal(
    await readForegroundWindow({ platform: 'win32', execute }),
    'window:123456:0',
  );
  assert.equal(calls, 1);
});

test('foreground lookup does not execute on other platforms', async () => {
  for (const platform of ['darwin', 'linux'] as const) {
    assert.equal(
      await readForegroundWindow({
        platform,
        execute: () => assert.fail('Windows command must not run'),
      }),
      null,
    );
  }
});

test('foreground lookup fails closed on timeout, command failure or spawn failure', async () => {
  for (const error of [
    Object.assign(new Error('Command timed out'), { killed: true }),
    new Error('Command failed'),
  ]) {
    assert.equal(
      await readForegroundWindow({
        platform: 'win32',
        execute: (_file, _args, _options, done) => done(error, '123'),
      }),
      null,
    );
  }
  assert.equal(
    await readForegroundWindow({
      platform: 'win32',
      execute: () => {
        throw new Error('Spawn failed');
      },
    }),
    null,
  );
});

test('foreground lookup rejects zero, malformed and oversized handles', async () => {
  for (const output of [
    '',
    '0',
    '0000',
    '-1',
    '1.5',
    '0x123',
    '123\n456',
    '123 application title',
    '18446744073709551616',
    '9'.repeat(65),
  ]) {
    assert.equal(
      await readForegroundWindow({
        platform: 'win32',
        execute: (_file, _args, _options, done) => done(null, output),
      }),
      null,
    );
  }
});

test('foreground lookup preserves integer precision and canonicalizes decimal handles', async () => {
  for (const [output, expected] of [
    ['000123', 'window:123:0'],
    ['9007199254740993', 'window:9007199254740993:0'],
  ]) {
    assert.equal(
      await readForegroundWindow({
        platform: 'win32',
        execute: (_file, _args, _options, done) => done(null, output!),
      }),
      expected,
    );
  }
});
