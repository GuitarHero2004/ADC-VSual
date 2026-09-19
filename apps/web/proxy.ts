import type { NextRequest } from 'next/server';
import { updateSession } from './utils/supabase/proxy';

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Product APIs will verify bearer identity independently. Health stays public.
  matcher: [
    '/((?!_next/|v1(?:/|$)|favicon\\.ico$|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
