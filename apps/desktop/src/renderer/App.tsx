import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
  DESKTOP_SHORTCUTS,
  type DesktopBridge,
  type DesktopPreferences,
  type DesktopShortcut,
  type DesktopState,
} from '../bridge.ts';
import logo from '../../../extension/src/assets/vsual-logo.png';
import { DesktopAssistant } from './Assistant.tsx';
import type { AssistantDependencies } from './assistant-controller.ts';

const copy = {
  en: {
    foundation: 'Desktop assistant',
    limitation: 'Ask about one selected window using a screenshot.',
    availability: 'On this device',
    shortcut: 'Show VSual',
    shortcutReady: 'Shortcut is ready.',
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
      'The shortcut opens or focuses VSual while you use another app.',
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
    limitation: 'Hỏi về một cửa sổ đã chọn thông qua ảnh chụp màn hình.',
    availability: 'Trên thiết bị này',
    shortcut: 'Mở VSual',
    shortcutReady: 'Phím tắt đã sẵn sàng.',
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
      'Phím tắt mở hoặc đưa VSual lên trước khi bạn đang dùng ứng dụng khác.',
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

function shortcutText(shortcut: DesktopShortcut) {
  return shortcut.replace('Control', 'Ctrl').replaceAll('+', ' + ');
}

export function App({
  bridge = window.vsualDesktop,
  assistantDependencies,
}: {
  bridge?: DesktopBridge;
  assistantDependencies?: AssistantDependencies;
}) {
  const [state, setState] = useState<DesktopState | null>(null);
  const [draft, setDraft] = useState<DesktopPreferences | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
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
    const removeActivationListener = bridge.onActivate(() => {
      if (active) heading.current?.focus();
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
  }, [acceptState, bridge, loadAttempt]);

  const hide = useCallback(async () => {
    try {
      await bridge.hide();
    } catch {
      if (mounted.current) setMessage('hideFailed');
    }
  }, [bridge]);

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

      <DesktopAssistant
        bridge={bridge}
        language={draft?.language ?? state?.preferences.language ?? 'en'}
        shortcut={state?.preferences.shortcut ?? 'Control+Alt+Space'}
        {...(assistantDependencies
          ? { dependencies: assistantDependencies }
          : {})}
      />

      <div className="desktop-actions">
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
          {state && (
            <section className="desktop-device" aria-labelledby="device-title">
              <h2 id="device-title">{text.availability}</h2>
              <dl>
                <div>
                  <dt>{text.shortcut}</dt>
                  <dd>
                    <kbd>{shortcutText(state.preferences.shortcut)}</kbd>
                    <span>
                      {state.shortcutRegistered
                        ? text.shortcutReady
                        : text.shortcutUnavailable}
                    </span>
                  </dd>
                </div>
              </dl>
            </section>
          )}
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
