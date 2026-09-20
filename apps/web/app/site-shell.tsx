'use client';

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { UiLanguage } from '@adc/contracts';

const languageKey = 'vsual.website.language';
const LanguageContext = createContext<{
  language: UiLanguage;
  setLanguage: (language: UiLanguage) => void;
} | null>(null);

/** The fallback keeps individually rendered auth surfaces usable and testable. */
export function useWebsiteLanguage() {
  const context = useContext(LanguageContext);
  const [language, setLanguage] = useState<UiLanguage>('en');
  return context ?? { language, setLanguage };
}

const words = {
  en: {
    skip: 'Skip to main content',
    navigation: 'Main navigation',
    setup: 'Get started',
    demo: 'Orders demo',
    settings: 'Language',
    heading: 'Website language',
    language: 'Interface language',
    back: 'Back to page',
    speech: 'Voice setup',
  },
  vi: {
    skip: 'Chuyển đến nội dung chính',
    navigation: 'Điều hướng chính',
    setup: 'Bắt đầu',
    demo: 'Bản mẫu đơn hàng',
    settings: 'Ngôn ngữ',
    heading: 'Ngôn ngữ trang web',
    language: 'Ngôn ngữ giao diện',
    back: 'Quay lại trang',
    speech: 'Thiết lập giọng nói',
  },
};

export default function SiteShell({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<UiLanguage>('en');
  const [loaded, setLoaded] = useState(false);
  const [settings, setSettings] = useState(false);
  const settingsTrigger = useRef<HTMLButtonElement>(null);
  const settingsHeading = useRef<HTMLHeadingElement>(null);
  const copy = words[language];

  useEffect(() => {
    try {
      const saved = localStorage.getItem(languageKey);
      if (saved === 'vi' || saved === 'en') setLanguage(saved);
      else {
        const voice: unknown = JSON.parse(
          localStorage.getItem('adc.voice.preferences') ?? '{}',
        );
        if (
          voice &&
          typeof voice === 'object' &&
          'uiLanguage' in voice &&
          voice.uiLanguage === 'vi'
        )
          setLanguage('vi');
      }
      const requested = new URLSearchParams(window.location.search).get('lang');
      if (requested === 'en' || requested === 'vi') setLanguage(requested);
    } catch {
      // Language remains available when optional storage is blocked.
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
    if (!loaded) return;
    try {
      localStorage.setItem(languageKey, language);
    } catch {
      // A storage failure must not stop the user changing the interface.
    }
  }, [language, loaded]);

  useEffect(() => {
    if (settings) settingsHeading.current?.focus();
  }, [settings]);

  function closeSettings() {
    setSettings(false);
    settingsTrigger.current?.focus();
  }

  return (
    <LanguageContext.Provider value={{ language, setLanguage }}>
      <a className="skip-link" href="#main-content">
        {copy.skip}
      </a>
      <header className="site-header">
        <a className="site-brand" href="/" aria-label="VSual">
          VSual
        </a>
        <nav aria-label={copy.navigation}>
          <a href="/voice">{copy.setup}</a>
          <a href="/orders">{copy.demo}</a>
          <button
            ref={settingsTrigger}
            type="button"
            className="quiet-button"
            aria-expanded={settings}
            aria-controls="website-settings"
            onClick={() => (settings ? closeSettings() : setSettings(true))}
          >
            {copy.settings}
          </button>
        </nav>
      </header>
      <section
        id="website-settings"
        className="site-settings"
        aria-labelledby="website-settings-heading"
        hidden={!settings}
      >
        <h2 id="website-settings-heading" ref={settingsHeading} tabIndex={-1}>
          {copy.heading}
        </h2>
        <label htmlFor="website-language">{copy.language}</label>
        <select
          id="website-language"
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
        <p>
          <a href="/voice">{copy.speech}</a>
        </p>
        <button type="button" onClick={closeSettings}>
          {copy.back}
        </button>
      </section>
      {children}
    </LanguageContext.Provider>
  );
}
