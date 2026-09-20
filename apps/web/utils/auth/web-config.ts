export interface WebAuthConfig {
  siteUrl: string | null;
  google: boolean;
}
import type { WebOAuthAttempt } from './web-oauth.ts';

export function webVerificationFailure(
  error: unknown,
): 'missing' | 'expired' | 'unavailable' {
  if (typeof error !== 'object' || error === null) return 'unavailable';
  if ('name' in error && error.name === 'AuthSessionMissingError')
    return 'missing';
  if ('status' in error && (error.status === 401 || error.status === 403))
    return 'expired';
  if (
    'code' in error &&
    [
      'bad_jwt',
      'refresh_token_not_found',
      'refresh_token_already_used',
      'session_not_found',
      'user_banned',
    ].includes(String(error.code))
  )
    return 'expired';
  return 'unavailable';
}

export function webAuthConfig(
  env: Record<string, string | undefined> = process.env,
): WebAuthConfig {
  const raw =
    env.AUTH_SITE_URL ??
    (env.NODE_ENV === 'production' ? '' : 'http://127.0.0.1:3000');
  let siteUrl: string | null = null;
  try {
    const url = new URL(raw);
    const local =
      url.protocol === 'http:' &&
      ['127.0.0.1', 'localhost'].includes(url.hostname);
    if (
      (url.protocol === 'https:' || local) &&
      url.origin === raw &&
      !url.username &&
      !url.password &&
      !url.hostname.includes('*')
    )
      siteUrl = raw;
  } catch {
    /* Missing or invalid Google configuration leaves password sign-in usable. */
  }
  return {
    siteUrl,
    google: Boolean(siteUrl && env.GOOGLE_AUTH_ENABLED === 'true'),
  };
}

/** One owner exchanges the code once using the original website cookie verifier. */
export async function webCallbackDestination(
  url: URL,
  config: WebAuthConfig,
  exchange: (code: string, flowId: string) => Promise<{ error: unknown }>,
  attempt: WebOAuthAttempt | null,
): Promise<string> {
  const language = attempt?.language ?? 'en';
  const failure = (status: string) =>
    `/auth/sign-in?status=${status}&lang=${language}`;
  if (!config.google || !config.siteUrl) return failure('GOOGLE_UNAVAILABLE');
  if (url.origin !== config.siteUrl) return failure('CALLBACK_MISMATCH');
  const allowed = ['code', 'error', 'error_description', 'error_code'];
  if (
    [...url.searchParams.keys()].some(
      (key) =>
        !allowed.includes(key) || url.searchParams.getAll(key).length !== 1,
    )
  )
    return failure('CALLBACK_MISMATCH');
  if (url.searchParams.has('error'))
    return failure(
      url.searchParams.get('error') === 'access_denied'
        ? 'CANCELLED'
        : 'PROVIDER_ERROR',
    );
  const code = url.searchParams.get('code');
  if (
    !code ||
    !/^[\w-]{1,4096}$/.test(code) ||
    !attempt ||
    attempt.expiresAt <= Date.now()
  )
    return failure('CALLBACK_MISMATCH');
  try {
    const result = await exchange(code, attempt.flowId);
    return result.error ? failure('PROVIDER_ERROR') : '/voice';
  } catch {
    return failure('UNAVAILABLE');
  }
}
