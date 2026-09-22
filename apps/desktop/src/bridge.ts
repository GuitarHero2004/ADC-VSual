import type { UiLanguage } from '@adc/contracts';

export const DESKTOP_SHORTCUTS = [
  'Control+Alt+Space',
  'Control+Alt+V',
  'Control+Shift+Space',
] as const;
export type DesktopShortcut = (typeof DESKTOP_SHORTCUTS)[number];
export interface DesktopPreferences {
  language: UiLanguage;
  shortcut: DesktopShortcut;
}
export interface DesktopState {
  preferences: DesktopPreferences;
  shortcutRegistered: boolean;
  preferencesSaved: boolean;
  issue: 'shortcut_unavailable' | 'preferences_not_saved' | null;
}
export const DEFAULT_DESKTOP_PREFERENCES: DesktopPreferences = {
  language: 'en',
  shortcut: DESKTOP_SHORTCUTS[0],
};

export function parseDesktopPreferences(input: unknown): DesktopPreferences {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Invalid desktop preferences');
  const value = input as Record<string, unknown>;
  if (
    Object.keys(value).length !== 2 ||
    (value.language !== 'en' && value.language !== 'vi') ||
    !DESKTOP_SHORTCUTS.some((shortcut) => shortcut === value.shortcut)
  )
    throw new Error('Invalid desktop preferences');
  return {
    language: value.language,
    shortcut: value.shortcut as DesktopShortcut,
  };
}

export interface DesktopBridge {
  getState(): Promise<DesktopState>;
  updatePreferences(preferences: DesktopPreferences): Promise<DesktopState>;
  hide(): Promise<void>;
  quit(): Promise<void>;
  onState(listener: (state: DesktopState) => void): () => void;
  onActivate(listener: () => void): () => void;
}

declare global {
  interface Window {
    vsualDesktop: DesktopBridge;
  }
}
