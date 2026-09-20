import { createVoiceTransport, VoiceTest } from '@adc/voice-ui';
import '@adc/voice-ui/styles.css';
import type { UiLanguage } from '@adc/contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getAuthHeaders } from './auth-client.ts';
import { AuthPanel, useExtensionSession } from './auth-panel.tsx';
import { getExtensionConfig } from './config.ts';
import { usePanelActivation } from './use-activation.ts';
import { text } from './i18n.ts';
import { GroundedPanel } from './GroundedPanel.tsx';

const configuration = getExtensionConfig();
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
  userId,
  epoch,
  language,
  onReady,
  onExpired,
  onActivity,
}: {
  userId: string;
  epoch: string;
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
  const requestOptions = useMemo(
    () => ({
      baseUrl: configuration!.backend,
      async getHeaders() {
        if (!alive.current)
          throw new DOMException('Session changed', 'AbortError');
        const headers = await getAuthHeaders(userId, epoch);
        if (!alive.current)
          throw new DOMException('Session changed', 'AbortError');
        return headers;
      },
      onUnauthenticated() {
        if (alive.current) onExpired();
      },
    }),
    [userId, epoch, onExpired],
  );
  const transport = useMemo(
    () => createVoiceTransport(requestOptions),
    [requestOptions],
  );
  return (
    <div onClickCapture={onActivity}>
      {setupTab ? (
        <VoiceTest
          sessionKey={`${userId}:${epoch}`}
          transport={transport}
          uiLanguage={language}
          onReady={onReady}
          preferencesKey="voice:extension-preferences"
        />
      ) : (
        <GroundedPanel
          sessionKey={`${userId}:${epoch}`}
          language={language}
          voiceTransport={transport}
          backend={configuration!.backend}
          getHeaders={requestOptions.getHeaders}
          onExpired={onExpired}
          onReady={onReady}
        />
      )}
    </div>
  );
}

export function App() {
  const [language, setLanguage] = useState<UiLanguage>(initialLanguage);
  const t = text[language];
  const [status, setStatus] = useState('');
  const [shortcut, setShortcut] = useState<string | null>(null);
  const [shortcutFailed, setShortcutFailed] = useState(false);
  const [voiceReady, setVoiceReady] = useState(false);
  const activityChannel = useRef<BroadcastChannel | null>(null);
  const cancelVoice = useRef<() => void>(() => {});
  const signInButton = useRef<HTMLButtonElement>(null);
  const clearWork = useCallback(() => {
    cancelVoice.current();
    activityChannel.current?.postMessage('claim');
  }, []);
  const session = useExtensionSession(!!configuration, clearWork);
  useEffect(() => {
    if (session.status?.account) setStatus('');
  }, [session.status?.account?.id]);
  const guestActivation = useRef(() => {});
  guestActivation.current = () => {
    setStatus(
      configuration ? text[language].signinFirst : text[language].setup,
    );
    signInButton.current?.focus();
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
  usePanelActivation(
    activate,
    !session.loading && (!session.allowed || voiceReady),
    !setupTab,
  );
  useEffect(() => {
    if (session.status?.phase !== 'signing_in') return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        if (session.status)
          void session.run({
            type: 'auth:cancel',
            epoch: session.status.epoch,
          });
      }
    };
    document.addEventListener('keydown', cancel);
    return () => document.removeEventListener('keydown', cancel);
  }, [session.status?.phase, session.status?.epoch, session.run]);

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

  const expireSession = useCallback(() => {
    clearWork();
    // Re-verify centrally. A transient network error must not erase credentials.
    void session.run({ type: 'auth:status' });
  }, [clearWork, session.run]);

  return (
    <div className="panel">
      <header>
        <p className="eyebrow">
          {setupTab
            ? t.label
            : language === 'vi'
              ? 'Trợ lý đọc bảng đơn hàng'
              : 'Orders reading companion'}
        </p>
        <h1>VSual</h1>
        <p>
          {setupTab
            ? t.description
            : language === 'vi'
              ? 'Hỏi về số đơn hoàn thành trên bảng mẫu và kiểm tra dữ liệu nguồn.'
              : 'Ask about completed orders on the demo dashboard and inspect the source evidence.'}
        </p>
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
        {configuration ? (
          <AuthPanel
            session={session}
            language={language}
            signInRef={signInButton}
          />
        ) : (
          <p role="alert">{t.setup}</p>
        )}
        <p role="status" aria-atomic="true">
          {status}
        </p>
        {session.allowed && session.status?.account ? (
          <SignedInVoice
            key={`${session.status.account.id}:${session.status.epoch}`}
            userId={session.status.account.id}
            epoch={session.status.epoch}
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
