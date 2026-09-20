import 'server-only';

import {
  authAccessResponseSchema,
  authCapabilitiesSchema,
} from '@adc/contracts';
import type { User } from '@supabase/supabase-js';
import type { VoiceIdentity } from '../voice/access.ts';
import { VoiceError } from '../voice/errors.ts';
import { corsHeaders } from '../voice/http.ts';

type AccessDependencies = {
  verifyAuthUser: (request: Request) => Promise<User>;
  verifyVoiceIdentity: (request: Request, user: User) => Promise<VoiceIdentity>;
};

function authHeaders(request: Request, publicConfiguration = false) {
  if (!request.headers.has('origin')) {
    // Fetch omits Origin for same-origin GETs. Fetch metadata is browser-set,
    // unlike a caller-provided user identity; Auth still verifies the cookies.
    if (request.headers.get('sec-fetch-site') === 'same-origin') {
      const headers = new Headers(request.headers);
      const url = new URL(request.url);
      headers.set(
        'origin',
        `${url.protocol}//${headers.get('host') ?? url.host}`,
      );
      return corsHeaders(new Request(request, { headers }));
    }
    if (publicConfiguration) {
      return new Headers({ 'Cache-Control': 'no-store', Vary: 'Origin' });
    }
  }
  return corsHeaders(request);
}

function authFailure(
  error: unknown,
  request: Request,
  id: string,
  headers: Headers,
) {
  const safe = request.signal.aborted
    ? new VoiceError('CANCELLED', 'The request was cancelled.', 499)
    : error instanceof VoiceError
      ? error
      : new VoiceError(
          'AUTH_UNAVAILABLE',
          'Your session could not be verified. Try again.',
          503,
          true,
        );
  return Response.json(
    {
      request_id: id,
      error: {
        code: safe.code,
        message: safe.message,
        retryable: safe.retryable,
      },
    },
    { status: safe.status, headers },
  );
}

/** Read identity/access only: never reserves usage or invokes an AI provider. */
export function createAuthAccessHandler(dependencies: AccessDependencies) {
  return async (request: Request) => {
    const id = crypto.randomUUID();
    let headers = new Headers({ 'Cache-Control': 'no-store', Vary: 'Origin' });
    try {
      headers = authHeaders(request);
      headers.set('X-Request-ID', id);
      request.signal.throwIfAborted();
      const user = await dependencies.verifyAuthUser(request);
      request.signal.throwIfAborted();
      let workspace: 'allowed' | 'denied' | 'unavailable' = 'allowed';
      try {
        await dependencies.verifyVoiceIdentity(request, user);
      } catch (error) {
        if (error instanceof VoiceError && error.code === 'FORBIDDEN') {
          workspace = 'denied';
        } else if (
          error instanceof VoiceError &&
          error.code === 'SETUP_REQUIRED'
        ) {
          workspace = 'unavailable';
        } else {
          throw error;
        }
      }
      request.signal.throwIfAborted();
      const result = authAccessResponseSchema.parse({
        request_id: id,
        account: { id: user.id, email: user.email ?? '' },
        workspace,
      });
      return Response.json(result, { headers });
    } catch (error) {
      return authFailure(error, request, id, headers);
    }
  };
}

/** Deployment capability, not a live provider connection/configuration check. */
export function authConfiguration(request: Request) {
  const id = crypto.randomUUID();
  try {
    const headers = authHeaders(request, true);
    return Response.json(
      authCapabilitiesSchema.parse({
        google: process.env.GOOGLE_AUTH_ENABLED === 'true',
      }),
      { headers },
    );
  } catch (error) {
    return authFailure(
      error,
      request,
      id,
      new Headers({ 'Cache-Control': 'no-store', Vary: 'Origin' }),
    );
  }
}
