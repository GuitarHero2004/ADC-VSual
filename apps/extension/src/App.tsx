import { createVoiceTransport, voiceLabels, VoiceTest } from '@adc/voice-ui';
import '@adc/voice-ui/styles.css';
import type { UiLanguage } from '@adc/contracts';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { getAuthHeaders } from './auth-client.ts';
import { AuthPanel, useExtensionSession } from './auth-panel.tsx';
import { getExtensionConfig } from './config.ts';
import { usePanelActivation } from './use-activation.ts';
import { text } from './i18n.ts';
import { GroundedPanel, type CompanionControls } from './GroundedPanel.tsx';
import {
  FloatingToolbar,
  floatingText,
  useFloatingStatus,
} from './FloatingToolbar.tsx';
import type { FloatingClient } from './floating-client.ts';

const configuration = getExtensionConfig();
const setupTab = new URLSearchParams(location.search).has('microphone-setup');
const logoUrl = new URL('./assets/vsual-logo.png', import.meta.url).href;

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
  floating,
  onControls,
}: {
  userId: string;
  epoch: string;
  language: UiLanguage;
  onReady: (activate: () => void, cancel: () => void) => () => void;
  onExpired: () => void;
  onActivity: () => void;
  settingsTarget: HTMLElement | null;
  floating?: FloatingClient;
  onControls: (controls: CompanionControls | null) => void;
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
    <div onClickCapture={setupTab ? onActivity : undefined}>
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
          onControls={onControls}
          onActivity={onActivity}
          onSpeechOff={() => floating?.stopSpeech()}
          {...(floating
            ? {
                createPage: () => floating.createPage(),
                autoFocus: false,
                continueAnswerAcrossTabs: true,
              }
            : {})}
        />
      )}
    </div>
  );
}

export function App({
  floating,
  onEnd,
}: { floating?: FloatingClient; onEnd?: () => void } = {}) {
  const [language, setLanguage] = useState<UiLanguage>(initialLanguage);
  const [expanded, setExpanded] = useState(!floating);
  const [controls, setControls] = useState<CompanionControls | null>(null);
  const controlsRef = useRef(controls);
  controlsRef.current = controls;
  const [remoteSpeech, setRemoteSpeech] = useState(false);
  const remoteStopButton = useRef<HTMLButtonElement>(null);
  const remoteStopFocus = useRef(false);
  const floatingStatus = useFloatingStatus(floating ? controls : null);
  const launcher =
    !!floating && !expanded && floatingStatus !== 'active' && !remoteSpeech;
  const [opening, setOpening] = useState(0);
  const [fallbackFailed, setFallbackFailed] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const launcherButton = useRef<HTMLButtonElement>(null);
  const collapseFocus = useRef(false);
  const shortcutFocus = useRef(false);
  const previousLauncher = useRef(launcher);
  useLayoutEffect(() => {
    const becameLauncher = !previousLauncher.current && launcher;
    previousLauncher.current = launcher;
    if (collapseFocus.current) {
      collapseFocus.current = false;
      (launcher ? launcherButton : expandButton).current?.focus();
    } else if (
      becameLauncher &&
      document.hasFocus() &&
      (document.activeElement === document.body ||
        document.activeElement?.closest('[hidden]'))
    ) {
      launcherButton.current?.focus();
    }
    if (shortcutFocus.current && !expanded && !launcher) {
      shortcutFocus.current = false;
      document
        .querySelector<HTMLElement>(
          '[data-floating-record]:not(:disabled), [data-floating-cancel]:not(:disabled)',
        )
        ?.focus();
    }
  }, [launcher, expanded]);
  const openCompanion = useCallback(() => {
    setExpanded(true);
    setSettingsOpen(false);
    setOpening((value) => value + 1);
    // Opening is deliberate; checking structure does not capture text or call providers.
    void floating?.preparePage().catch(() => undefined);
  }, [floating]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTarget, setSettingsTarget] = useState<HTMLDivElement | null>(
    null,
  );
  const settingsButton = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (remoteSpeech || !remoteStopFocus.current) return;
    remoteStopFocus.current = false;
    (expanded ? settingsButton : launcherButton).current?.focus();
  }, [remoteSpeech, expanded]);
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
    floating?.claim();
  }, [floating]);
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
    !setupTab && !floating,
  );
  const floatingReady = !session.loading && (!session.allowed || voiceReady);
  const allowedRef = useRef(session.allowed);
  allowedRef.current = session.allowed;
  useEffect(() => {
    if (!floating || !floatingReady) return;
    const stop = floating.subscribe((event) => {
      if (event.type === 'cancel') cancelVoice.current();
      if (event.type === 'speech-stop') {
        controlsRef.current?.controller.discardAutomaticSpeech();
        controlsRef.current?.speech.stopPlayback();
      }
      if (event.type === 'speech-status') {
        if (!event.other && document.activeElement === remoteStopButton.current)
          remoteStopFocus.current = true;
        setRemoteSpeech(event.active && event.other);
        return;
      }
      if (event.type === 'resume') {
        // Follow the active source without focusing, recording or submitting.
        setExpanded(event.expanded);
        return;
      }
      if (event.type !== 'activate') return;
      if (!event.record || !allowedRef.current) openCompanion();
      if (event.record) {
        shortcutFocus.current = true;
        activate.current();
      }
    });
    floating.ready();
    return stop;
  }, [floating, floatingReady, openCompanion]);
  useEffect(() => {
    if (!floating || !controls) return;
    const report = () =>
      floating.reportSpeech(
        ['generating', 'speaking'].includes(
          controls.speech.getSnapshot().phase,
        ),
      );
    const stop = controls.speech.subscribe(report);
    report();
    return () => {
      stop();
      floating.reportSpeech(false);
    };
  }, [floating, controls]);
  useEffect(() => {
    if (!floating || !panel.current) return;
    const resize = () => {
      const launcherSize = Math.max(
        64,
        Math.ceil(
          parseFloat(getComputedStyle(document.documentElement).fontSize) * 4,
        ),
      );
      floating.layout(
        expanded,
        launcher
          ? launcherSize
          : Math.ceil((panel.current?.getBoundingClientRect().height ?? 0) + 4),
        launcher,
        // Use the same dimension for both axes, including browser pixel rounding.
        launcher ? launcherSize : undefined,
      );
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(panel.current);
    return () => observer.disconnect();
  }, [floating, expanded, launcher]);
  const lastOpening = useRef(0);
  useEffect(() => {
    if (
      !floating ||
      !expanded ||
      !opening ||
      !floatingReady ||
      lastOpening.current === opening
    )
      return;
    lastOpening.current = opening;
    const target = session.allowed
      ? document.querySelector<HTMLElement>('#companion-content textarea')
      : signInButton.current;
    (target ?? expandButton.current)?.focus();
  }, [floating, expanded, opening, floatingReady, session.allowed]);
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
            'Đăng nhập, rồi kích hoạt VSual từ thanh công cụ trên bài viết hoặc trang đơn hàng mẫu. Bạn có thể nhập hoặc ghi âm câu hỏi.',
          stop: 'Hủy thao tác hiện tại',
          demo: 'Mở bảng đơn hàng mẫu',
        }
      : {
          settings: 'Settings',
          back: 'Back to companion',
          companion: 'Browser companion',
          welcome: 'Get started with VSual',
          guidance:
            'Sign in, then activate VSual from the browser toolbar on an article or the sample orders page. You can type or record a question.',
          stop: 'Cancel current operation',
          demo: 'Open sample orders',
        };
  const f = floatingText[language];
  const launcherState =
    session.loading || (session.allowed && !controls)
      ? f.checking
      : !session.allowed
        ? session.status?.account
          ? f.access
          : f.signIn
        : floatingStatus === 'active'
          ? f.ready
          : f[floatingStatus];
  return (
    <div
      ref={panel}
      className={`panel${floating ? ' floating-panel' : ''}${launcher ? ' floating-launcher-panel' : ''}`}
    >
      {floating && (
        <div className="floating-launcher" hidden={!launcher}>
          <button
            id="floating-launcher"
            ref={launcherButton}
            type="button"
            aria-label={f.open}
            aria-expanded={false}
            aria-controls="floating-expanded"
            aria-describedby="floating-launcher-state"
            title={`${f.open} — ${launcherState}`}
            onClick={openCompanion}
          >
            <img src={logoUrl} alt="" className="vsual-logo" />
            <span id="floating-launcher-state" className="voice-sr-only">
              {launcherState}
            </span>
          </button>
          <span className="voice-sr-only" role="status" aria-atomic="true">
            {launcherState}
          </span>
        </div>
      )}
      <header className="panel-header" hidden={launcher}>
        <div className="companion-brand">
          {floating && (
            <span className="companion-mark" aria-hidden="true">
              <img src={logoUrl} alt="" className="vsual-logo" />
            </span>
          )}
          <div>
            <h1>VSual</h1>
            {(!floating || expanded) && (
              <p className="eyebrow">{setupTab ? t.label : ui.companion}</p>
            )}
          </div>
        </div>
        {floating && (
          <div className="controls floating-window-controls">
            <button
              ref={expandButton}
              type="button"
              aria-expanded={expanded}
              aria-label={expanded ? f.collapse : f.expand}
              aria-controls="floating-expanded"
              onClick={() => {
                if (!expanded) openCompanion();
                else {
                  collapseFocus.current = true;
                  setExpanded(false);
                  setSettingsOpen(false);
                }
              }}
            >
              {expanded ? f.collapseShort : f.expandShort}
            </button>
            <button
              type="button"
              aria-label={f.end}
              onClick={() => {
                cancelVoice.current();
                onEnd?.();
              }}
            >
              {f.endShort}
            </button>
          </div>
        )}
        <button
          hidden={!!floating && !expanded}
          ref={settingsButton}
          className="companion-settings-button"
          type="button"
          aria-expanded={settingsOpen}
          aria-controls="companion-settings"
          onClick={settingsOpen ? closeSettings : openSettings}
        >
          {ui.settings}
        </button>
      </header>
      {floating && (
        <div className="notice" hidden={!remoteSpeech}>
          <p role="status" aria-atomic="true">
            {remoteSpeech
              ? language === 'vi'
                ? 'Đang đọc câu trả lời từ thẻ khác. Câu hỏi mới sẽ dùng trang hiện tại.'
                : 'Reading an answer from another tab. New questions use this page.'
              : ''}
          </p>
          <button
            type="button"
            ref={remoteStopButton}
            onClick={() => floating.stopSpeech()}
          >
            {language === 'vi'
              ? 'Dừng giọng đọc ở thẻ khác'
              : 'Stop speech in other tab'}
          </button>
        </div>
      )}
      {floating && (
        <div hidden={expanded || launcher}>
          {session.allowed && controls ? (
            <FloatingToolbar
              controls={controls}
              language={language}
              onExpand={openCompanion}
              onActivity={claimVoiceSurface}
            />
          ) : (
            <div className="floating-toolbar">
              <p role="status" aria-atomic="true">
                {session.loading ? f.checking : f.unavailable}
              </p>
              <button type="button" onClick={openCompanion}>
                {f.ask}
              </button>
              <button type="button" disabled>
                {voiceLabels(language).start}
              </button>
            </div>
          )}
        </div>
      )}
      <main id="floating-expanded" hidden={!!floating && !expanded}>
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
            {floating && (
              <>
                <p>{f.fallback}</p>
                <button
                  type="button"
                  onClick={() => {
                    cancelVoice.current();
                    void floating
                      .openSidePanel()
                      .then((opened) => setFallbackFailed(!opened));
                  }}
                >
                  {f.sidePanel}
                </button>
                <p role="status">{fallbackFailed ? f.sidePanelFailed : ''}</p>
              </>
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
              inline={!!floating}
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
              onControls={setControls}
              {...(floating ? { floating } : {})}
            />
          ) : null}
        </div>
      </main>
    </div>
  );
}
