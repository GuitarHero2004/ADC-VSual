import 'server-only';

import { createServerClient, type SetAllCookies } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';
import { getSupabaseConfig } from './env';

export async function updateSession(request: NextRequest) {
  const config = getSupabaseConfig();

  // The public foundation remains usable without an Auth configuration.
  if (!config) return NextResponse.next({ request });

  const cookiesToWrite: Parameters<SetAllCookies>[0] = [];
  const responseHeaders = new Headers({ 'Cache-Control': 'private, no-store' });

  const supabase = createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        cookiesToWrite.push(...cookiesToSet);
        // Supabase supplies cache headers to prevent sharing refreshed sessions.
        Object.entries(headers).forEach(([name, value]) =>
          responseHeaders.set(name, value),
        );
      },
    },
  });

  // This verifies/refreshes the token. It does not authorize product API access.
  // Public pages remain accessible when there is no valid session.
  await supabase.auth.getClaims();

  const response = NextResponse.next({ request, headers: responseHeaders });
  cookiesToWrite.forEach(({ name, value, options }) =>
    response.cookies.set(name, value, options),
  );
  return response;
}
