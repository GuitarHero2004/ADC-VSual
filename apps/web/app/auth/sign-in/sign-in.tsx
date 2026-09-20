'use client';

import { useEffect, useRef, useState } from 'react';
import {
  authAccessResponseSchema,
  authFailureCodeSchema,
  type AuthFailureCode,
  type AuthStatus,
  type UiLanguage,
} from '@adc/contracts';
import {
  authCopy,
  authFailureText,
  SignInForm,
  signInErrorMessage,
} from '@adc/voice-ui';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { createClient } from '../../../utils/supabase/client';
import { webOAuthCookie } from '../../../utils/auth/web-oauth';
import { webVerificationFailure } from '../../../utils/auth/web-config';
import {
  authLanguage,
  browserAuthSender,
  extensionAttempt,
  WebAuthError,
  WebExtensionBridge,
} from '../../../utils/auth/web-bridge';

type Account = { id: string; email: string };
type State =
  | 'checking'
  | 'ready'
  | 'busy'
  | 'signing_out'
  | 'complete'
  | 'unverified'
  | 'cancelled'
  | 'invalid';

export default function SignIn({
  googleEnabled,
  siteUrl,
}: {
  googleEnabled: boolean;
  siteUrl: string | null;
}) {
  const [language, setLanguage] = useState<UiLanguage>('en');
  const [extension, setExtension] = useState(false);
  const [state, setState] = useState<State>('checking');
  const [google, setGoogle] = useState(false);
  const [account, setAccount] = useState<Account | null>(null);
  const [websiteAccount, setWebsiteAccount] = useState<Account | null>(null);
  const [workspace, setWorkspace] =
    useState<AuthStatus['workspace']>('unknown');
  const [error, setError] = useState<AuthFailureCode | null>(null);
  const [formError, setFormError] = useState<unknown>(null);
  const [logoutOffline, setLogoutOffline] = useState(false);
  const bridge = useRef<WebExtensionBridge | null>(null);
  const client = useRef<SupabaseClient | null>(null);
  const generation = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const copy = authCopy[language];

  function applyStatus(status: AuthStatus) {
    setAccount(status.account);
    setWorkspace(status.workspace);
    setError(status.error);
    setState(
      status.phase === 'signed_in'
        ? 'complete'
        : status.phase === 'unverified'
          ? 'unverified'
          : 'ready',
    );
  }

  async function verifyWebsite(auth: SupabaseClient, version: number) {
    const { data, error: failure } = await auth.auth.getUser();
    if (version !== generation.current) return;
    if (failure) {
      const kind = webVerificationFailure(failure);
      if (kind === 'unavailable') {
        setError('UNAVAILABLE');
        setState('unverified');
        return;
      }
      if (kind === 'expired') {
        setAccount(null);
        setError('SESSION_EXPIRED');
        setState('ready');
        return;
      }
    }
    if (!data.user) {
      setAccount(null);
      setState('ready');
      return;
    }
    setError(null);
    const current = toAccount(data.user);
    setAccount(current);
    setState('complete');
    try {
      const response = await fetch('/api/auth/access', {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      const result = authAccessResponseSchema.safeParse(await response.json());
      if (version !== generation.current) return;
      if (
        response.ok &&
        result.success &&
        result.data.account.id === current.id
      )
        setWorkspace(result.data.workspace);
      else if (response.status === 401) {
        setError('SESSION_EXPIRED');
        setState('unverified');
      } else setWorkspace('unavailable');
    } catch {
      if (version === generation.current) setWorkspace('unavailable');
    }
  }

  useEffect(() => {
    const version = ++generation.current;
    const params = new URLSearchParams(window.location.search);
    setLanguage(authLanguage(params.get('lang')));
    let connection: WebExtensionBridge | null = null;
    let unsubscribe: (() => void) | undefined;
    let active = true;
    async function initialise() {
      try {
        const attempt = extensionAttempt(params);
        setExtension(Boolean(attempt));
        if (attempt) {
          connection = new WebExtensionBridge(
            attempt,
            browserAuthSender(window),
          );
          bridge.current = connection;
          const hello = await connection.hello();
          if (!active) return;
          setGoogle(hello.google);
          applyStatus(hello.status);
          // Only identify the website account; never copy its session into VSual.
          try {
            const auth = createClient();
            const { data } = await auth.auth.getUser();
            if (active && data.user) setWebsiteAccount(toAccount(data.user));
          } catch {
            /* Website configuration is independent of the extension attempt. */
          }
        } else {
          const auth = createClient();
          client.current = auth;
          setGoogle(googleEnabled && window.location.origin === siteUrl);
          const subscription = auth.auth.onAuthStateChange((event) => {
            if (!active || event === 'INITIAL_SESSION') return;
            const latest = ++generation.current;
            setAccount(null);
            setWorkspace('unknown');
            setState('checking');
            // Keep identity fresh if another website tab changes or refreshes
            // the website session. The extension session is never affected.
            void verifyWebsite(auth, latest).catch(() => {
              if (active && latest === generation.current) {
                setError('UNAVAILABLE');
                setState('unverified');
              }
            });
          });
          unsubscribe = () => subscription.data.subscription.unsubscribe();
          await verifyWebsite(auth, version);
          const callbackError = authFailureCodeSchema.safeParse(
            params.get('status'),
          );
          if (active && callbackError.success) setError(callbackError.data);
        }
      } catch (failure) {
        if (!active) return;
        const code =
          failure instanceof WebAuthError ? failure.code : 'SETUP_REQUIRED';
        setError(code);
        setState(
          params.has('extension') || params.has('attempt')
            ? 'invalid'
            : 'ready',
        );
      }
    }
    void initialise();
    return () => {
      active = false;
      generation.current += 1;
      connection?.dispose();
      unsubscribe?.();
      bridge.current = null;
    };
  }, [googleEnabled, siteUrl]);

  useEffect(() => {
    if (
      state === 'complete' ||
      state === 'cancelled' ||
      state === 'invalid' ||
      state === 'unverified'
    )
      heading.current?.focus();
  }, [state]);

  async function signIn(email: string, password: string) {
    const version = generation.current;
    setState('busy');
    setError(null);
    setFormError(null);
    setLogoutOffline(false);
    try {
      if (extension) {
        if (!bridge.current) throw new WebAuthError('INVALID_ATTEMPT');
        const status = await bridge.current.password(email, password);
        if (version === generation.current) applyStatus(status);
      } else {
        if (!client.current) throw new WebAuthError('SETUP_REQUIRED');
        const result = await client.current.auth.signInWithPassword({
          email,
          password,
        });
        if (version !== generation.current) return;
        if (result.error) {
          setFormError(result.error);
          setState('ready');
        } else await verifyWebsite(client.current, version);
      }
    } catch (failure) {
      if (version !== generation.current) return;
      setError(failure instanceof WebAuthError ? failure.code : 'UNAVAILABLE');
      setState('ready');
    }
  }

  async function signInWithGoogle() {
    const version = generation.current;
    setState('busy');
    setError(null);
    setFormError(null);
    try {
      if (extension) {
        if (!bridge.current) throw new WebAuthError('INVALID_ATTEMPT');
        const status = await bridge.current.action('auth:google');
        if (version === generation.current) applyStatus(status);
      } else {
        if (
          !google ||
          !siteUrl ||
          window.location.origin !== siteUrl ||
          !client.current
        )
          throw new WebAuthError('GOOGLE_UNAVAILABLE');
        const { data, error: failure } =
          await client.current.auth.signInWithOAuth({
            provider: 'google',
            options: {
              redirectTo: `${siteUrl}/auth/callback`,
              skipBrowserRedirect: true,
              queryParams: { prompt: 'select_account' },
            },
          });
        if (failure)
          throw new WebAuthError(
            failure.code === 'provider_disabled'
              ? 'GOOGLE_UNAVAILABLE'
              : 'PROVIDER_ERROR',
          );
        if (!data.url || !data.flowId) throw new WebAuthError('PROVIDER_ERROR');
        if (version !== generation.current) return;
        document.cookie = webOAuthCookie(
          data.flowId,
          language,
          window.location.protocol === 'https:',
        );
        window.location.assign(data.url);
      }
    } catch (failure) {
      if (version !== generation.current) return;
      setError(failure instanceof WebAuthError ? failure.code : 'UNAVAILABLE');
      setState('ready');
    }
  }

  async function cancel() {
    generation.current += 1;
    setState('cancelled');
    setError(null);
    setFormError(null);
    setAccount(null);
    await bridge.current?.cancel();
  }

  async function retry() {
    const version = generation.current;
    setState('checking');
    setError(null);
    try {
      if (extension && bridge.current) {
        const result = await bridge.current.action('auth:status');
        if (version === generation.current) applyStatus(result);
      } else if (client.current) await verifyWebsite(client.current, version);
      else {
        setError('SETUP_REQUIRED');
        setState('ready');
      }
    } catch (failure) {
      if (version === generation.current) {
        setError(
          failure instanceof WebAuthError ? failure.code : 'UNAVAILABLE',
        );
        setState('unverified');
      }
    }
  }

  async function returnToExtension() {
    try {
      await bridge.current?.action('auth:return');
    } catch (failure) {
      setError(failure instanceof WebAuthError ? failure.code : 'UNAVAILABLE');
    }
  }

  async function signOut() {
    generation.current += 1;
    setAccount(null);
    setWorkspace('unknown');
    setState('signing_out');
    setError(null);
    setFormError(null);
    try {
      const result = await client.current?.auth.signOut({ scope: 'local' });
      setLogoutOffline(Boolean(result?.error));
    } catch {
      setLogoutOffline(true);
    } finally {
      setState('ready');
    }
  }

  const notice = error ? authFailureText(error, language) : null;
  return (
    <main lang={language}>
      <p className="eyebrow">VSual</p>
      <h1 ref={heading} tabIndex={-1}>
        {copy.title}
      </h1>
      <label htmlFor="auth-language">{copy.language}</label>
      <select
        id="auth-language"
        value={language}
        onChange={(event) => setLanguage(event.target.value as UiLanguage)}
      >
        <option value="en">English</option>
        <option value="vi">Tiếng Việt</option>
      </select>
      <p>{extension ? copy.extensionIntro : copy.webIntro}</p>
      {extension && (
        <>
          <p>{copy.separate}</p>
          {websiteAccount && (
            <p>
              {copy.websiteAccount}: {websiteAccount.email}
            </p>
          )}
        </>
      )}
      <section aria-labelledby="account-heading">
        <h2 id="account-heading">{copy.account}</h2>
        {state === 'checking' && <p role="status">{copy.checking}</p>}
        {state === 'signing_out' && <p role="status">{copy.signingOut}</p>}
        {account && (
          <p>
            {copy.signedIn}: {account.email}
          </p>
        )}
        {state === 'complete' && (
          <>
            <p role="status">
              {extension ? copy.connected : copy.signedIn}: {account?.email}.{' '}
              {workspace === 'allowed'
                ? copy.allowed
                : workspace === 'denied'
                  ? copy.denied
                  : copy.unavailable}
            </p>
            {workspace === 'unavailable' && (
              <button type="button" onClick={() => void retry()}>
                {copy.retry}
              </button>
            )}
            {extension ? (
              <button type="button" onClick={() => void returnToExtension()}>
                {copy.return}
              </button>
            ) : (
              <>
                <p>{copy.existing}</p>
                <a href="/voice">{copy.webContinue}</a>
                <p>
                  <button type="button" onClick={() => void signOut()}>
                    {copy.signOut}
                  </button>
                </p>
              </>
            )}
          </>
        )}
        {(state === 'ready' || state === 'busy') && (
          <SignInForm
            language={language}
            onSubmit={signIn}
            {...(google ? { onGoogle: signInWithGoogle } : {})}
            googleUnavailable={!google}
            busy={state === 'busy'}
            disabled={!extension && !client.current}
            error={formError ? signInErrorMessage(formError, language) : notice}
          />
        )}
        {state === 'unverified' && (
          <>
            <p role="alert">{notice ?? copy.unavailable}</p>
            <button type="button" onClick={() => void retry()}>
              {copy.retry}
            </button>
            {!extension && client.current && (
              <button type="button" onClick={() => void signOut()}>
                {copy.signOut}
              </button>
            )}
          </>
        )}
        {state === 'cancelled' && <p role="status">{copy.cancelled}</p>}
        {state === 'invalid' && <p role="alert">{notice}</p>}
        {state === 'complete' && notice && <p role="alert">{notice}</p>}
        {extension && !['complete', 'cancelled', 'invalid'].includes(state) && (
          <button type="button" onClick={() => void cancel()}>
            {copy.cancel}
          </button>
        )}
        {extension && <p>{copy.returnHelp}</p>}
        {logoutOffline && <p role="status">{copy.logoutOffline}</p>}
      </section>
    </main>
  );
}

function toAccount(user: User): Account {
  return { id: user.id, email: user.email ?? '' };
}
