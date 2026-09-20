import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '../../../utils/supabase/server';
import {
  webAuthConfig,
  webCallbackDestination,
} from '../../../utils/auth/web-config';
import {
  parseWebOAuthCookie,
  WEB_FLOW_COOKIE,
} from '../../../utils/auth/web-oauth';

export async function GET(request: NextRequest) {
  const config = webAuthConfig();
  const cookieStore = await cookies();
  const attempt = parseWebOAuthCookie(cookieStore.get(WEB_FLOW_COOKIE)?.value);
  // Consume our non-sensitive routing cookie regardless of callback outcome.
  cookieStore.set(WEB_FLOW_COOKIE, '', {
    path: '/auth/callback',
    maxAge: 0,
    sameSite: 'lax',
    secure: request.nextUrl.protocol === 'https:',
  });
  const destination = await webCallbackDestination(
    request.nextUrl,
    config,
    async (code, flowId) => {
      const supabase = await createClient();
      return supabase.auth.exchangeCodeForSession(code, { flowId });
    },
    attempt,
  );
  const response = NextResponse.redirect(
    new URL(destination, config.siteUrl ?? request.nextUrl.origin),
  );
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}
