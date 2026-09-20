import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { test } from 'node:test';
import { Client } from 'pg';
import { voiceDatabaseConfig } from './database-config.ts';
import { VoiceError } from './errors.ts';
import { SUPABASE_CA_CERTIFICATE } from './supabase-ca.ts';

// Synthetic parser fixtures only; no test opens a database connection.
// Keep dummy fields separate instead of embedding credential-shaped URL literals.
const testUser = 'voice_test';
const testPassword = 'synthetic-secret';
const baseUrl = `postgresql://${testUser}.project:${encodeURIComponent('synthetic@password')}@pooler.example.test:6543/postgres`;

function isSetupError(error: unknown): boolean {
  assert.ok(error instanceof VoiceError);
  assert.equal(error.code, 'SETUP_REQUIRED');
  assert.equal(error.status, 503);
  assert.equal(error.retryable, false);
  assert.equal(
    error.message,
    'Voice access is not configured. Ask the project administrator to check the database connection settings.',
  );
  assert.equal(error.cause, undefined);
  return true;
}

test('actual pg parsing retains the CA and full TLS verification with either supported URL form', () => {
  for (const suffix of ['', '?sslmode=verify-full']) {
    const config = voiceDatabaseConfig(baseUrl + suffix);
    // Construction parses the configuration but never connects to any server.
    const client = new Client(config);
    assert.deepEqual(client.ssl, {
      ca: SUPABASE_CA_CERTIFICATE,
      rejectUnauthorized: true,
    });
    assert.equal(client.host, 'pooler.example.test');
    assert.equal(client.port, 6543);
    assert.equal(client.user, 'voice_test.project');
    assert.equal(client.password, 'synthetic@password');
    assert.equal(client.database, 'postgres');
    assert.equal(new URL(config.connectionString!).search, '');
  }
});

test('postgres protocol and a percent-encoded password preserve their values', () => {
  const client = new Client(
    voiceDatabaseConfig(
      `postgres://${testUser}:${encodeURIComponent('synthetic#?/%')}@db.example.test/postgres?sslmode=verify-full`,
    ),
  );
  assert.equal(client.password, 'synthetic#?/%');
  assert.equal(client.port, 5432);
  assert.equal(client.host, 'db.example.test');
});

test('bundled CA is a currently valid self-signed CA certificate', () => {
  const certificate = new X509Certificate(SUPABASE_CA_CERTIFICATE);
  assert.equal(certificate.ca, true);
  assert.equal(certificate.checkIssued(certificate), true);
  assert.equal(certificate.verify(certificate.publicKey), true);
  const now = Date.now();
  assert.ok(Date.parse(certificate.validFrom) <= now);
  assert.ok(Date.parse(certificate.validTo) > now);
});

test('insecure, conflicting and arbitrary pg query overrides are rejected before pg parses them', () => {
  const queries = [
    'sslmode=disable',
    'sslmode=prefer',
    'sslmode=require',
    'sslmode=verify-ca',
    'sslmode=no-verify',
    'sslmode=verify-full&sslmode=verify-full',
    'sslmode=verify-full&sslmode=no-verify',
    'ssl=false',
    'ssl=true',
    'ssl=no-verify',
    'sslrootcert=private-file',
    'sslkey=private-file',
    'sslcert=private-file',
    'sslnegotiation=direct',
    'uselibpqcompat=true',
    'host=other.example.test',
    'user=postgres',
    'password=synthetic-password',
  ];
  for (const query of queries) {
    assert.throws(
      () => voiceDatabaseConfig(`${baseUrl}?${query}`),
      isSetupError,
    );
  }
});

test('missing fields, malformed URLs and invalid encoding return only a sanitized setup error', () => {
  const urls = [
    '',
    testPassword,
    `https://${testUser}:${testPassword}@db.example.test/postgres`,
    'postgresql://db.example.test/postgres',
    `postgresql://${testUser}@db.example.test/postgres`,
    `postgresql://:${testPassword}@db.example.test/postgres`,
    `postgresql://${testUser}:${testPassword}@/postgres`,
    `postgresql://${testUser}:${testPassword}@db.example.test/`,
    `postgresql://${testUser}:${testPassword}@db.example.test:0/postgres`,
    `postgresql://${testUser}:${testPassword}@db.example.test:65536/postgres`,
    `postgresql://${testUser}:${testPassword}%zz@db.example.test/postgres`,
    `postgresql://${testUser}:${testPassword}%00@db.example.test/postgres`,
    `${baseUrl}#${testPassword}`,
    `${baseUrl}\n`,
  ];
  for (const url of urls) {
    assert.throws(() => voiceDatabaseConfig(url), isSetupError);
  }
});
