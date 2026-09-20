import type { AuthFailureCode } from '@adc/contracts';
import {
  createClient,
  type Session,
  type User,
  type SupportedStorage,
} from '@supabase/supabase-js';

type SessionStorage = Pick<
  chrome.storage.StorageArea,
  'get' | 'set' | 'remove'
>;
type Config = { supabaseUrl: string; publishableKey: string };
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const flowPattern = /^[a-zA-Z0-9_-]{8,64}$/;

export class AuthFlowError extends Error {
  readonly code: AuthFailureCode;
  constructor(code: AuthFailureCode) {
    super(code);
    this.name = 'AuthFlowError';
    this.code = code;
  }
}

export interface AuthGateway {
  password(email: string, password: string): Promise<Session>;
  startGoogle(
    attemptId: string,
    redirectUrl: string,
  ): Promise<{ url: string; flowId: string }>;
  finishGoogle(
    attemptId: string,
    code: string,
    flowId: string,
  ): Promise<Session>;
  refresh(session: Session): Promise<Session>;
  verify(session: Session): Promise<User>;
  logout(session: Session): Promise<boolean>;
  clearAttempt(attemptId: string): Promise<void>;
}

function safeError(error: unknown, fallback: AuthFailureCode): AuthFlowError {
  if (error instanceof AuthFlowError) return error;
  const value = error as {
    code?: unknown;
    status?: unknown;
    name?: unknown;
  } | null;
  const code = value?.code;
  if (code === 'invalid_credentials')
    return new AuthFlowError('INVALID_CREDENTIALS');
  if (code === 'email_not_confirmed')
    return new AuthFlowError('EMAIL_UNCONFIRMED');
  if (value?.status === 429 || code === 'over_request_rate_limit')
    return new AuthFlowError('RATE_LIMITED');
  if (
    code === 'provider_disabled' ||
    code === 'provider_not_enabled' ||
    code === 'oauth_provider_not_supported'
  )
    return new AuthFlowError('GOOGLE_UNAVAILABLE');
  if (
    code === 'auth_unavailable' ||
    value?.status === 408 ||
    value?.name === 'AuthRetryableFetchError'
  )
    return new AuthFlowError('UNAVAILABLE');
  if (
    value?.status === 401 ||
    code === 'refresh_token_not_found' ||
    code === 'refresh_token_already_used' ||
    code === 'session_not_found' ||
    code === 'session_expired' ||
    code === 'bad_jwt' ||
    code === 'user_not_found' ||
    code === 'user_banned' ||
    value?.name === 'AuthSessionMissingError'
  )
    return new AuthFlowError('SESSION_EXPIRED');
  if (
    value?.name === 'AuthPKCECodeVerifierMissingError' ||
    code === 'bad_code_verifier'
  )
    return new AuthFlowError('INVALID_ATTEMPT');
  return new AuthFlowError(fallback);
}

function unavailable() {
  // Stop the SDK's refresh retry loop after a transport failure. The owner retains
  // its session and presents Retry; no raw provider or network details escape.
  return Response.json(
    {
      error_code: 'auth_unavailable',
      msg: 'Authentication is temporarily unavailable.',
    },
    { status: 408 },
  );
}

export function createExtensionAuthGateway(
  config: Config,
  storage: SessionStorage = chrome.storage.session,
): AuthGateway {
  let base: URL;
  try {
    base = new URL(config.supabaseUrl);
  } catch {
    throw new AuthFlowError('SETUP_REQUIRED');
  }
  if (
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== '/' ||
    !(
      base.protocol === 'https:' ||
      (base.protocol === 'http:' &&
        ['localhost', '127.0.0.1'].includes(base.hostname))
    ) ||
    !config.publishableKey.trim()
  ) {
    throw new AuthFlowError('SETUP_REQUIRED');
  }
  const generations = new Map<string, number>();
  let storageQueue: Promise<unknown> = Promise.resolve();
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = storageQueue.then(operation, operation);
    storageQueue = result.catch(() => undefined);
    return result;
  }
  function attemptKey(id: string) {
    if (!uuid.test(id)) throw new AuthFlowError('INVALID_ATTEMPT');
    return `adc:auth:pkce:${id}`;
  }
  function safeEntries(value: unknown): Record<string, string> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        ([key, item]) =>
          key.startsWith('adc-pkce-') &&
          key.endsWith('-code-verifier') &&
          typeof item === 'string' &&
          item.length <= 4096,
      ),
    );
  }
  function pkceStorage(id: string): SupportedStorage {
    const key = attemptKey(id);
    const generation = generations.get(id) ?? 0;
    const allowed = (slot: string) =>
      slot.startsWith(`adc-pkce-${id}`) && slot.endsWith('-code-verifier');
    return {
      getItem: (slot) =>
        serial(async () => {
          if (!allowed(slot) || generation !== (generations.get(id) ?? 0))
            return null;
          return safeEntries((await storage.get(key))[key])[slot] ?? null;
        }),
      setItem: (slot, value) =>
        serial(async () => {
          if (!allowed(slot) || generation !== (generations.get(id) ?? 0))
            return;
          const entries = safeEntries((await storage.get(key))[key]);
          entries[slot] = value;
          await storage.set({ [key]: entries });
          if (generation !== (generations.get(id) ?? 0))
            await storage.remove(key);
        }),
      removeItem: (slot) =>
        serial(async () => {
          if (!allowed(slot) || generation !== (generations.get(id) ?? 0))
            return;
          const entries = safeEntries((await storage.get(key))[key]);
          delete entries[slot];
          if (Object.keys(entries).length)
            await storage.set({ [key]: entries });
          else await storage.remove(key);
        }),
    };
  }
  function client(attemptId?: string, memory?: SupportedStorage) {
    const deadline = AbortSignal.timeout(10_000);
    const boundedFetch: typeof fetch = async (input, init) => {
      try {
        const url = new URL(
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url,
        );
        if (
          url.origin !== base.origin ||
          !url.pathname.startsWith('/auth/v1/') ||
          url.username ||
          url.password
        )
          return unavailable();
        deadline.throwIfAborted();
        const response = await fetch(input, {
          ...init,
          redirect: 'error',
          signal: AbortSignal.any([
            deadline,
            ...(init?.signal ? [init.signal] : []),
          ]),
        });
        return response.status >= 500 ? unavailable() : response;
      } catch {
        return unavailable();
      }
    };
    return createClient(base.origin, config.publishableKey, {
      auth: {
        persistSession: !!attemptId,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        flowType: 'pkce',
        storageKey: attemptId
          ? `adc-pkce-${attemptId}`
          : `adc-auth-${crypto.randomUUID()}`,
        ...(attemptId ? { storage: memory ?? pkceStorage(attemptId) } : {}),
      },
      global: { fetch: boundedFetch },
    });
  }
  async function clearAttempt(id: string) {
    const key = attemptKey(id);
    generations.set(id, (generations.get(id) ?? 0) + 1);
    await serial(() => storage.remove(key));
  }
  return {
    async password(email, password) {
      try {
        const { data, error } = await client().auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        if (!data.session) throw new AuthFlowError('PROVIDER_ERROR');
        return data.session;
      } catch (error) {
        throw safeError(error, 'UNAVAILABLE');
      }
    },
    async startGoogle(attemptId, redirectUrl) {
      attemptKey(attemptId);
      let redirect: URL;
      try {
        redirect = new URL(redirectUrl);
      } catch {
        throw new AuthFlowError('CALLBACK_MISMATCH');
      }
      if (
        redirect.protocol !== 'https:' ||
        !/^[a-p]{32}\.chromiumapp\.org$/.test(redirect.hostname) ||
        redirect.port ||
        redirect.pathname !== '/auth' ||
        redirect.search ||
        redirect.hash ||
        redirect.username ||
        redirect.password
      )
        throw new AuthFlowError('CALLBACK_MISMATCH');
      try {
        const { data, error } = await client(attemptId).auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: redirect.href,
            skipBrowserRedirect: true,
            scopes: 'openid email profile',
            queryParams: { prompt: 'select_account' },
          },
        });
        if (error) throw error;
        if (!data.url || !data.flowId || !flowPattern.test(data.flowId))
          throw new AuthFlowError('PROVIDER_ERROR');
        const url = new URL(data.url);
        if (url.origin !== base.origin || url.pathname !== '/auth/v1/authorize')
          throw new AuthFlowError('PROVIDER_ERROR');
        return { url: data.url, flowId: data.flowId };
      } catch (error) {
        await clearAttempt(attemptId);
        throw safeError(error, 'PROVIDER_ERROR');
      }
    },
    async finishGoogle(attemptId, code, flowId) {
      const key = attemptKey(attemptId);
      if (!flowPattern.test(flowId) || !code || code.length > 4096)
        throw new AuthFlowError('INVALID_ATTEMPT');
      const entries = await serial(async () => {
        const saved = safeEntries((await storage.get(key))[key]);
        if (!saved[`adc-pkce-${attemptId}-flow-${flowId}-code-verifier`])
          throw new AuthFlowError('INVALID_ATTEMPT');
        // Consume before the network request; another callback cannot exchange it.
        await storage.remove(key);
        return saved;
      });
      const memory: SupportedStorage = {
        getItem: (slot) => entries[slot] ?? null,
        setItem: () => {},
        removeItem: (slot) => {
          delete entries[slot];
        },
      };
      try {
        const { data, error } = await client(
          attemptId,
          memory,
        ).auth.exchangeCodeForSession(code, { flowId });
        if (error) throw error;
        if (!data.session) throw new AuthFlowError('PROVIDER_ERROR');
        const session = { ...data.session };
        // VSual needs its Supabase session only, never Google API credentials.
        delete session.provider_token;
        delete session.provider_refresh_token;
        return session;
      } catch (error) {
        throw safeError(error, 'PROVIDER_ERROR');
      } finally {
        for (const slot of Object.keys(entries)) delete entries[slot];
      }
    },
    async refresh(session) {
      try {
        const { data, error } = await client().auth.refreshSession({
          refresh_token: session.refresh_token,
        });
        if (error) throw error;
        if (!data.session || data.session.user.id !== session.user.id)
          throw new AuthFlowError('SESSION_EXPIRED');
        return data.session;
      } catch (error) {
        throw safeError(error, 'UNAVAILABLE');
      }
    },
    async verify(session) {
      try {
        const { data, error } = await client().auth.getUser(
          session.access_token,
        );
        if (error) throw error;
        if (!data.user || data.user.id !== session.user.id)
          throw new AuthFlowError('SESSION_EXPIRED');
        return data.user;
      } catch (error) {
        throw safeError(error, 'UNAVAILABLE');
      }
    },
    async logout(session) {
      try {
        const response = await fetch(
          new URL('/auth/v1/logout?scope=local', base),
          {
            method: 'POST',
            headers: {
              apikey: config.publishableKey,
              Authorization: `Bearer ${session.access_token}`,
            },
            signal: AbortSignal.timeout(10_000),
            redirect: 'error',
          },
        );
        // An expired access token may leave a refresh token active. A rejected
        // logout request is not confirmation that this server session was revoked.
        return response.ok;
      } catch {
        return false;
      }
    },
    clearAttempt,
  };
}
