import { randomUUID } from 'node:crypto';
import { getSupabaseConfig } from '../../../../utils/supabase/env';

export const dynamic = 'force-dynamic';

export async function GET() {
  const result = {
    request_id: randomUUID(),
    configuration: 'failed',
    auth: 'not_checked',
    database: 'not_checked',
  };
  const headers = { 'Cache-Control': 'private, no-store' };

  let config;
  try {
    config = getSupabaseConfig();
    if (!config) throw new Error('Missing configuration');
  } catch {
    return Response.json(
      { ...result, reason: 'missing_or_invalid_configuration' },
      { status: 503, headers },
    );
  }

  result.configuration = 'verified';
  result.auth = 'failed';

  try {
    // Public Auth settings are read-only and require only the existing key.
    // This verifies connectivity, not user sign-in or database permissions.
    const response = await fetch(new URL('/auth/v1/settings', config.url), {
      headers: { apikey: config.publishableKey },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return Response.json(
        {
          ...result,
          reason: 'auth_request_rejected',
          auth_http_status: response.status,
        },
        { status: 502, headers },
      );
    }

    const settings: unknown = await response.json();
    if (
      !settings ||
      typeof settings !== 'object' ||
      !('disable_signup' in settings) ||
      typeof settings.disable_signup !== 'boolean' ||
      !('external' in settings) ||
      !settings.external ||
      typeof settings.external !== 'object' ||
      Array.isArray(settings.external) ||
      !Object.values(settings.external).every(
        (enabled) => typeof enabled === 'boolean',
      )
    ) {
      return Response.json(
        { ...result, reason: 'unexpected_auth_response' },
        { status: 502, headers },
      );
    }

    return Response.json(
      { ...result, auth: 'verified', auth_http_status: response.status },
      { headers },
    );
  } catch {
    // Never expose upstream bodies, exception messages, or configuration values.
    return Response.json(
      { ...result, reason: 'auth_request_failed' },
      { status: 502, headers },
    );
  }
}
