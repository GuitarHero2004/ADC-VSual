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
  settingsTarget,
}: {
  userId: string;
  epoch: string;
  language: UiLanguage;
  onReady: (activate: () => void, cancel: () => void) => () => void;
  onExpired: () => void;
  onActivity: () => void;
  settingsTarget: HTMLElement | null;
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
          preferencesTarget={settingsTarget}
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
          settingsTarget={settingsTarget}
        />
      )}
    </div>
  );
}

export function App() {
  const [language, setLanguage] = useState<UiLanguage>(initialLanguage);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTarget, setSettingsTarget] = useState<HTMLDivElement | null>(
    null,
  );
  const settingsButton = useRef<HTMLButtonElement>(null);
  const settingsHeading = useRef<HTMLHeadingElement>(null);
  const settingsNavigation = useRef(false);
  const activationFocus = useRef(false);
  const recoveryFocus = useRef(false);
  const openSettings = useCallback(() => {
    settingsNavigation.current = true;
    setSettingsOpen(true);
  }, []);
  const closeSettings = useCallback(() => {
    settingsNavigation.current = true;
    setSettingsOpen(false);
  }, []);
  useEffect(() => {
    if (!settingsOpen && recoveryFocus.current) {
      recoveryFocus.current = false;
      document
        .querySelector<HTMLElement>(
          '#companion-content .account-setup h2, #companion-content .account-summary summary',
        )
        ?.focus();
      return;
    }
    if (!settingsOpen && activationFocus.current) {
      activationFocus.current = false;
      const control =
        document.querySelector<HTMLElement>(
          '#companion-content .voice-controls button:not(:disabled)',
        ) ?? signInButton.current;
      control?.focus();
      return;
    }
    if (!settingsNavigation.current) return;
    settingsNavigation.current = false;
    (settingsOpen ? settingsHeading : settingsButton).current?.focus();
  }, [settingsOpen]);
  useEffect(() => {
    if (!settingsOpen) return;
    const back = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      closeSettings();
    };
    document.addEventListener('keydown', back, true);
    return () => document.removeEventListener('keydown', back, true);
  }, [settingsOpen, closeSettings]);
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
  const previouslyAllowed = useRef(false);
  useEffect(() => {
    const lostAccess = previouslyAllowed.current && !session.allowed;
    previouslyAllowed.current = session.allowed;
    if (!lostAccess || !settingsOpen) return;
    // Session controls disappear on expiry or temporary verification failure.
    // Reveal account recovery before focusing it on the following DOM update.
    recoveryFocus.current = true;
    activationFocus.current = false;
    settingsNavigation.current = false;
    setSettingsOpen(false);
  }, [session.allowed, settingsOpen]);
  useEffect(() => {
    if (session.status?.account) setStatus('');
  }, [session.status?.account?.id]);
  const guestActivation = useRef(() => {});
  guestActivation.current = () => {
    activationFocus.current = !!document.activeElement?.closest(
      '#companion-settings',
    );
    setSettingsOpen(false);
    setStatus(
      configuration ? text[language].signinFirst : text[language].setup,
    );
    if (!activationFocus.current) signInButton.current?.focus();
  };
  const activate = useRef<() => void>(() => guestActivation.current());
  const claimVoiceSurface = useCallback(() => {
    activityChannel.current?.postMessage('claim');
  }, []);
  const onReady = useCallback((handler: () => void, cancel: () => void) => {
    activate.current = () => {
      activationFocus.current = !!document.activeElement?.closest(
        '#companion-settings',
      );
      setSettingsOpen(false);
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

  const ui =
    language === 'vi'
      ? {
          settings: 'Cài đặt',
          back: 'Quay lại trợ lý',
          companion: 'Trợ lý trình duyệt',
          welcome: 'Bắt đầu với VSual',
          guidance:
            'Đăng nhập rồi mở bảng đơn hàng mẫu. Bạn có thể nhập hoặc ghi âm câu hỏi.',
          stop: 'Hủy thao tác hiện tại',
          demo: 'Mở bảng đơn hàng mẫu',
        }
      : {
          settings: 'Settings',
          back: 'Back to companion',
          companion: 'Browser companion',
          welcome: 'Get started with VSual',
          guidance:
            'Sign in, then open sample orders. You can type or record a question.',
          stop: 'Cancel current operation',
          demo: 'Open sample orders',
        };
  return (
    <div className="panel">
      <header className="panel-header">
        <div>
          <h1>VSual</h1>
          <p className="eyebrow">{setupTab ? t.label : ui.companion}</p>
        </div>
        <button
          ref={settingsButton}
          type="button"
          aria-expanded={settingsOpen}
          aria-controls="companion-settings"
          onClick={settingsOpen ? closeSettings : openSettings}
        >
          {ui.settings}
        </button>
      </header>
      <main>
        <section
          id="companion-settings"
          hidden={!settingsOpen}
          aria-labelledby="settings-heading"
        >
          <h2 id="settings-heading" ref={settingsHeading} tabIndex={-1}>
            {ui.settings}
          </h2>
          <button type="button" onClick={closeSettings}>
            {ui.back}
          </button>
          <label htmlFor="interface-language">{t.uiLanguage}</label>
          <select
            id="interface-language"
            value={language}
            onChange={(event) =>
              setLanguage(event.target.value === 'vi' ? 'vi' : 'en')
            }
          >
            <option value="en" lang="en">
              English
            </option>
            <option value="vi" lang="vi">
              Tiếng Việt
            </option>
          </select>
          <div ref={setSettingsTarget} />
          {session.allowed && (
            <button type="button" onClick={() => cancelVoice.current()}>
              {ui.stop}
            </button>
          )}
          <section aria-labelledby="shortcut-heading">
            <h3 id="shortcut-heading">{t.shortcut}</h3>
            <p>
              {shortcutFailed
                ? t.shortcutFailed
                : shortcut === null
                  ? t.shortcutLoading
                  : shortcut || t.unassigned}
            </p>
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
            <details>
              <summary>{t.shortcutHelpLabel}</summary>
              <p className="field-help">{t.shortcutLocation}</p>
            </details>
          </section>
          <section aria-labelledby="microphone-heading">
            <h3 id="microphone-heading">{t.microphone}</h3>
            <p>{setupTab ? t.tabHelp : t.microphoneHelp}</p>
            {!setupTab && (
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
            )}
          </section>
        </section>
        <div hidden={settingsOpen} id="companion-content">
          {configuration ? (
            <AuthPanel
              session={session}
              language={language}
              signInRef={signInButton}
              compact={session.allowed}
            />
          ) : (
            <p role="alert">{t.setup}</p>
          )}
          {!session.loading && !session.allowed && (
            <section aria-labelledby="welcome-heading">
              <h2 id="welcome-heading">{ui.welcome}</h2>
              <p>{ui.guidance}</p>
              {configuration && (
                <a
                  href={`${configuration.backend}/orders`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {ui.demo}
                </a>
              )}
            </section>
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
              settingsTarget={settingsTarget}
            />
          ) : null}
        </div>
      </main>
    </div>
  );
}
