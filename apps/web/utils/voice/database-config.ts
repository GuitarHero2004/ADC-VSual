import 'server-only';
import type { PoolConfig } from 'pg';
import { VoiceError } from './errors.ts';
import { SUPABASE_CA_CERTIFICATE } from './supabase-ca.ts';

export function voiceDatabaseConfig(connectionString: string): PoolConfig {
  try {
    const url = URL.parse(connectionString.trim());
    if (
      !url ||
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !url.hostname ||
      !url.username ||
      !url.password ||
      url.pathname.length <= 1 ||
      url.hash ||
      Array.from(connectionString).some(
        (character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      ) ||
      (url.port && (Number(url.port) < 1 || Number(url.port) > 65_535))
    ) {
      throw new Error('Invalid database URL');
    }

    // Validate encoding before pg parses it; parser errors may contain input.
    for (const value of [url.username, url.password, url.pathname.slice(1)]) {
      if (decodeURIComponent(value).includes('\0')) {
        throw new Error('Invalid database URL');
      }
    }

    // pg URL query options override explicit options, including credentials and
    // the entire SSL object. Support only the documented full-verification URL.
    const options = [...url.searchParams];
    if (
      options.length > 1 ||
      options.some(
        ([name, value]) => name !== 'sslmode' || value !== 'verify-full',
      )
    ) {
      throw new Error('Unsupported database URL options');
    }
    url.searchParams.delete('sslmode');

    return {
      connectionString: url.toString(),
      ssl: {
        ca: SUPABASE_CA_CERTIFICATE,
        rejectUnauthorized: true,
      },
    };
  } catch {
    throw new VoiceError(
      'SETUP_REQUIRED',
      'Voice access is not configured. Ask the project administrator to check the database connection settings.',
      503,
    );
  }
}
