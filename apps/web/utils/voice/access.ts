import 'server-only';

import { createServerClient, parseCookieHeader } from '@supabase/ssr';
import { createClient, isAuthError, type User } from '@supabase/supabase-js';
import { Pool, type PoolClient } from 'pg';
import { requireSupabaseConfig } from '../supabase/env.ts';
import { voiceDatabaseConfig } from './database-config.ts';
import { VoiceError } from './errors.ts';

export interface VoiceIdentity {
  subject: string;
  userId: string;
  workspaceId: string;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let pool: Pool | undefined;

function setupError() {
  return new VoiceError(
    'SETUP_REQUIRED',
    'Voice access is not configured. Ask the project administrator to finish the database and account setup.',
    503,
  );
}

function getPool() {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw setupError();
  }

  pool = new Pool({
    ...voiceDatabaseConfig(connectionString),
    max: 3,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 5_000,
    query_timeout: 6_000,
    application_name: 'adc-voice',
  });
  // An idle connection error must not terminate the server or expose connection details.
  pool.on('error', () => {});
  return pool;
}

async function withIdentity<T>(
  identity: VoiceIdentity,
  run: (client: PoolClient) => Promise<T>,
): Promise<T> {
  let client: PoolClient | undefined;
  let discardConnection = false;
  try {
    client = await getPool().connect();
    // A waiting reservation must see the previous holder's committed usage after
    // taking the advisory lock, even if deployment defaults were changed.
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await client.query("SET LOCAL statement_timeout = '5000ms'");

    // A deployment mistake must fail closed, even if the supplied role could bypass RLS.
    const roles = await client.query<{ safe: boolean }>(`
      SELECT NOT (r.rolsuper OR r.rolbypassrls)
        AND (SELECT count(*) = 4 AND bool_and(
          c.relrowsecurity AND c.relforcerowsecurity
          AND NOT pg_has_role(current_user, c.relowner, 'MEMBER')
        ) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'va' AND c.relname IN
            ('app_users', 'workspaces', 'memberships', 'voice_request_usage')) AS safe
      FROM pg_roles r WHERE r.rolname = current_user
    `);
    if (roles.rows[0]?.safe !== true) throw setupError();

    await client.query(
      "SELECT set_config('app.user_id', $1, true), set_config('app.workspace_id', $2, true)",
      [identity.userId, identity.workspaceId],
    );
    const membership = await client.query<{ id: string }>(
      `SELECT u.id FROM va.app_users u
       JOIN va.memberships m ON m.user_id = u.id
       JOIN va.workspaces w ON w.id = m.workspace_id
       WHERE u.id = $1 AND u.identity_subject = $2 AND u.status = 'active'
         AND m.workspace_id = $3 AND m.status = 'active' AND w.status = 'active'`,
      [identity.userId, identity.subject, identity.workspaceId],
    );
    if (membership.rows.length !== 1) {
      throw new VoiceError(
        'FORBIDDEN',
        'Your account does not have active access to this workspace.',
        403,
      );
    }
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Release the failed connection below; never return raw database errors.
        discardConnection = true;
      }
    }
    if (error instanceof VoiceError) throw error;
    throw setupError();
  } finally {
    client?.release(discardConnection);
  }
}

function unauthenticated() {
  return new VoiceError(
    'UNAUTHENTICATED',
    'Your session has expired. Sign in again.',
    401,
  );
}

function authUnavailable() {
  return new VoiceError(
    'AUTH_UNAVAILABLE',
    'We could not verify your session right now. Check your connection and try again.',
    503,
    true,
  );
}

/** Verify with Supabase Auth; stored client claims alone never authorize access. */
export async function verifyAuthUser(request: Request): Promise<User> {
  const authorization = request.headers.get('Authorization');
  const cookieHeader = request.headers.get('Cookie');
  if (!authorization && !cookieHeader) {
    throw new VoiceError('UNAUTHENTICATED', 'Sign in to use VSual.', 401);
  }
  const bearer = authorization?.match(/^Bearer ([^\s]+)$/i)?.[1];
  if (authorization && (!bearer || bearer.length > 16_384)) {
    throw unauthenticated();
  }

  let config: ReturnType<typeof requireSupabaseConfig>;
  try {
    config = requireSupabaseConfig();
  } catch {
    throw setupError();
  }
  const boundedFetch: typeof fetch = (input, init) =>
    fetch(input, {
      ...init,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(8_000)]),
    });
  const supabase = bearer
    ? createClient(config.url, config.publishableKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
        global: { fetch: boundedFetch },
      })
    : createServerClient(config.url, config.publishableKey, {
        global: { fetch: boundedFetch },
        cookies: {
          getAll: () =>
            parseCookieHeader(cookieHeader ?? '').map(({ name, value }) => ({
              name,
              value: value ?? '',
            })),
          // The existing Next proxy refreshes browser cookies before this route.
          setAll: () => {},
        },
      });

  try {
    const { data, error } = await supabase.auth.getUser(bearer);
    if (request.signal.aborted) {
      throw new VoiceError('CANCELLED', 'The request was cancelled.', 499);
    }
    if (error) {
      // A temporary network/service failure is not evidence of a revoked session.
      if (
        error.name === 'AuthSessionMissingError' ||
        error.status === 401 ||
        error.status === 403 ||
        (error.status === 400 &&
          [
            'bad_jwt',
            'session_not_found',
            'refresh_token_not_found',
            'refresh_token_already_used',
          ].includes(error.code ?? ''))
      ) {
        throw unauthenticated();
      }
      throw authUnavailable();
    }
    if (!data.user || !uuidPattern.test(data.user.id)) throw unauthenticated();
    return data.user;
  } catch (error) {
    if (request.signal.aborted) {
      throw new VoiceError('CANCELLED', 'The request was cancelled.', 499);
    }
    if (error instanceof VoiceError) throw error;
    if (isAuthError(error) && (error.status === 401 || error.status === 403)) {
      throw unauthenticated();
    }
    throw authUnavailable();
  }
}

/** Reuse only a User already verified by verifyAuthUser in this request. */
export async function verifyVoiceIdentity(
  request: Request,
  user: User,
): Promise<VoiceIdentity> {
  // app_metadata is identity-admin controlled. Never read this mapping from user_metadata.
  const userId: unknown = user.app_metadata.va_user_id;
  if (typeof userId !== 'string' || !uuidPattern.test(userId)) {
    throw new VoiceError(
      'FORBIDDEN',
      'Your account does not have active access to this workspace.',
      403,
    );
  }
  const workspaceId =
    request.headers.get('X-Workspace-ID') ??
    process.env.VA_VOICE_WORKSPACE_ID?.trim();
  if (!workspaceId || !uuidPattern.test(workspaceId)) {
    if (request.headers.has('X-Workspace-ID')) {
      throw new VoiceError('INVALID_INPUT', 'Choose a valid workspace.', 400);
    }
    throw setupError();
  }
  const identity = { subject: user.id, userId, workspaceId };
  await withIdentity(identity, async () => {});
  return identity;
}

export async function verifyVoiceUser(
  request: Request,
): Promise<VoiceIdentity> {
  return verifyVoiceIdentity(request, await verifyAuthUser(request));
}

export async function reserveVoiceRequest(
  identity: VoiceIdentity,
  requestId: string,
): Promise<void> {
  if (!uuidPattern.test(requestId)) {
    throw new VoiceError(
      'INVALID_INPUT',
      'A valid request identifier is required.',
      400,
    );
  }
  await withIdentity(identity, async (client) => {
    // Serialize this user's attempts across workspaces and every Vercel instance.
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [identity.userId],
    );
    await client.query(
      "DELETE FROM va.voice_request_usage WHERE user_id = $1 AND created_at <= clock_timestamp() - interval '24 hours'",
      [identity.userId],
    );
    const usage = await client.query<{
      duplicate: boolean;
      minute_count: number;
      day_count: number;
    }>(
      `SELECT coalesce(bool_or(request_id = $2), false) AS duplicate,
        (count(*) FILTER (WHERE created_at > clock_timestamp() - interval '1 minute'))::int AS minute_count,
        count(*)::int AS day_count
       FROM va.voice_request_usage WHERE user_id = $1`,
      [identity.userId, requestId],
    );
    const row = usage.rows[0];
    if (!row) throw setupError();
    if (row.duplicate) {
      throw new VoiceError(
        'DUPLICATE_REQUEST',
        'This voice request was already submitted. Start a new request if needed.',
        409,
      );
    }
    if (row.minute_count >= 6 || row.day_count >= 30) {
      throw new VoiceError(
        'RATE_LIMITED',
        'Voice test limit reached. Try again later; your text is still available.',
        429,
        true,
      );
    }
    await client.query(
      'INSERT INTO va.voice_request_usage (user_id, workspace_id, request_id) VALUES ($1, $2, $3)',
      [identity.userId, identity.workspaceId, requestId],
    );
  });
}
