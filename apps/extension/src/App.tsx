import {
  createVoiceTransport,
  signInErrorMessage,
  VoiceTest,
} from '@adc/voice-ui';
import '@adc/voice-ui/styles.css';
import type { UiLanguage } from '@adc/contracts';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import {
  beginExtensionSignIn,
  blockExtensionSession,
  clearExtensionSession,
  createExtensionAuth,
  isExtensionSignedOut,
} from './auth.ts';
import { getExtensionConfig } from './config.ts';
import { usePanelActivation } from './use-activation.ts';
import { text } from './i18n.ts';

const configuration = getExtensionConfig();
const auth = configuration ? createExtensionAuth(configuration) : null;
const setupTab = new URLSearchParams(location.search).has('microphone-setup');

function initialLanguage(): UiLanguage {
  try {
    return localStorage.getItem('voice:interface-language') === 'vi'
      ? 'vi'
      : 'en';
  } catch {
    return 'en';
  }
}

function SignedInVoice({
  client,
  session,
  language,
  onReady,
  onExpired,
  onActivity,
}: {
  client: SupabaseClient;
  session: Session;
  language: UiLanguage;
  onReady: (activate: () => void, cancel: () => void) => () => void;
  onExpired: () => void;
  onActivity: () => void;
}) {
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const transport = useMemo(
    () =>
      createVoiceTransport({
        baseUrl: configuration!.backend,
        async getHeaders() {
          const { data, error } = await client.auth.getSession();
          if (
            error ||
            !data.session ||
            isExtensionSignedOut() ||
            data.session.user.id !== session.user.id ||
            !alive.current
          ) {
            if (alive.current) onExpired();
            throw Object.assign(new Error('Sign in again to continue.'), {
              code: 'UNAUTHENTICATED',
            });
          }
          return { Authorization: `Bearer ${data.session.access_token}` };
        },
        onUnauthenticated() {
          if (alive.current) onExpired();
        },
      }),
    [client, session.user.id, onExpired],
  );
  return (
    <div onClickCapture={onActivity}>
      <VoiceTest
        sessionKey={session.user.id}
        transport={transport}
        uiLanguage={language}
        onReady={onReady}
        preferencesKey="voice:extension-preferences"
      />
    </div>
  );
}

export function App() {
  const [language, setLanguage] = useState<UiLanguage>(initialLanguage);
  const t = text[language];
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(!!auth);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('');
  const [shortcut, setShortcut] = useState<string | null>(null);
  const [shortcutFailed, setShortcutFailed] = useState(false);
  const [voiceReady, setVoiceReady] = useState(false);
  const restoreSignInFocus = useRef(false);
  const activityChannel = useRef<BroadcastChannel | null>(null);
  const cancelVoice = useRef<() => void>(() => {});
  const emailInput = useRef<HTMLInputElement>(null);
  const guestActivation = useRef(() => {});
  guestActivation.current = () => {
    setStatus(
      configuration ? text[language].signinFirst : text[language].setup,
    );
    emailInput.current?.focus();
  };
  const activate = useRef<() => void>(() => guestActivation.current());
  const claimVoiceSurface = useCallback(() => {
    activityChannel.current?.postMessage('claim');
  }, []);
  const onReady = useCallback((handler: () => void, cancel: () => void) => {
    activate.current = () => {
      activityChannel.current?.postMessage('claim');
      handler();
    };
    cancelVoice.current = cancel;
    setVoiceReady(true);
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        cancel();
      }
    };
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('keydown', escape);
      activate.current = () => guestActivation.current();
      cancelVoice.current = () => {};
      setVoiceReady(false);
    };
  }, []);
  usePanelActivation(activate, !loading && (!session || voiceReady), !setupTab);

  useEffect(() => {
    const channel = new BroadcastChannel('adc:voice:surface');
    activityChannel.current = channel;
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (event.data === 'claim') cancelVoice.current();
    };
    return () => {
      activityChannel.current = null;
      channel.close();
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
    try {
      localStorage.setItem('voice:interface-language', language);
    } catch {
      /* Preferences are optional. */
    }
  }, [language]);
  useEffect(() => {
    let active = true;
    const refreshShortcut = () => {
      void chrome.commands
        .getAll()
        .then((commands) => {
          if (!active) return;
          setShortcut(
            commands.find((command) => command.name === 'toggle-voice')
              ?.shortcut || '',
          );
          setShortcutFailed(false);
        })
        .catch(() => {
          if (active) setShortcutFailed(true);
        });
    };
    const visible = () => {
      if (!document.hidden) refreshShortcut();
    };
    refreshShortcut();
    window.addEventListener('focus', refreshShortcut);
    document.addEventListener('visibilitychange', visible);
    return () => {
      active = false;
      window.removeEventListener('focus', refreshShortcut);
      document.removeEventListener('visibilitychange', visible);
    };
  }, []);

  useEffect(() => {
    if (!session && restoreSignInFocus.current) {
      emailInput.current?.focus();
      restoreSignInFocus.current = false;
    }
  }, [session]);
  useEffect(() => {
    if (!auth) return;
    let active = true;
    let authEvent = false;
    const { data: subscription } = auth.auth.onAuthStateChange(
      (event, nextSession) => {
        if (active) {
          authEvent = true;
          if (event === 'SIGNED_OUT') blockExtensionSession();
          setSession(isExtensionSignedOut() ? null : nextSession);
          setLoading(false);
        }
      },
    );
    const storageChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (
        active &&
        area === 'session' &&
        changes['adc:auth:session'] &&
        changes['adc:auth:session'].newValue === undefined
      ) {
        authEvent = true;
        blockExtensionSession();
        void auth.auth.stopAutoRefresh().catch(() => undefined);
        cancelVoice.current();
        setSession(null);
      }
    };
    chrome.storage.onChanged.addListener(storageChanged);
    void auth.auth
      .getSession()
      .then(({ data, error }) => {
        if (active && !authEvent) {
          setSession(error || isExtensionSignedOut() ? null : data.session);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      chrome.storage.onChanged.removeListener(storageChanged);
      subscription.subscription.unsubscribe();
    };
  }, []);

  const expireSession = useCallback(() => {
    restoreSignInFocus.current = true;
    cancelVoice.current();
    setSession(null);
    setStatus(text[language].expired);
    if (auth) void clearExtensionSession(auth).catch(() => undefined);
  }, [language]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth || busy) return;
    setBusy(true);
    setStatus('');
    try {
      await beginExtensionSignIn();
      const { data, error } = await auth.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error || !data.session || isExtensionSignedOut())
        setStatus(signInErrorMessage(error, language));
      else {
        await auth.auth.startAutoRefresh();
        setSession(data.session);
        setPassword('');
      }
    } catch (error: unknown) {
      setStatus(signInErrorMessage(error, language));
    } finally {
      setBusy(false);
    }
  }

  function signOut() {
    restoreSignInFocus.current = true;
    cancelVoice.current();
    setSession(null);
    setStatus(t.signedout);
    setPassword('');
    if (auth) void clearExtensionSession(auth).catch(() => undefined);
  }

  return (
    <div className="panel">
      <header>
        <p className="eyebrow">{t.label}</p>
        <h1>Browser Accessibility Agent</h1>
        <p>{t.description}</p>
        <label htmlFor="interface-language">{t.uiLanguage}</label>
        <select
          id="interface-language"
          value={language}
          onChange={(event) =>
            setLanguage(event.target.value === 'vi' ? 'vi' : 'en')
          }
        >
          <option value="en">English</option>
          <option value="vi">Tiếng Việt</option>
        </select>
      </header>
      <main>
        <section aria-labelledby="shortcut-heading">
          <h2 id="shortcut-heading">{t.shortcut}</h2>
          <p>
            {shortcutFailed
              ? t.shortcutFailed
              : shortcut === null
                ? t.shortcutLoading
                : shortcut || t.unassigned}
          </p>
          <details>
            <summary>{t.changeShortcut}</summary>
            <p>{t.shortcutHelp}</p>
            <button
              type="button"
              onClick={() => {
                void chrome.tabs.create({
                  url: navigator.userAgent.includes('Edg/')
                    ? 'edge://extensions/shortcuts'
                    : 'chrome://extensions/shortcuts',
                });
              }}
            >
              {t.changeShortcut}
            </button>
            <p className="field-help">{t.shortcutLocation}</p>
          </details>
        </section>
        <section aria-labelledby="session-heading">
          <h2 id="session-heading">{t.session}</h2>
          {!configuration ? (
            <p role="alert">{t.setup}</p>
          ) : loading ? (
            <p role="status">{t.loading}</p>
          ) : session ? (
            <>
              <p>
                {t.signedin} {session.user.email}
              </p>
              <button type="button" onClick={signOut}>
                {t.signout}
              </button>
            </>
          ) : (
            <form
              onSubmit={(event) => {
                void signIn(event);
              }}
            >
              <p>{t.signinHelp}</p>
              <label htmlFor="email">{t.email}</label>
              <input
                ref={emailInput}
                id="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={busy}
              />
              <label htmlFor="password">{t.password}</label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={busy}
              />
              <button type="submit" disabled={busy}>
                {busy ? t.signingIn : t.signin}
              </button>
            </form>
          )}
          <p role="status" aria-atomic="true" className="status">
            {status}
          </p>
        </section>
        {session && auth ? (
          <SignedInVoice
            key={session.user.id}
            client={auth}
            session={session}
            language={language}
            onReady={onReady}
            onExpired={expireSession}
            onActivity={claimVoiceSurface}
          />
        ) : null}
        <section aria-labelledby="microphone-heading">
          <h2 id="microphone-heading">{t.microphone}</h2>
          <p>{setupTab ? t.tabHelp : t.microphoneHelp}</p>
          {!setupTab ? (
            <button
              type="button"
              onClick={() => {
                void chrome.tabs.create({
                  url: chrome.runtime.getURL('index.html?microphone-setup=1'),
                });
              }}
            >
              {t.openSetup}
            </button>
          ) : null}
        </section>
      </main>
    </div>
  );
}
