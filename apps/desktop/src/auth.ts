import {
  authAccessResponseSchema,
  authAccountSchema,
  voiceErrorResponseSchema,
} from '@adc/contracts';
import { createClient, type Session } from '@supabase/supabase-js';
import type {
  DesktopConfiguration,
  DesktopConfigurationResult,
} from './config.ts';
import type {
  DesktopAuthErrorCode,
  DesktopSessionState,
} from './session-types.ts';

export class DesktopAuthError extends Error {
  readonly code: DesktopAuthErrorCode;
  constructor(code: DesktopAuthErrorCode) {
    super(code);
    this.name = 'DesktopAuthError';
    this.code = code;
  }
}

export interface DesktopAuthDependencies {
  fetch: typeof fetch;
  createClient: typeof createClient;
  now(): number;
  timeoutMs: number;
}

type Credentials = Pick<
  Session,
  'access_token' | 'refresh_token' | 'expires_at'
> & {
  user: { id: string; email: string };
};

function emptyState(): DesktopSessionState {
  return {
    phase: 'signed_out',
    account: null,
    workspace: 'unknown',
    epoch: crypto.randomUUID(),
    errorCode: null,
    logoutConfirmed: null,
  };
}

function safeCode(error: unknown): DesktopAuthErrorCode {
  if (error instanceof DesktopAuthError) return error.code;
  const value = error as {
    code?: unknown;
    status?: unknown;
    name?: unknown;
  } | null;
  if (value?.code === 'invalid_credentials') return 'INVALID_CREDENTIALS';
  if (value?.code === 'email_not_confirmed') return 'EMAIL_UNCONFIRMED';
  if (value?.status === 429 || value?.code === 'over_request_rate_limit')
    return 'RATE_LIMITED';
  if (
    value?.status === 401 ||
    value?.name === 'AuthSessionMissingError' ||
    [
      'refresh_token_not_found',
      'refresh_token_already_used',
      'session_not_found',
      'session_expired',
      'bad_jwt',
      'user_not_found',
      'user_banned',
    ].includes(String(value?.code))
  )
    return 'SESSION_EXPIRED';
  return 'UNAVAILABLE';
}

function credentials(value: Session | null): Credentials {
  const account = authAccountSchema.safeParse({
    id: value?.user.id,
    email: value?.user.email ?? '',
  });
  if (!value?.access_token || !value.refresh_token || !account.success)
    throw new DesktopAuthError('SESSION_EXPIRED');
  return {
    access_token: value.access_token,
    refresh_token: value.refresh_token,
    ...(value.expires_at !== undefined ? { expires_at: value.expires_at } : {}),
    user: account.data,
  };
}

function unavailableResponse() {
  // A non-retryable provider response prevents the SDK's internal refresh loop.
  return Response.json(
    { error_code: 'auth_unavailable', msg: 'Authentication is unavailable.' },
    { status: 408 },
  );
}

function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void work.catch(() => undefined);
    return Promise.reject(new DesktopAuthError('CANCELLED'));
  }
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(new DesktopAuthError('CANCELLED'));
    signal.addEventListener('abort', aborted, { once: true });
    work
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', aborted));
  });
}

/** The desktop main process is the only credential owner. Nothing is persisted. */
export class DesktopAuth {
  #getConfiguration: () => DesktopConfigurationResult;
  #onInvalidate: () => void;
  #deps: DesktopAuthDependencies;
  #state = emptyState();
  #session: Credentials | null = null;
  #configuration: DesktopConfiguration | null = null;
  #generation = 0;
  #disposed = false;
  #controller = new AbortController();
  #listeners = new Set<(state: DesktopSessionState) => void>();
  #login: Promise<DesktopSessionState> | null = null;
  #validation: {
    generation: number;
    promise: Promise<DesktopSessionState>;
  } | null = null;

  constructor(
    getConfiguration: () => DesktopConfigurationResult,
    onInvalidate: () => void = () => undefined,
    dependencies: Partial<DesktopAuthDependencies> = {},
  ) {
    this.#getConfiguration = getConfiguration;
    this.#onInvalidate = onInvalidate;
    this.#deps = {
      fetch: globalThis.fetch,
      createClient,
      now: Date.now,
      timeoutMs: 10_000,
      ...dependencies,
    };
  }

  snapshot(): DesktopSessionState {
    return {
      ...this.#state,
      account: this.#state.account ? { ...this.#state.account } : null,
    };
  }

  subscribe(listener: (state: DesktopSessionState) => void): () => void {
    if (!this.#disposed) this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  async signIn(email: string, password: string): Promise<DesktopSessionState> {
    if (this.#disposed) throw new DesktopAuthError('CANCELLED');
    if (this.#login) return this.#login.then(() => this.snapshot());
    if (this.#session) throw new DesktopAuthError('ACCOUNT_CHANGE_REQUIRED');
    if (
      typeof email !== 'string' ||
      email.length > 320 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
      typeof password !== 'string' ||
      !password.length ||
      password.length > 1024
    ) {
      this.#set({ ...this.#state, errorCode: 'INVALID_CREDENTIALS' });
      return this.snapshot();
    }
    let configuration: DesktopConfiguration;
    try {
      configuration = this.#readConfiguration();
    } catch {
      this.#set({ ...this.#state, errorCode: 'SETUP_REQUIRED' });
      return this.snapshot();
    }
    this.#reset();
    this.#configuration = configuration;
    const generation = this.#generation;
    const signal = this.#controller.signal;
    this.#set({ ...this.#state, phase: 'signing_in' });
    const work = (async () => {
      try {
        const { data, error } = await this.#client(
          configuration,
          signal,
        ).auth.signInWithPassword({ email: email.trim(), password });
        if (!this.#current(generation)) return this.snapshot();
        if (error) throw error;
        this.#session = credentials(data.session);
        this.#set({ ...this.#state, account: { ...this.#session.user } });
        return await this.#check();
      } catch (error) {
        if (this.#current(generation)) {
          const code = safeCode(error);
          this.#set({ ...this.#state, phase: 'signed_out', errorCode: code });
        }
        return this.snapshot();
      }
    })();
    this.#login = work;
    try {
      await work;
      return this.snapshot();
    } finally {
      if (this.#login === work) this.#login = null;
    }
  }

  async retry(): Promise<DesktopSessionState> {
    if (this.#disposed) throw new DesktopAuthError('CANCELLED');
    if (this.#login) {
      await this.#login;
      return this.snapshot();
    }
    if (this.#session) return this.#check();
    try {
      this.#readConfiguration();
    } catch {
      this.#set({ ...this.#state, errorCode: 'SETUP_REQUIRED' });
    }
    return this.snapshot();
  }

  async authorized(signal: AbortSignal): Promise<{
    headers: Record<string, string>;
    userId: string;
    epoch: string;
  }> {
    if (this.#disposed || signal.aborted)
      throw new DesktopAuthError('CANCELLED');
    if (this.#state.phase === 'unavailable')
      throw new DesktopAuthError('UNAVAILABLE');
    if (!this.#session || this.#state.phase !== 'signed_in')
      throw new DesktopAuthError(this.#state.errorCode ?? 'UNAUTHENTICATED');
    const generation = this.#generation;
    await abortable(this.#check(), signal);
    if (!this.#current(generation) || signal.aborted)
      throw new DesktopAuthError('CANCELLED');
    if (!this.#session || this.#state.phase !== 'signed_in')
      throw new DesktopAuthError(this.#state.errorCode ?? 'UNAUTHENTICATED');
    if (this.#state.workspace !== 'allowed')
      throw new DesktopAuthError(
        this.#state.workspace === 'denied' ? 'FORBIDDEN' : 'UNAVAILABLE',
      );
    return {
      headers: this.#headers(this.#session, this.#configuration!),
      userId: this.#session.user.id,
      epoch: this.#state.epoch,
    };
  }

  async signOut(): Promise<DesktopSessionState> {
    if (this.#disposed) return this.snapshot();
    const previous = this.#session;
    const configuration = this.#configuration;
    const loginPending = this.#state.phase === 'signing_in';
    this.#reset();
    const generation = this.#generation;
    this.#set(this.#state);
    // A cancelled password request may have reached the server without returning
    // credentials. Local clearing cannot confirm revocation of that unknown session.
    let confirmed = !previous && !loginPending;
    if (previous && configuration) {
      try {
        const response = await this.#request(
          new URL('/auth/v1/logout?scope=local', configuration.supabaseUrl),
          {
            method: 'POST',
            headers: {
              apikey: configuration.publishableKey,
              Authorization: `Bearer ${previous.access_token}`,
            },
          },
          this.#controller.signal,
        );
        confirmed = response.ok;
      } catch {
        confirmed = false;
      }
    }
    if (this.#current(generation))
      this.#set({ ...this.#state, logoutConfirmed: confirmed });
    return this.snapshot();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#reset();
    this.#disposed = true;
    this.#listeners.clear();
  }

  #readConfiguration(): DesktopConfiguration {
    const result = this.#getConfiguration();
    if (!result.ok) throw new DesktopAuthError('SETUP_REQUIRED');
    return { ...result.value };
  }

  #reset(): void {
    this.#generation++;
    this.#controller.abort();
    this.#controller = new AbortController();
    this.#session = null;
    this.#configuration = null;
    this.#validation = null;
    this.#login = null;
    this.#state = emptyState();
    this.#invalidate();
  }

  #current(generation: number): boolean {
    return !this.#disposed && generation === this.#generation;
  }

  #invalidate(): void {
    try {
      this.#onInvalidate();
    } catch {
      /* A closing host cannot retain credentials. */
    }
  }

  #set(state: DesktopSessionState): void {
    if (this.#disposed) return;
    if (
      this.#state.phase === 'signed_in' &&
      this.#state.workspace === 'allowed' &&
      (state.phase !== 'signed_in' || state.workspace !== 'allowed')
    )
      this.#invalidate();
    this.#state = state;
    for (const listener of this.#listeners) {
      try {
        listener(this.snapshot());
      } catch {
        /* A detached renderer cannot affect authentication. */
      }
    }
  }

  #headers(
    session: Credentials,
    configuration: DesktopConfiguration,
  ): Record<string, string> {
    return {
      Authorization: `Bearer ${session.access_token}`,
      ...(configuration.workspaceId
        ? { 'X-Workspace-ID': configuration.workspaceId }
        : {}),
    };
  }

  #check(): Promise<DesktopSessionState> {
    if (this.#validation?.generation === this.#generation)
      return this.#validation.promise.then(() => this.snapshot());
    const generation = this.#generation;
    const promise = this.#verify(generation);
    const validation = { generation, promise };
    this.#validation = validation;
    void promise.finally(() => {
      if (this.#validation === validation) this.#validation = null;
    });
    return promise.then(() => this.snapshot());
  }

  async #verify(generation: number): Promise<DesktopSessionState> {
    const configuration = this.#configuration;
    let session = this.#session;
    if (!session || !configuration || !this.#current(generation))
      return this.snapshot();
    const signal = this.#controller.signal;
    try {
      if (
        !session.expires_at ||
        session.expires_at * 1000 <= this.#deps.now() + 60_000
      ) {
        const { data, error } = await this.#client(
          configuration,
          signal,
        ).auth.refreshSession({ refresh_token: session.refresh_token });
        if (!this.#current(generation)) return this.snapshot();
        if (error) throw error;
        const refreshed = credentials(data.session);
        if (refreshed.user.id !== session.user.id)
          throw new DesktopAuthError('SESSION_EXPIRED');
        session = refreshed;
        // Retain rotated credentials even when the next verification is unavailable.
        this.#session = session;
      }
      const { data, error } = await this.#client(
        configuration,
        signal,
      ).auth.getUser(session.access_token);
      if (!this.#current(generation)) return this.snapshot();
      if (error) throw error;
      if (data.user?.id !== session.user.id)
        throw new DesktopAuthError('SESSION_EXPIRED');
      const response = await this.#request(
        new URL('/api/auth/access', configuration.apiBaseUrl),
        {
          method: 'GET',
          headers: this.#headers(session, configuration),
          cache: 'no-store',
        },
        signal,
      );
      if (!this.#current(generation)) return this.snapshot();
      if (response.status === 401) {
        // Hosting protection can return its own 401. Only the backend's verified
        // auth-error contract confirms that this Supabase session was rejected.
        const failure = voiceErrorResponseSchema.safeParse(
          await abortable(response.json(), signal),
        );
        if (failure.success && failure.data.error.code === 'UNAUTHENTICATED')
          throw new DesktopAuthError('SESSION_EXPIRED');
      }
      if (!response.ok)
        throw new DesktopAuthError(
          response.status === 429 ? 'RATE_LIMITED' : 'UNAVAILABLE',
        );
      const parsed = authAccessResponseSchema.safeParse(
        await abortable(response.json(), signal),
      );
      if (!this.#current(generation)) return this.snapshot();
      if (!parsed.success) throw new DesktopAuthError('UNAVAILABLE');
      if (parsed.data.account.id !== session.user.id)
        throw new DesktopAuthError('SESSION_EXPIRED');
      this.#set({
        ...this.#state,
        phase:
          parsed.data.workspace === 'unavailable' ? 'unavailable' : 'signed_in',
        account: parsed.data.account,
        workspace: parsed.data.workspace,
        errorCode:
          parsed.data.workspace === 'denied'
            ? 'FORBIDDEN'
            : parsed.data.workspace === 'unavailable'
              ? 'UNAVAILABLE'
              : null,
      });
    } catch (error) {
      if (!this.#current(generation)) return this.snapshot();
      const code = safeCode(error);
      if (code === 'SESSION_EXPIRED') {
        this.#reset();
        this.#set({ ...this.#state, errorCode: code });
      } else {
        this.#set({
          ...this.#state,
          phase: 'unavailable',
          workspace: 'unavailable',
          errorCode: code === 'CANCELLED' ? 'UNAVAILABLE' : code,
        });
      }
    }
    return this.snapshot();
  }

  #client(configuration: DesktopConfiguration, signal: AbortSignal) {
    return this.#deps.createClient(
      configuration.supabaseUrl,
      configuration.publishableKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
          storageKey: `vsual-desktop-${crypto.randomUUID()}`,
        },
        global: {
          fetch: async (input, init) => {
            try {
              const url = new URL(
                typeof input === 'string'
                  ? input
                  : input instanceof URL
                    ? input.href
                    : input.url,
              );
              if (
                url.origin !== configuration.supabaseUrl ||
                !url.pathname.startsWith('/auth/v1/') ||
                url.username ||
                url.password
              )
                return unavailableResponse();
              const response = await this.#request(input, init, signal);
              return response.status >= 500 ? unavailableResponse() : response;
            } catch {
              return unavailableResponse();
            }
          },
        },
      },
    );
  }

  #request(
    input: string | URL | Request,
    init: RequestInit | undefined,
    signal: AbortSignal,
  ): Promise<Response> {
    const bounded = AbortSignal.any([
      signal,
      AbortSignal.timeout(this.#deps.timeoutMs),
      ...(init?.signal ? [init.signal] : []),
    ]);
    return abortable(
      Promise.resolve().then(() => {
        bounded.throwIfAborted();
        return this.#deps.fetch(input, {
          ...init,
          redirect: 'error',
          signal: bounded,
        });
      }),
      bounded,
    );
  }
}
