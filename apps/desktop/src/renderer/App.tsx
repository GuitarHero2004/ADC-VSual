import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
  DESKTOP_SHORTCUTS,
  DESKTOP_STOP_SHORTCUT,
  type DesktopBridge,
  type DesktopPreferences,
  type DesktopShortcut,
  type DesktopState,
} from '../bridge.ts';
import logo from '../../../extension/src/assets/vsual-logo.png';
import { DesktopAssistant } from './Assistant.tsx';
import type { AssistantDependencies } from './assistant-controller.ts';
import type { DesktopSessionState } from '../session-types.ts';
import { DesktopGuide } from './Guide.tsx';
import {
  DesktopGuideController,
  guideSpeechText,
  localGuideDependencies,
  type GuideDependencies,
} from './guide.ts';

const copy = {
  en: {
    foundation: 'Desktop assistant',
    guide: 'Instructions and hotkeys',
    limitation: 'Ask about one selected window using a screenshot.',
    stopShortcutUnavailable:
      'The Stop shortcut is unavailable. Use the Stop controls in VSual, or Escape to hide and stop.',
    shortcutUnavailable:
      'The requested shortcut is unavailable. Choose another shortcut and save, or open VSual from the system tray.',
    notStored:
      'Settings could not be saved on this device. Try Save settings again.',
    hide: 'Hide to tray',
    quit: 'Quit VSual',
    trayHelp:
      'Hiding keeps VSual running in the system tray. The shortcut or tray icon brings it back. Escape also hides this window.',
    settings: 'Settings',
    settingsHelp:
      'Choose your language and shortcut, then save on this device.',
    language: 'Language',
    shortcutLabel: 'Keyboard shortcut',
    shortcutHelp:
      'From another app, the shortcut opens VSual and starts listening when signed in and ready. While recording it stops for review; while processing it cancels; during answer playback it stops speech and starts listening.',
    save: 'Save settings',
    saving: 'Saving settings…',
    saved: 'Settings saved.',
    unsaved: 'You have changes to save.',
    loading: 'Loading desktop settings…',
    loadFailed: 'Could not load desktop settings. Try again.',
    saveFailed: 'Could not update settings. Try Save settings again.',
    hideFailed: 'Could not hide this window. Try Hide to tray again.',
    quitFailed: 'Could not quit VSual. Try Quit VSual again.',
    retry: 'Try again',
  },
  vi: {
    foundation: 'Trợ lý máy tính',
    guide: 'Hướng dẫn và phím tắt',
    limitation: 'Hỏi về một cửa sổ đã chọn thông qua ảnh chụp màn hình.',
    stopShortcutUnavailable:
      'Không dùng được phím tắt Dừng. Dùng các nút Dừng trong VSual hoặc Escape để ẩn và dừng.',
    shortcutUnavailable:
      'Không thể sử dụng phím tắt đã chọn. Hãy chọn phím tắt khác rồi lưu, hoặc mở VSual từ khay hệ thống.',
    notStored:
      'Không thể lưu cài đặt trên thiết bị này. Hãy thử Lưu cài đặt lần nữa.',
    hide: 'Ẩn xuống khay hệ thống',
    quit: 'Thoát VSual',
    trayHelp:
      'Khi ẩn, VSual vẫn chạy trong khay hệ thống. Dùng phím tắt hoặc biểu tượng ở khay để mở lại. Phím Escape cũng ẩn cửa sổ này.',
    settings: 'Cài đặt',
    settingsHelp: 'Chọn ngôn ngữ và phím tắt, rồi lưu trên thiết bị này.',
    language: 'Ngôn ngữ',
    shortcutLabel: 'Phím tắt bàn phím',
    shortcutHelp:
      'Từ ứng dụng khác, phím tắt mở VSual và bắt đầu nghe khi đã đăng nhập và sẵn sàng. Khi đang ghi âm, phím tắt dừng để xem lại; khi đang xử lý, phím tắt hủy; khi đang đọc câu trả lời, phím tắt dừng phát và bắt đầu nghe.',
    save: 'Lưu cài đặt',
    saving: 'Đang lưu cài đặt…',
    saved: 'Đã lưu cài đặt.',
    unsaved: 'Bạn có thay đổi chưa lưu.',
    loading: 'Đang tải cài đặt ứng dụng…',
    loadFailed: 'Không thể tải cài đặt ứng dụng. Hãy thử lại.',
    saveFailed: 'Không thể cập nhật cài đặt. Hãy thử Lưu cài đặt lần nữa.',
    hideFailed:
      'Không thể ẩn cửa sổ này. Hãy thử Ẩn xuống khay hệ thống lần nữa.',
    quitFailed: 'Không thể thoát VSual. Hãy thử Thoát VSual lần nữa.',
    retry: 'Thử lại',
  },
} as const;

type ActionMessage =
  'saved' | 'saveFailed' | 'hideFailed' | 'quitFailed' | null;

function samePreferences(
  first: DesktopPreferences,
  second: DesktopPreferences,
) {
  return (
    first.language === second.language && first.shortcut === second.shortcut
  );
}

function shortcutText(
  shortcut: DesktopShortcut | typeof DESKTOP_STOP_SHORTCUT,
) {
  return shortcut.replace('Control', 'Ctrl').replaceAll('+', ' + ');
}

export function App({
  bridge = window.vsualDesktop,
  assistantDependencies,
  guideDependencies,
}: {
  bridge?: DesktopBridge;
  assistantDependencies?: AssistantDependencies;
  guideDependencies?: GuideDependencies;
}) {
  const [guide] = useState(
    () =>
      new DesktopGuideController(
        bridge,
        guideDependencies ?? localGuideDependencies(),
      ),
  );
  const stopAssistant = useRef<(() => void) | null>(null);
  const registerStopWork = useCallback((stop: (() => void) | null) => {
    stopAssistant.current = stop;
  }, []);
  const stopGuide = useCallback(() => guide.beforeWork(), [guide]);
  const [narrationReady, setNarrationReady] = useState(false);
  const acceptSession = useCallback(
    (session: DesktopSessionState | null) => {
      guide.setSession(session);
      setNarrationReady(!!session?.account && session.phase === 'signed_in');
    },
    [guide],
  );
  const [state, setState] = useState<DesktopState | null>(null);
  const [draft, setDraft] = useState<DesktopPreferences | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [opened, setOpened] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<ActionMessage>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(false);
  const stateRef = useRef<DesktopState | null>(null);
  const savingRef = useRef(false);
  const text = copy[draft?.language ?? state?.preferences.language ?? 'en'];
  const dirty =
    !!state && !!draft && !samePreferences(state.preferences, draft);

  const acceptState = useCallback(
    (next: DesktopState, replaceDraft = false) => {
      const previous = stateRef.current;
      stateRef.current = next;
      setState(next);
      setDraft((current) =>
        replaceDraft ||
        !current ||
        (previous && samePreferences(current, previous.preferences))
          ? next.preferences
          : current,
      );
    },
    [],
  );

  useEffect(() => {
    mounted.current = true;
    if (document.activeElement === document.body) heading.current?.focus();
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang =
      draft?.language ?? state?.preferences.language ?? 'en';
  }, [draft?.language, state?.preferences.language]);

  useEffect(() => {
    const remove = bridge.onSuspend(() => {
      setOpened(false);
      guide.interrupt();
    });
    return () => {
      remove();
      guide.clear();
    };
  }, [bridge, guide]);

  useEffect(() => {
    if (!state || loading || loadFailed || !opened || !narrationReady) return;
    void guide.automatic(
      guideSpeechText(
        state.preferences.language,
        state.preferences.shortcut,
        DESKTOP_STOP_SHORTCUT,
        state.stopShortcutRegistered,
        state.shortcutRegistered,
      ),
      state.preferences.language,
    );
  }, [guide, state, loading, loadFailed, opened, narrationReady]);

  useEffect(() => {
    let active = true;
    let receivedEvent = false;
    setLoading(true);
    setLoadFailed(false);
    const removeStateListener = bridge.onState((next) => {
      if (!active) return;
      receivedEvent = true;
      acceptState(next);
      setMessage(null);
      setLoading(false);
      setLoadFailed(false);
    });
    const removeActivationListener = bridge.onActivate((activation) => {
      if (activation.kind === 'talk') guide.beforeWork();
      if (active) {
        setOpened(true);
        if (activation.kind === 'open') heading.current?.focus();
      }
    });
    void bridge.getState().then(
      (next) => {
        if (!active || receivedEvent) return;
        acceptState(next);
        setLoading(false);
      },
      () => {
        if (!active || receivedEvent) return;
        setLoadFailed(true);
        setLoading(false);
      },
    );
    return () => {
      active = false;
      removeStateListener();
      removeActivationListener();
    };
  }, [acceptState, bridge, guide, loadAttempt]);

  const hide = useCallback(async () => {
    stopGuide();
    try {
      await bridge.hide();
    } catch {
      if (mounted.current) setMessage('hideFailed');
    }
  }, [bridge, stopGuide]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        event.isComposing ||
        event.repeat ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      )
        return;
      // Native select popups own Escape; don't hide the window while choosing.
      if (
        event.target instanceof Element &&
        event.target.closest('select, [role="combobox"], [role="dialog"]')
      )
        return;
      event.preventDefault();
      void hide();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hide]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setMessage(null);
    try {
      const next = await bridge.updatePreferences(draft);
      if (!mounted.current) return;
      acceptState(next, next.issue !== 'shortcut_unavailable');
      if (next.preferencesSaved && next.issue === null) setMessage('saved');
    } catch {
      if (mounted.current) setMessage('saveFailed');
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  async function quit() {
    stopGuide();
    try {
      await bridge.quit();
    } catch {
      if (mounted.current) setMessage('quitFailed');
    }
  }

  const issues = state
    ? [
        ...(!state.shortcutRegistered || state.issue === 'shortcut_unavailable'
          ? [text.shortcutUnavailable]
          : []),
        ...(!state.stopShortcutRegistered
          ? [text.stopShortcutUnavailable]
          : []),
        ...(!state.preferencesSaved || state.issue === 'preferences_not_saved'
          ? [text.notStored]
          : []),
      ]
    : [];
  const status = [
    loading ? text.loading : loadFailed ? text.loadFailed : '',
    saving ? text.saving : message ? text[message] : dirty ? text.unsaved : '',
    ...issues,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <main className="desktop-shell" aria-labelledby="desktop-title">
      <header className="desktop-header">
        <img
          className="desktop-logo"
          src={logo}
          width="76"
          height="76"
          alt=""
        />
        <div>
          <h1 id="desktop-title" ref={heading} tabIndex={-1}>
            VSual
          </h1>
          <p className="desktop-foundation">{text.foundation}</p>
        </div>
      </header>

      <p className="desktop-limitation">{text.limitation}</p>

      {narrationReady && (
        <a href="#desktop-welcome-title" className="desktop-guide-link">
          {text.guide}
        </a>
      )}

      <DesktopAssistant
        bridge={bridge}
        language={draft?.language ?? state?.preferences.language ?? 'en'}
        shortcut={state?.preferences.shortcut ?? 'Control+Alt+Space'}
        onBeforeWork={stopGuide}
        registerStopWork={registerStopWork}
        onSessionChange={acceptSession}
        {...(assistantDependencies
          ? { dependencies: assistantDependencies }
          : {})}
      />

      {narrationReady && (
        <DesktopGuide
          controller={guide}
          ready={!!state && narrationReady}
          desktopState={state}
          language={draft?.language ?? state?.preferences.language ?? 'en'}
          onReplay={() => {
            if (!state || !narrationReady) return;
            stopAssistant.current?.();
            const language = draft?.language ?? state.preferences.language;
            void guide.replay(
              guideSpeechText(
                language,
                state.preferences.shortcut,
                DESKTOP_STOP_SHORTCUT,
                state.stopShortcutRegistered,
                state.shortcutRegistered,
              ),
              language,
            );
          }}
        />
      )}

      <div className="desktop-actions desktop-window-actions">
        <button type="button" onClick={() => void hide()}>
          {text.hide}
        </button>
        <button type="button" onClick={() => void quit()}>
          {text.quit}
        </button>
      </div>
      <p className="desktop-help">{text.trayHelp}</p>

      <p
        className="desktop-status"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {status}
      </p>
      {loadFailed && (
        <button
          type="button"
          onClick={() => setLoadAttempt((attempt) => attempt + 1)}
        >
          {text.retry}
        </button>
      )}

      {draft && (
        <details className="desktop-settings">
          <summary>{text.settings}</summary>
          <p className="desktop-help">{text.settingsHelp}</p>
          <form onSubmit={(event) => void save(event)}>
            <label htmlFor="desktop-language">{text.language}</label>
            <select
              id="desktop-language"
              value={draft.language}
              disabled={saving}
              onChange={(event) => {
                const language = event.currentTarget.value;
                if (language !== 'en' && language !== 'vi') return;
                stopGuide();
                setDraft({ ...draft, language });
                setMessage(null);
              }}
            >
              <option value="en" lang="en">
                English
              </option>
              <option value="vi" lang="vi">
                Tiếng Việt
              </option>
            </select>
            <label htmlFor="desktop-shortcut">{text.shortcutLabel}</label>
            <select
              id="desktop-shortcut"
              value={draft.shortcut}
              disabled={saving}
              aria-describedby="desktop-shortcut-help"
              onChange={(event) => {
                const shortcut = DESKTOP_SHORTCUTS.find(
                  (option) => option === event.currentTarget.value,
                );
                if (!shortcut) return;
                stopGuide();
                setDraft({ ...draft, shortcut });
                setMessage(null);
              }}
            >
              {DESKTOP_SHORTCUTS.map((shortcut) => (
                <option key={shortcut} value={shortcut}>
                  {shortcutText(shortcut)}
                </option>
              ))}
            </select>
            <p id="desktop-shortcut-help" className="desktop-help">
              {text.shortcutHelp}
            </p>
            <button className="primary" type="submit" aria-disabled={saving}>
              {saving ? text.saving : text.save}
            </button>
          </form>
        </details>
      )}
    </main>
  );
}
